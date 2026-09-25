import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ComplianceRule, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AlertsService } from '../alerts/alerts.service';
import { MetricsService } from '../metrics/metrics.service';
import { PoliciesService } from '../policies/policies.service';
import { QUEUE_COMPLIANCE } from '../queues/queues';
import { paginated, skipTake } from '../common/dto/pagination.dto';
import { deviceScope, deviceScopeSql } from '../common/scope';
import type { AuthUser } from '../common/types';
import { ComplianceFinding, evaluate, EvaluationResult } from './compliance.engine';
import { ComplianceResultQueryDto, UpdateRuleDto } from './compliance.dto';

const RULE_CACHE_MS = 30_000;

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);
  private rulesCache: { at: number; rules: ComplianceRule[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly alerts: AlertsService,
    private readonly metrics: MetricsService,
    private readonly policies: PoliciesService,
    @InjectQueue(QUEUE_COMPLIANCE) private readonly queue: Queue,
  ) {}

  async rules(): Promise<ComplianceRule[]> {
    if (this.rulesCache && Date.now() - this.rulesCache.at < RULE_CACHE_MS) return this.rulesCache.rules;
    const rules = await this.prisma.complianceRule.findMany({ orderBy: { weight: 'desc' } });
    this.rulesCache = { at: Date.now(), rules };
    return rules;
  }

  async listRules() {
    return this.prisma.complianceRule.findMany({ orderBy: [{ severity: 'desc' }, { weight: 'desc' }] });
  }

  async updateRule(id: string, dto: UpdateRuleDto) {
    const before = await this.prisma.complianceRule.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Rule not found');
    const rule = await this.prisma.complianceRule.update({ where: { id }, data: dto });
    this.rulesCache = null;
    await this.audit.log({
      category: 'POLICY_CHANGE',
      action: 'compliance_rule.update',
      resourceType: 'ComplianceRule',
      resourceId: id,
      before: { severity: before.severity, weight: before.weight, enabled: before.enabled, markNonCompliant: before.markNonCompliant },
      after: dto,
    });
    // Re-evaluate everything asynchronously so scores reflect the new configuration.
    await this.queueAll();
    return rule;
  }

  /**
   * Evaluate one device now: persist a ComplianceResult, update the device's
   * denormalised state and raise / auto-resolve compliance alerts.
   */
  async evaluateDevice(deviceId: string, opts: { at?: Date; raiseAlerts?: boolean } = {}) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      include: {
        securityStatus: true,
        software: { where: { removedAt: null }, select: { name: true, version: true, status: true, removedAt: true } },
        patches: { where: { state: 'MISSING', severity: 'CRITICAL' }, select: { patchId: true, state: true, severity: true, releasedAt: true, detectedAt: true } },
      },
    });
    if (!device) throw new NotFoundException('Device not found');
    const { policy } = await this.policies.resolveForDevice(device);
    const rules = await this.rules();
    const now = opts.at ?? new Date();
    const result: EvaluationResult = evaluate(
      device,
      device.securityStatus,
      device.software,
      device.patches,
      policy,
      rules,
      now,
    );

    const previousState = device.complianceState;
    const saved = await this.prisma.$transaction(async (tx) => {
      const r = await tx.complianceResult.create({
        data: {
          deviceId,
          policyId: policy.id,
          policyVersion: policy.version,
          score: result.score,
          state: result.state,
          riskLevel: result.riskLevel,
          criticalCount: result.criticalCount,
          highCount: result.highCount,
          mediumCount: result.mediumCount,
          lowCount: result.lowCount,
          findings: result.findings as unknown as Prisma.InputJsonValue,
          evaluatedAt: now,
        },
      });
      await tx.device.update({
        where: { id: deviceId },
        data: {
          complianceState: result.state,
          complianceScore: result.score,
          riskLevel: result.riskLevel,
          lastEvaluatedAt: now,
        },
      });
      return r;
    });
    this.metrics.complianceEvaluations.inc();

    if (opts.raiseAlerts !== false && device.status !== 'RETIRED') {
      await this.syncAlerts(device.id, device.deviceName, result.findings, previousState, result.state);
    }
    if (previousState !== result.state) {
      await this.audit.log({
        category: 'SECURITY',
        action: 'compliance.state_change',
        actorType: 'SYSTEM',
        actorId: null,
        actorName: 'compliance-engine',
        resourceType: 'Device',
        resourceId: deviceId,
        deviceId,
        before: { state: previousState, score: device.complianceScore },
        after: { state: result.state, score: result.score, riskLevel: result.riskLevel },
      });
    }
    return saved;
  }

  private async syncAlerts(
    deviceId: string,
    deviceName: string,
    findings: ComplianceFinding[],
    previousState: string,
    newState: string,
  ) {
    for (const f of findings) {
      const dedupeKey = `compliance:${deviceId}:${f.ruleKey}`;
      if (f.passed) {
        await this.alerts.autoResolve(dedupeKey, 'rule passed');
        continue;
      }
      if (!f.markNonCompliant && f.severity !== 'CRITICAL') continue;
      await this.alerts.raise({
        deviceId,
        category: 'COMPLIANCE',
        severity: f.severity === 'NONE' ? 'INFO' : f.severity,
        title: `${f.name} on ${deviceName}`,
        message: `${f.detail}. Remediation: ${f.remediation}`,
        ruleKey: f.ruleKey,
        dedupeKey,
        metadata: { ruleKey: f.ruleKey, transition: previousState !== newState ? `${previousState}->${newState}` : undefined },
      });
    }
  }

  async queueDevices(deviceIds?: string[]): Promise<number> {
    if (deviceIds && deviceIds.length) return this.policies.queueEvaluation(deviceIds);
    return this.queueAll();
  }

  async queueAll(): Promise<number> {
    const devices = await this.prisma.device.findMany({ where: { status: { not: 'RETIRED' } }, select: { id: true } });
    return this.policies.queueEvaluation(devices.map((d) => d.id));
  }

  async results(q: ComplianceResultQueryDto, user?: AuthUser) {
    const where: Prisma.DeviceWhereInput = {
      AND: [deviceScope(user), { status: { not: 'RETIRED' }, lastEvaluatedAt: { not: null } }],
    };
    const and = where.AND as Prisma.DeviceWhereInput[];
    if (q.state) and.push({ complianceState: q.state });
    if (q.riskLevel) and.push({ riskLevel: q.riskLevel });
    if (q.departmentId) and.push({ departmentId: q.departmentId });
    if (q.search) {
      and.push({
        OR: [
          { deviceName: { contains: q.search, mode: 'insensitive' } },
          { hostname: { contains: q.search, mode: 'insensitive' } },
          { serialNumber: { contains: q.search, mode: 'insensitive' } },
        ],
      });
    }
    const sortMap: Record<string, Prisma.DeviceOrderByWithRelationInput> = {
      score: { complianceScore: q.sortOrder },
      evaluatedAt: { lastEvaluatedAt: q.sortOrder },
      riskLevel: { riskLevel: q.sortOrder },
      state: { complianceState: q.sortOrder },
      deviceName: { deviceName: q.sortOrder },
    };
    const [devices, total] = await Promise.all([
      this.prisma.device.findMany({
        where,
        select: { id: true, deviceName: true, platform: true, department: { select: { id: true, name: true } } },
        orderBy: sortMap[q.sortBy ?? ''] ?? { lastEvaluatedAt: 'desc' },
        ...skipTake(q),
      }),
      this.prisma.device.count({ where }),
    ]);
    const latest = await this.prisma.complianceResult.findMany({
      where: { deviceId: { in: devices.map((d) => d.id) } },
      orderBy: [{ deviceId: 'asc' }, { evaluatedAt: 'desc' }],
      distinct: ['deviceId'],
    });
    const byDevice = new Map(latest.map((r) => [r.deviceId, r]));
    const data = devices
      .map((d) => {
        const r = byDevice.get(d.id);
        return r ? { ...r, device: d } : null;
      })
      .filter(Boolean);
    return paginated(data, q.page, q.pageSize, total);
  }

  async history(deviceId: string, user?: AuthUser, limit = 100) {
    const device = await this.prisma.device.findFirst({ where: { AND: [{ id: deviceId }, deviceScope(user)] }, select: { id: true } });
    if (!device) throw new NotFoundException('Device not found');
    return this.prisma.complianceResult.findMany({
      where: { deviceId },
      orderBy: { evaluatedAt: 'desc' },
      take: limit,
    });
  }

  async summary(user?: AuthUser) {
    const scope = deviceScopeSql(user, 'd');
    const [byRule, byState, byRisk, rules] = await Promise.all([
      this.prisma.$queryRaw<{ ruleKey: string; failing: bigint }[]>`
        SELECT f->>'ruleKey' AS "ruleKey", count(*)::bigint AS failing
        FROM (
          SELECT DISTINCT ON (cr.device_id) cr.findings
          FROM compliance_results cr
          JOIN devices d ON d.id = cr.device_id
          WHERE d.status <> 'RETIRED' AND ${scope}
          ORDER BY cr.device_id, cr.evaluated_at DESC
        ) latest, jsonb_array_elements(latest.findings) f
        WHERE (f->>'passed')::boolean = false
        GROUP BY 1`,
      this.prisma.device.groupBy({
        by: ['complianceState'],
        where: { AND: [deviceScope(user), { status: { not: 'RETIRED' } }] },
        _count: { _all: true },
      }),
      this.prisma.device.groupBy({
        by: ['riskLevel'],
        where: { AND: [deviceScope(user), { status: { not: 'RETIRED' } }] },
        _count: { _all: true },
      }),
      this.rules(),
    ]);
    const failing = new Map(byRule.map((r) => [r.ruleKey, Number(r.failing)]));
    return {
      byRule: rules
        .map((r) => ({ ruleKey: r.key, name: r.name, severity: r.severity, failing: failing.get(r.key) ?? 0 }))
        .sort((a, b) => b.failing - a.failing),
      byState: byState.map((s) => ({ state: s.complianceState, count: s._count._all })),
      byRisk: byRisk.map((r) => ({ riskLevel: r.riskLevel, count: r._count._all })),
    };
  }
}
