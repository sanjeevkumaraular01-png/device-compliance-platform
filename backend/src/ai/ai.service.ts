import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { InjectQueue } from '@nestjs/bullmq';
import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AiInsight, AiInsightType, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { AppConfigService } from '../config/app-config.service';
import { MetricsService } from '../metrics/metrics.service';
import { QUEUE_WORKFORCE } from '../queues/queues';
import { orderBy, paginated, skipTake } from '../common/dto/pagination.dto';
import { scopedDepartmentIds } from '../common/scope';
import type { AuthUser } from '../common/types';
import { WorkforcePoliciesService } from '../workforce/policies.service';
import { WorkforceLiveService } from '../workforce/live.service';
import { assertCanView } from '../workforce/workforce-scope';
import { median, pct } from '../workforce/core/metrics';
import { addDays, dayRange, dbDate, localDate, zonedTime } from '../workforce/core/time';
import { buildEmployeeInput, buildManagementInput, EmployeeInputSource } from './ai-input';
import {
  EMPLOYEE_SYSTEM_PROMPT,
  EmployeeInsightJsonSchema,
  EmployeeInsightSchema,
  MANAGEMENT_SYSTEM_PROMPT,
  ManagementInsightSchema,
} from './ai.schemas';
import { AiInsightQueryDto } from './ai.dto';

/** Test hook: override how the Anthropic client is created. */
export const ANTHROPIC_CLIENT_FACTORY = Symbol('ANTHROPIC_CLIENT_FACTORY');
export type AnthropicClientFactory = (apiKey: string) => Anthropic;

export const AI_LAST_RUN_KEY = 'ai.lastRun';

export interface AiLastRun {
  date: string;
  batchId: string | null;
  status: 'in_progress' | 'ended' | 'failed' | 'skipped';
  employees: number;
  succeeded: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  startedAt: string;
  endedAt: string | null;
  error?: string | null;
}

/** Error the caller should retry later (429 / 5xx / connection). */
export class RetryableAiError extends Error {}

/** Minimal message shape we consume (Message and BetaMessage both satisfy it). */
interface MessageLike {
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  content: { type: string; text?: string }[];
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null };
  model?: string;
}

/** Classify an SDK error: retry later (429/5xx/connection) or fail permanently (4xx). */
export function classifyAiError(e: unknown): { retryable: boolean; status: number | null; message: string } {
  if (e instanceof Anthropic.RateLimitError) return { retryable: true, status: 429, message: 'Rate limited by the Claude API' };
  if (e instanceof Anthropic.APIConnectionError) return { retryable: true, status: null, message: `Connection error: ${e.message}` };
  if (e instanceof Anthropic.APIError) {
    const status = typeof e.status === 'number' ? e.status : null;
    const retryable = status === null || status === 408 || status === 409 || status === 429 || status >= 500;
    return { retryable, status, message: `Claude API error ${status ?? ''}: ${e.message}`.substring(0, 1000) };
  }
  return { retryable: false, status: null, message: (e as Error)?.message ?? String(e) };
}

