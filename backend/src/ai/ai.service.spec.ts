import Anthropic from '@anthropic-ai/sdk';
import { UnprocessableEntityException } from '@nestjs/common';
import { AiService, classifyAiError, fromApiCustomId, RetryableAiError, toApiCustomId } from './ai.service';
import { EMPLOYEE_SYSTEM_PROMPT, EmployeeInsight } from './ai.schemas';
import type { EmployeeInputSource } from './ai-input';

const USER = '11111111-2222-4333-8444-555555555555';
const USER2 = '66666666-7777-4888-8999-000000000000';
const DATE = '2026-09-24';

const insight: EmployeeInsight = {
  summary: 'Worked 7h (420 min), mostly in VS Code (167 min) on the pagination task.',
  accomplishments: ['Opened PR for cursor pagination'],
  blockers: [],
  reportConsistency: { status: 'CONSISTENT', notes: ['Report matches tracked VS Code and GitHub time'] },
  nonValueWork: [],
  workload: 'BALANCED',
  workloadReason: '480 estimated minutes open vs 2400 minutes capacity',
  processImprovements: [],
  riskFlags: [],
  managerNote: 'On track.',
};

const message = (over: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5',
  stop_reason: 'end_turn',
  stop_details: null,
  content: [{ type: 'text', text: JSON.stringify(insight) }],
  usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 900 },
  ...over,
});

function source(): EmployeeInputSource {
  return {
    user: { displayName: 'Priya Sharma', jobTitle: 'Engineer', department: { name: 'Engineering' } },
    date: DATE,
    policy: { timezone: 'Asia/Kolkata', workDays: [1, 2, 3, 4, 5], workStart: '09:30', workEnd: '18:30', minDailyMinutes: 480 },
    session: null,
    hours: [],
    apps: [],
    tasks: [],
    report: null,
    alerts: [],
    baseline: { days: 0, medianActivePercent: null, medianProductivePercent: null, avgWorkedMinutes: null, tasksCompleted: 0 },
  };
}

function setup(opts: { apiKey?: string; aiEnabled?: boolean } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  let seq = 0;
  let lastRun: unknown = null;
  const prisma = {
    aiInsight: {
      upsert: jest.fn(async ({ where, create }) => {
        const existing = [...rows.values()].find((r) => r.customId === where.customId);
        if (existing) return existing;
        const row = { id: `ins${++seq}`, ...create, inputTokens: null, outputTokens: null, cacheReadTokens: null };
        rows.set(row.id as string, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }) => {
        const row = { ...rows.get(where.id), ...data };
        rows.set(where.id, row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        let count = 0;
        for (const r of rows.values()) {
          const match = where.customId?.in ? where.customId.in.includes(r.customId) : where.batchId ? r.batchId === where.batchId && (!where.status || r.status === where.status) : false;
          if (match) {
            Object.assign(r, data);
            count++;
          }
        }
        return { count };
      }),
      findMany: jest.fn(async ({ where }) => [...rows.values()].filter((r) => (where.batchId ? r.batchId === where.batchId : r.status === 'READY'))),
    },
    systemSetting: {
      findUnique: jest.fn(async () => (lastRun ? { value: lastRun } : null)),
      upsert: jest.fn(async ({ create }) => {
        lastRun = create.value;
        return create;
      }),
    },
    workSession: { findMany: jest.fn(async () => [{ userId: USER }, { userId: USER2 }]) },
    dailyWorkReport: { findMany: jest.fn(async () => []) },
    user: { findMany: jest.fn(async () => [{ id: USER }, { id: USER2 }]) },
  };
  const client = {
    beta: { messages: { parse: jest.fn(async () => message()) } },
    messages: {
      batches: {
        create: jest.fn(async () => ({ id: 'msgbatch_1', processing_status: 'in_progress' })),
        retrieve: jest.fn(async () => ({ id: 'msgbatch_1', processing_status: 'ended' })),
        results: jest.fn(),
      },
    },
  };
  const config = {
    anthropicApiKey: opts.apiKey ?? 'sk-ant-test',
    aiModel: 'claude-opus-5',
    aiEffort: 'high',
    aiDailyRunTime: '20:30',
    aiMaxEmployeesPerRun: 500,
  };
  const settings = { get: jest.fn(async (k: string) => (k === 'aiEnabled' ? (opts.aiEnabled ?? true) : undefined)) };
  const audit = { log: jest.fn(async () => undefined) };
  const metrics = { aiTokens: { inc: jest.fn() } };
  const queue = { add: jest.fn(async () => ({})) };
  const factory = jest.fn(() => client as unknown as Anthropic);
  const svc = new AiService(
    prisma as never, audit as never, settings as never, config as never, metrics as never,
    { orgTimezone: async () => 'Asia/Kolkata' } as never, {} as never, queue as never, factory,
  );
  jest.spyOn(svc, 'collectEmployee').mockImplementation(async () => source());
  return { svc, prisma, client, rows, metrics, queue, audit, factory, getLastRun: () => lastRun as Record<string, unknown> };
}

describe('AiService', () => {
  it('is disabled without ANTHROPIC_API_KEY (status + 422 on generation)', async () => {
    const { svc, client } = setup({ apiKey: '' });
    expect(await svc.status()).toMatchObject({ enabled: false, model: 'claude-opus-5' });
    await expect(svc.generateEmployee(USER, DATE)).rejects.toThrow(new UnprocessableEntityException('AI is not configured'));
    expect(client.beta.messages.parse).not.toHaveBeenCalled();
  });

  it('honours the aiEnabled setting', async () => {
    const { svc } = setup({ aiEnabled: false });
    expect((await svc.status()).enabled).toBe(false);
  });

  it('sync employee insight: request shape, stored READY with usage', async () => {
    const { svc, client, metrics } = setup();
    const out = await svc.generateEmployee(USER, DATE);
    expect(out).toMatchObject({ status: 'READY', inputTokens: 1200, outputTokens: 300, cacheReadTokens: 900, customId: `emp:${USER}:${DATE}` });
    expect(out.content).toEqual(insight);
    const params = (client.beta.messages.parse.mock.calls[0] as unknown[])[0] as Record<string, any>;
    expect(params).toMatchObject({ model: 'claude-opus-5', max_tokens: 8000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    expect(params.system).toEqual([{ type: 'text', text: EMPLOYEE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }]);
    expect(params.output_config.effort).toBe('high');
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('top_p');
    expect(params).not.toHaveProperty('thinking');
    expect(JSON.parse(params.messages[0].content).employee.firstName).toBe('Priya');
    expect(metrics.aiTokens.inc).toHaveBeenCalledWith({ type: 'cache_read' }, 900);
  });

  it('refusal and max_tokens -> FAILED', async () => {
    const a = setup();
    a.client.beta.messages.parse.mockResolvedValueOnce(message({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }));
    expect(await a.svc.generateEmployee(USER, DATE)).toMatchObject({ status: 'FAILED', error: 'Model refused (cyber)' });
    const b = setup();
    b.client.beta.messages.parse.mockResolvedValueOnce(message({ stop_reason: 'max_tokens' }));
    expect(await b.svc.generateEmployee(USER, DATE)).toMatchObject({ status: 'FAILED', error: 'Response truncated (max_tokens)' });
  });

  it('invalid JSON / schema mismatch -> FAILED', async () => {
    const a = setup();
    a.client.beta.messages.parse.mockResolvedValueOnce(message({ content: [{ type: 'text', text: '{"summary": 1}' }] }));
    const out = await a.svc.generateEmployee(USER, DATE);
    expect(out.status).toBe('FAILED');
    expect(String(out.error)).toMatch(/schema validation/);
  });

  it('429 is retryable, 400 fails permanently', async () => {
    const a = setup();
    a.client.beta.messages.parse.mockRejectedValueOnce(new Anthropic.RateLimitError(429, {}, 'slow down', new Headers()));
    await expect(a.svc.generateEmployee(USER, DATE)).rejects.toBeInstanceOf(RetryableAiError);
    const b = setup();
    b.client.beta.messages.parse.mockRejectedValueOnce(new Anthropic.BadRequestError(400, {}, 'bad request', new Headers()));
    await expect(b.svc.generateEmployee(USER, DATE)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect([...b.rows.values()][0]).toMatchObject({ status: 'FAILED' });
    expect(classifyAiError(new Anthropic.InternalServerError(529, {}, 'overloaded', new Headers())).retryable).toBe(true);
    expect(classifyAiError(new Anthropic.APIConnectionError({ message: 'reset' })).retryable).toBe(true);
  });

  it('custom ids round-trip between the stored and API-safe forms', () => {
    const id = `emp:${USER}:${DATE}`;
    expect(toApiCustomId(id)).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(fromApiCustomId(toApiCustomId(id))).toBe(id);
  });

  it('nightly batch: one request per employee, cached constant system prompt, json_schema format, no fallbacks', async () => {
    const { svc, client, getLastRun } = setup();
    const run = await svc.startNightly(DATE);
    expect(run).toMatchObject({ status: 'in_progress', batchId: 'msgbatch_1', employees: 2 });
    const { requests } = (client.messages.batches.create.mock.calls[0] as unknown[])[0] as { requests: Record<string, any>[] };
    expect(requests).toHaveLength(2);
    for (const r of requests) {
      expect(r.custom_id).toMatch(/^emp_[0-9a-f-]{36}_\d{4}-\d{2}-\d{2}$/);
      expect(r.params).toMatchObject({ model: 'claude-opus-5', max_tokens: 4000 });
      expect(r.params.system).toEqual([{ type: 'text', text: EMPLOYEE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }]);
      expect(r.params.output_config.effort).toBe('high');
      expect(r.params.output_config.format).toMatchObject({ type: 'json_schema', schema: expect.objectContaining({ type: 'object' }) });
      expect(r.params).not.toHaveProperty('fallbacks');
      expect(r.params).not.toHaveProperty('temperature');
    }
    // system prompt is byte-identical across requests (cacheable)
    expect(new Set(requests.map((r) => JSON.stringify(r.params.system))).size).toBe(1);
    expect(getLastRun()).toMatchObject({ status: 'in_progress', date: DATE });
  });

  it('poll: results are matched by custom_id (not position) and every result type is handled', async () => {
    const { svc, client, rows, queue, getLastRun } = setup();
    await svc.startNightly(DATE);
    async function* results() {
      // reverse order on purpose
      yield { custom_id: toApiCustomId(`emp:${USER2}:${DATE}`), result: { type: 'errored', error: { type: 'error', error: { type: 'overloaded_error', message: 'x' } } } };
      yield { custom_id: toApiCustomId(`emp:${USER}:${DATE}`), result: { type: 'succeeded', message: message() } };
    }
    client.messages.batches.results.mockResolvedValueOnce(results());
    const run = await svc.pollBatch();
    expect(run).toMatchObject({ status: 'ended', succeeded: 1, failed: 1, inputTokens: 1200, outputTokens: 300, cacheReadTokens: 900 });
    const byUser = new Map([...rows.values()].map((r) => [r.userId, r]));
    expect(byUser.get(USER)).toMatchObject({ status: 'READY' });
    expect(byUser.get(USER2)).toMatchObject({ status: 'FAILED' });
    expect(String(byUser.get(USER2)!.error)).toMatch(/errored/);
    expect(getLastRun()).toMatchObject({ status: 'ended' });
    expect(queue.add).toHaveBeenCalledWith('ai-management', { date: DATE, departmentId: null }, expect.objectContaining({ attempts: expect.any(Number) }));
  });

  it('poll does nothing while the batch is still processing', async () => {
    const { svc, client } = setup();
    await svc.startNightly(DATE);
    client.messages.batches.retrieve.mockResolvedValueOnce({ id: 'msgbatch_1', processing_status: 'in_progress' });
    expect(await svc.pollBatch()).toMatchObject({ status: 'in_progress' });
    expect(client.messages.batches.results).not.toHaveBeenCalled();
  });
});