/** API custom_id allows only [a-zA-Z0-9_-]; the stored/contract form is `emp:<userId>:<date>`. */
export const toApiCustomId = (customId: string) => customId.replace(/:/g, '_');
export const fromApiCustomId = (apiId: string) => {
  const m = /^emp_([0-9a-f-]{36})_(\d{4}-\d{2}-\d{2})$/i.exec(apiId);
  return m ? `emp:${m[1]}:${m[2]}` : apiId;
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private cachedClient: Anthropic | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly config: AppConfigService,
    private readonly metrics: MetricsService,
    private readonly policies: WorkforcePoliciesService,
    private readonly live: WorkforceLiveService,
    @InjectQueue(QUEUE_WORKFORCE) private readonly queue: Queue,
    @Optional() @Inject(ANTHROPIC_CLIENT_FACTORY) private readonly clientFactory?: AnthropicClientFactory,
  ) {}

  // ───────────────────────── Configuration ─────────────────────────

  client(): Anthropic | null {
    const apiKey = this.config.anthropicApiKey;
    if (!apiKey) return null;
    if (!this.cachedClient) this.cachedClient = this.clientFactory ? this.clientFactory(apiKey) : new Anthropic({ apiKey });
    return this.cachedClient;
  }

  get model() {
    return this.config.aiModel;
  }

  async isEnabled(): Promise<boolean> {
    if (!this.config.anthropicApiKey) return false;
    return (await this.settings.get<boolean>('aiEnabled')) !== false;
  }

  private async requireClient(): Promise<Anthropic> {
    const c = (await this.isEnabled()) ? this.client() : null;
    if (!c) throw new UnprocessableEntityException('AI is not configured');
    return c;
  }

  async lastRun(): Promise<AiLastRun | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: AI_LAST_RUN_KEY } });
    return (row?.value as unknown as AiLastRun) ?? null;
  }

  private async saveLastRun(v: AiLastRun) {
    await this.prisma.systemSetting.upsert({
      where: { key: AI_LAST_RUN_KEY },
      create: { key: AI_LAST_RUN_KEY, value: v as unknown as Prisma.InputJsonValue },
      update: { value: v as unknown as Prisma.InputJsonValue },
    });
  }

  async status() {
    return { enabled: await this.isEnabled(), model: this.model, effort: this.config.aiEffort, dailyRunTime: this.config.aiDailyRunTime, lastRun: await this.lastRun() };
  }

  private countTokens(usage: MessageLike['usage']) {
    this.metrics.aiTokens.inc({ type: 'input' }, usage.input_tokens ?? 0);
    this.metrics.aiTokens.inc({ type: 'output' }, usage.output_tokens ?? 0);
    this.metrics.aiTokens.inc({ type: 'cache_read' }, usage.cache_read_input_tokens ?? 0);
  }

  // ───────────────────────── Input collection ─────────────────────────

  /** Gather one employee's day (no screenshots, no window titles, no email in the output). */
  async collectEmployee(userId: string, date: string): Promise<EmployeeInputSource> {
    const { user, policy } = await this.policies.forUser(userId);
    const tz = policy.timezone;
    const { start, end } = dayRange(date, tz);
    const now = new Date();
    const [session, hours, apps, entries, report, alerts, hist, completed] = await Promise.all([
      this.prisma.workSession.findUnique({ where: { userId_date: { userId, date: dbDate(date) } } }),
      this.live.timelineFor(userId, date, tz),
      this.live.appUsage({ userIds: [userId], start, end, limit: 15 }),
      this.prisma.timeEntry.findMany({
        where: { userId, startedAt: { lt: end }, OR: [{ endedAt: null }, { endedAt: { gt: start } }] },
        include: { task: { select: { id: true, title: true, status: true, trackedSec: true, estimatedMinutes: true, dueDate: true, delayCount: true, project: { select: { name: true } } } } },
      }),
      this.prisma.dailyWorkReport.findUnique({ where: { userId_date: { userId, date: dbDate(date) } }, include: { items: { orderBy: { sortOrder: 'asc' } } } }),
      this.prisma.alert.findMany({ where: { subjectUserId: userId, category: 'WORKFORCE', status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, select: { ruleKey: true, severity: true, title: true }, take: 20 }),
      this.prisma.workSession.findMany({ where: { userId, date: { gte: dbDate(addDays(date, -14)), lt: dbDate(date) }, status: { in: ['PRESENT', 'LATE', 'HALF_DAY'] } } }),
      this.prisma.workTask.count({ where: { assigneeId: userId, status: 'DONE', completedAt: { gte: dayRange(addDays(date, -14), tz).start, lt: end } } }),
    ]);
    const tasks = new Map<string, EmployeeInputSource['tasks'][number]>();
    for (const e of entries) {
      const s = Math.max(e.startedAt.getTime(), start.getTime());
      const en = Math.min((e.endedAt ?? now).getTime(), end.getTime());
      const t = tasks.get(e.taskId) ?? {
        title: e.task.title, projectName: e.task.project?.name ?? null, status: e.task.status, trackedMinutesToday: 0,
        trackedMinutesTotal: Math.round(e.task.trackedSec / 60), estimatedMinutes: e.task.estimatedMinutes, dueDate: e.task.dueDate, delayCount: e.task.delayCount,
      };
      t.trackedMinutesToday += Math.max(0, Math.round((en - s) / 60_000));
      tasks.set(e.taskId, t);
    }
    const working = hist.map((h) => h.activeSec + h.meetingSec);
    return {
      user: { displayName: user.displayName, jobTitle: user.jobTitle, department: user.department },
      date,
      policy,
      session,
      hours,
      apps,
      tasks: [...tasks.values()],
      report: report && report.status !== 'DRAFT' ? { status: report.status, summary: report.summary, items: report.items } : null,
      alerts,
      baseline: {
        days: hist.length,
        medianActivePercent: median(hist.map((h) => pct(h.activeSec + h.meetingSec, h.activeSec + h.meetingSec + h.idleSec))),
        medianProductivePercent: median(hist.map((h) => pct(h.productiveSec, h.activeSec + h.meetingSec))),
        avgWorkedMinutes: working.length ? Math.round(working.reduce((a, b) => a + b, 0) / working.length / 60) : null,
        tasksCompleted: completed,
      },
    };
  }

  // ───────────────────────── Result handling ─────────────────────────

  /** Validate a model response for an insight row and store READY/FAILED. */
  async applyMessage(insightId: string, message: MessageLike, kind: 'employee' | 'management'): Promise<AiInsight> {
    const usage = message.usage ?? { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
    this.countTokens(usage);
    const tokens = { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0, cacheReadTokens: usage.cache_read_input_tokens ?? 0 };
    const fail = (error: string) =>
      this.prisma.aiInsight.update({ where: { id: insightId }, data: { status: 'FAILED', error: error.substring(0, 2000), completedAt: new Date(), ...tokens } });
    if (message.stop_reason === 'refusal') return fail(`Model refused${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}`);
    if (message.stop_reason === 'max_tokens') return fail('Response truncated (max_tokens)');
    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return fail('Response was not valid JSON');
    }
    const parsed = (kind === 'employee' ? EmployeeInsightSchema : ManagementInsightSchema).safeParse(json);
    if (!parsed.success) return fail(`Response failed schema validation: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    return this.prisma.aiInsight.update({
      where: { id: insightId },
      data: { status: 'READY', content: parsed.data as Prisma.InputJsonValue, error: null, completedAt: new Date(), model: message.model ?? this.model, ...tokens },
    });
  }

  private async upsertPending(type: AiInsightType, customId: string, date: string, userId: string | null, departmentId: string | null, batchId: string | null = null) {
    return this.prisma.aiInsight.upsert({
      where: { customId },
      create: { type, customId, date: dbDate(date), userId, departmentId, status: 'PENDING', model: this.model, batchId },
      update: { status: 'PENDING', error: null, model: this.model, batchId, completedAt: null },
    });
  }

  private systemBlock(text: string) {
    return [{ type: 'text' as const, text, cache_control: { type: 'ephemeral' as const } }];
  }

  // ───────────────────────── Synchronous generation ─────────────────────────

  /** On-demand employee insight (sync, server-side fallbacks enabled). */
  async generateEmployee(userId: string, date: string, actor?: AuthUser): Promise<AiInsight> {
    const client = await this.requireClient();
    const input = buildEmployeeInput(await this.collectEmployee(userId, date));
    const row = await this.upsertPending('EMPLOYEE_DAILY', `emp:${userId}:${date}`, date, userId, null);
    let res: MessageLike;
    try {
      res = (await client.beta.messages.parse({
        model: this.model,
        max_tokens: 8000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: this.systemBlock(EMPLOYEE_SYSTEM_PROMPT),
        messages: [{ role: 'user', content: JSON.stringify(input) }],
        output_config: { effort: this.config.aiEffort, format: zodOutputFormat(EmployeeInsightSchema) },
      })) as unknown as MessageLike;
    } catch (e) {
      return this.handleSyncError(row.id, e);
    }
    const out = await this.applyMessage(row.id, res, 'employee');
    await this.audit.log({
      category: actor ? 'USER_ACTION' : 'SYSTEM',
      action: 'ai.insight.employee',
      ...(actor ? {} : { actorType: 'SYSTEM', actorId: null, actorName: 'ai' }),
      resourceType: 'AiInsight',
      resourceId: out.id,
      after: { userId, date, status: out.status, inputTokens: out.inputTokens, outputTokens: out.outputTokens },
    });
    return out;
  }

  private async handleSyncError(insightId: string, e: unknown): Promise<never> {
    const c = classifyAiError(e);
    if (c.retryable) {
      await this.prisma.aiInsight.update({ where: { id: insightId }, data: { status: 'PENDING', error: c.message } });
      throw new RetryableAiError(c.message);
    }
    await this.prisma.aiInsight.update({ where: { id: insightId }, data: { status: 'FAILED', error: c.message, completedAt: new Date() } });
    throw new UnprocessableEntityException(`AI request failed: ${c.message}`);
  }

  /** Department (or org-wide when departmentId is null) summary built from employee insights. */
  async generateManagement(date: string, departmentId: string | null, actor?: AuthUser): Promise<AiInsight> {
    const client = await this.requireClient();
    const dept = departmentId ? await this.prisma.department.findUnique({ where: { id: departmentId }, select: { id: true, name: true } }) : null;
    if (departmentId && !dept) throw new NotFoundException('Department not found');
    const users = await this.policies.trackedUsers(departmentId ? { departmentId } : {});
    const ids = users.map((u) => u.id);
    const [sessions, insights, reports] = await Promise.all([
      this.prisma.workSession.findMany({ where: { userId: { in: ids }, date: dbDate(date) } }),
      this.prisma.aiInsight.findMany({ where: { userId: { in: ids }, date: dbDate(date), type: 'EMPLOYEE_DAILY', status: 'READY' } }),
      this.prisma.dailyWorkReport.count({ where: { userId: { in: ids }, date: dbDate(date), status: { not: 'DRAFT' } } }),
    ]);
    const sessBy = new Map(sessions.map((s) => [s.userId, s]));
    const insBy = new Map(insights.map((i) => [i.userId, i]));
    const worked = sessions.filter((s) => ['PRESENT', 'LATE', 'HALF_DAY'].includes(s.status));
    const prodVals = worked.map((s) => pct(s.productiveSec, s.activeSec + s.meetingSec));
    const actVals = worked.map((s) => pct(s.activeSec + s.meetingSec, s.activeSec + s.meetingSec + s.idleSec));
    const avg = (v: number[]) => (v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : 0);
    const input = buildManagementInput({
      date,
      scope: dept?.name ?? 'Whole organization',
      metrics: {
        employees: users.length,
        present: worked.length,
        absent: sessions.filter((s) => s.status === 'ABSENT').length,
        late: sessions.filter((s) => s.lateMinutes > 0).length,
        onLeave: sessions.filter((s) => s.status === 'ON_LEAVE').length,
        avgProductivePercent: avg(prodVals),
        avgActivePercent: avg(actVals),
        totalOvertimeHours: Math.round(sessions.reduce((a, s) => a + s.overtimeMinutes, 0) / 6) / 10,
        reportsSubmitted: reports,
        reportsMissing: Math.max(0, worked.length - reports),
      },
      employees: users
        .filter((u) => sessBy.has(u.id) || insBy.has(u.id))
        .map((u) => {
          const s = sessBy.get(u.id);
          const w = s ? s.activeSec + s.meetingSec : 0;
          return { name: u.displayName, jobTitle: u.jobTitle, workedMinutes: Math.round(w / 60), productivePercent: s ? pct(s.productiveSec, w) : 0, insight: (insBy.get(u.id)?.content as Record<string, unknown>) ?? null };
        }),
    });
    const row = await this.upsertPending('MANAGEMENT_DAILY', `mgmt:${departmentId ?? 'org'}:${date}`, date, null, departmentId);
    let res: MessageLike;
    try {
      res = (await client.beta.messages.parse({
        model: this.model,
        max_tokens: 8000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: this.systemBlock(MANAGEMENT_SYSTEM_PROMPT),
        messages: [{ role: 'user', content: JSON.stringify(input) }],
        output_config: { effort: this.config.aiEffort, format: zodOutputFormat(ManagementInsightSchema) },
      })) as unknown as MessageLike;
    } catch (e) {
      return this.handleSyncError(row.id, e);
    }
    const out = await this.applyMessage(row.id, res, 'management');
    await this.audit.log({
      category: actor ? 'USER_ACTION' : 'SYSTEM',
      action: 'ai.insight.management',
      ...(actor ? {} : { actorType: 'SYSTEM', actorId: null, actorName: 'ai' }),
      resourceType: 'AiInsight',
      resourceId: out.id,
      after: { departmentId, date, status: out.status, inputTokens: out.inputTokens, outputTokens: out.outputTokens },
    });
    return out;
  }

  // ───────────────────────── Nightly batch ─────────────────────────

  /** Employees with activity or a submitted report on `date`. */
  async nightlyCandidates(date: string): Promise<string[]> {
    const [sessions, reports] = await Promise.all([
      this.prisma.workSession.findMany({ where: { date: dbDate(date), OR: [{ activeSec: { gt: 0 } }, { meetingSec: { gt: 0 } }] }, select: { userId: true } }),
      this.prisma.dailyWorkReport.findMany({ where: { date: dbDate(date), status: { not: 'DRAFT' } }, select: { userId: true } }),
    ]);
    const ids = [...new Set([...sessions.map((s) => s.userId), ...reports.map((r) => r.userId)])];
    const active = await this.prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true }, orderBy: { displayName: 'asc' } });
    return active.map((u) => u.id).slice(0, this.config.aiMaxEmployeesPerRun);
  }

  /** Create the nightly Message Batch (one request per employee). */
  async startNightly(date: string): Promise<AiLastRun> {
    const client = await this.requireClient();
    const userIds = await this.nightlyCandidates(date);
    const run: AiLastRun = {
      date, batchId: null, status: 'skipped', employees: userIds.length, succeeded: 0, failed: 0,
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, startedAt: new Date().toISOString(), endedAt: null,
    };
    if (!userIds.length) {
      run.endedAt = run.startedAt;
      await this.saveLastRun(run);
      return run;
    }
    const requests = [];
    for (const userId of userIds) {
      const input = buildEmployeeInput(await this.collectEmployee(userId, date));
      const customId = `emp:${userId}:${date}`;
      await this.upsertPending('EMPLOYEE_DAILY', customId, date, userId, null);
      requests.push({
        custom_id: toApiCustomId(customId),
        params: {
          model: this.model,
          max_tokens: 4000,
          system: this.systemBlock(EMPLOYEE_SYSTEM_PROMPT),
          messages: [{ role: 'user' as const, content: JSON.stringify(input) }],
          output_config: { effort: this.config.aiEffort, format: { type: 'json_schema' as const, schema: EmployeeInsightJsonSchema } },
        },
      });
    }
    try {
      const batch = await client.messages.batches.create({ requests });
      run.batchId = batch.id;
      run.status = 'in_progress';
      await this.prisma.aiInsight.updateMany({ where: { customId: { in: userIds.map((u) => `emp:${u}:${date}`) } }, data: { batchId: batch.id } });
    } catch (e) {
      const c = classifyAiError(e);
      if (c.retryable) throw new RetryableAiError(c.message);
      run.status = 'failed';
      run.error = c.message;
      run.failed = userIds.length;
      run.endedAt = new Date().toISOString();
      await this.prisma.aiInsight.updateMany({ where: { customId: { in: userIds.map((u) => `emp:${u}:${date}`) } }, data: { status: 'FAILED', error: c.message, completedAt: new Date() } });
    }
    await this.saveLastRun(run);
    await this.audit.log({ category: 'SYSTEM', action: 'ai.nightly.start', actorType: 'SYSTEM', actorId: null, actorName: 'ai', resourceType: 'AiBatch', resourceId: run.batchId, success: run.status !== 'failed', after: { date, employees: userIds.length, status: run.status, error: run.error ?? null } });
    return run;
  }

  /** Poll the running batch; when it has ended store every result (keyed by custom_id) and queue management summaries. */
  async pollBatch(): Promise<AiLastRun | null> {
    const run = await this.lastRun();
    if (!run || run.status !== 'in_progress' || !run.batchId) return run;
    const client = this.client();
    if (!client) return run;
    let batch;
    try {
      batch = await client.messages.batches.retrieve(run.batchId);
    } catch (e) {
      const c = classifyAiError(e);
      if (c.retryable) throw new RetryableAiError(c.message);
      run.status = 'failed';
      run.error = c.message;
      run.endedAt = new Date().toISOString();
      await this.saveLastRun(run);
      return run;
    }
    if (batch.processing_status !== 'ended') return run;

    const insights = await this.prisma.aiInsight.findMany({ where: { batchId: run.batchId }, select: { id: true, customId: true } });
    const byCustomId = new Map(insights.map((i) => [i.customId, i.id]));
    for await (const r of await client.messages.batches.results(run.batchId)) {
      const id = byCustomId.get(fromApiCustomId(r.custom_id));
      if (!id) {
        this.logger.warn(`batch ${run.batchId}: unknown custom_id ${r.custom_id}`);
        continue;
      }
      let row: AiInsight;
      switch (r.result.type) {
        case 'succeeded':
          row = await this.applyMessage(id, r.result.message as unknown as MessageLike, 'employee');
          break;
        case 'errored':
          row = await this.prisma.aiInsight.update({
            where: { id },
            data: { status: 'FAILED', error: `Batch request errored: ${JSON.stringify(r.result.error).substring(0, 1000)}`, completedAt: new Date() },
          });
          break;
        case 'expired':
          row = await this.prisma.aiInsight.update({ where: { id }, data: { status: 'FAILED', error: 'Batch request expired', completedAt: new Date() } });
          break;
        case 'canceled':
          row = await this.prisma.aiInsight.update({ where: { id }, data: { status: 'FAILED', error: 'Batch request canceled', completedAt: new Date() } });
          break;
        default:
          continue;
      }
      if (row.status === 'READY') run.succeeded++;
      else run.failed++;
      run.inputTokens += row.inputTokens ?? 0;
      run.outputTokens += row.outputTokens ?? 0;
      run.cacheReadTokens += row.cacheReadTokens ?? 0;
    }
    // Requests without any result line
    const leftover = await this.prisma.aiInsight.updateMany({
      where: { batchId: run.batchId, status: 'PENDING' },
      data: { status: 'FAILED', error: 'No result returned for this request', completedAt: new Date() },
    });
    run.failed += leftover.count;
    run.status = 'ended';
    run.endedAt = new Date().toISOString();
    await this.saveLastRun(run);
    await this.audit.log({ category: 'SYSTEM', action: 'ai.nightly.complete', actorType: 'SYSTEM', actorId: null, actorName: 'ai', resourceType: 'AiBatch', resourceId: run.batchId, after: { ...run } });
    await this.queueManagement(run.date);
    return run;
  }

  /** One job per department with READY insights + one org-wide job (retried with backoff). */
  async queueManagement(date: string) {
    const rows = await this.prisma.aiInsight.findMany({
      where: { date: dbDate(date), type: 'EMPLOYEE_DAILY', status: 'READY' },
      select: { user: { select: { departmentId: true } } },
    });
    const depts = [...new Set(rows.map((r) => r.user?.departmentId).filter((x): x is string => !!x))];
    for (const departmentId of [...depts, null]) {
      await this.queue.add(
        'ai-management',
        { date, departmentId },
        { jobId: `ai-management:${departmentId ?? 'org'}:${date}`, attempts: 6, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 100, removeOnFail: 200 },
      );
    }
    return depts.length + 1;
  }

  /** Worker tick (every 5 min): start tonight's run once AI_DAILY_RUN_TIME has passed, then poll it. */
  async tick(now = new Date()) {
    if (!(await this.isEnabled())) return { enabled: false };
    const tz = await this.policies.orgTimezone();
    const today = localDate(now, tz);
    const run = await this.lastRun();
    if (run?.status === 'in_progress') return { polled: (await this.pollBatch())?.status };
    if (now >= zonedTime(today, this.config.aiDailyRunTime, tz) && (!run || run.date < today)) {
      const started = await this.startNightly(today);
      return { started: started.status, employees: started.employees };
    }
    return { idle: true };
  }

  // ───────────────────────── Read API ─────────────────────────

  private scopeWhere(user: AuthUser): Prisma.AiInsightWhereInput {
    if (!user.permissions.includes('workforce:ai')) return { type: 'EMPLOYEE_DAILY', userId: user.id };
    if (user.roleKey === 'DEPARTMENT_MANAGER') {
      const ids = scopedDepartmentIds(user);
      return { OR: [{ userId: user.id }, { type: 'EMPLOYEE_DAILY', user: { departmentId: { in: ids } } }, { type: 'MANAGEMENT_DAILY', departmentId: { in: ids } }] };
    }
    return {};
  }

  async list(user: AuthUser, q: AiInsightQueryDto) {
    const and: Prisma.AiInsightWhereInput[] = [this.scopeWhere(user)];
    if (q.date) and.push({ date: dbDate(q.date) });
    if (q.type) and.push({ type: q.type });
    if (q.userId) and.push({ userId: q.userId });
    if (q.departmentId) and.push({ OR: [{ departmentId: q.departmentId }, { user: { departmentId: q.departmentId } }] });
    if (q.status) and.push({ status: q.status });
    const where = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.aiInsight.findMany({
        where,
        include: { user: { select: { id: true, displayName: true, jobTitle: true, departmentId: true } }, department: { select: { id: true, name: true } } },
        orderBy: orderBy(q, ['createdAt', 'date', 'completedAt', 'status'], 'date'),
        ...skipTake(q),
      }),
      this.prisma.aiInsight.count({ where }),
    ]);
    return paginated(rows, q.page, q.pageSize, total);
  }

  async get(user: AuthUser, id: string) {
    const row = await this.prisma.aiInsight.findFirst({
      where: { AND: [{ id }, this.scopeWhere(user)] },
      include: { user: { select: { id: true, displayName: true, jobTitle: true, departmentId: true } }, department: { select: { id: true, name: true } } },
    });
    if (!row) throw new NotFoundException('Insight not found');
    return row;
  }

  async requestEmployee(user: AuthUser, userId: string, date: string) {
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, departmentId: true } });
    if (!target) throw new NotFoundException('User not found');
    assertCanView(user, target, 'workforce:ai');
    await this.requireClient();
    try {
      return await this.generateEmployee(userId, date, user);
    } catch (e) {
      if (e instanceof RetryableAiError) throw new ServiceUnavailableException(`${e.message}; please retry later`);
      throw e;
    }
  }

  async requestManagement(user: AuthUser, date: string, departmentId: string | null) {
    if (user.roleKey === 'DEPARTMENT_MANAGER' && (!departmentId || !scopedDepartmentIds(user).includes(departmentId))) {
      throw new ForbiddenException('Department managers can request summaries for their own department only');
    }
    await this.requireClient();
    try {
      return await this.generateManagement(date, departmentId, user);
    } catch (e) {
      if (e instanceof RetryableAiError) throw new ServiceUnavailableException(`${e.message}; please retry later`);
      throw e;
    }
  }

}
