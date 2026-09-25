/**
 * Workforce e2e (docs/WORKFORCE.md): agent activity ingest -> session metrics -> live board,
 * clock in/out, daily report validation, task timers, screenshot policy enforcement.
 * Requires a migrated + seeded database (DATABASE_URL / REDIS_URL).
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/main';

const TZ = 'Asia/Kolkata';
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Minimal valid JPEG header (SOI + APP0 + SOF0 800x600 + EOI). */
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
]);

describe('Workforce (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: string;
  let emp: string;
  let userId: string;
  let deviceId: string;
  let agentToken: string;
  let policyId: string;
  let taskId: string;
  const ts = Date.now();
  const email = `wf.e2e.${ts}@secureendpoint.local`;
  const password = 'E2e!Workforce2026';
  const osUser = `CORP\\wf.e2e.${ts}`;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@secureendpoint.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!Secure2026';
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const agent = () => ({ Authorization: `Bearer ${agentToken}`, 'X-Device-Id': deviceId });

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    http = app.getHttpServer();
    admin = (await request(http).post('/api/v1/auth/login').send({ email: adminEmail, password: adminPassword }).expect(200)).body.accessToken;

    // 24x7 policy so the test is independent of the wall clock
    const dept = await request(http).post('/api/v1/departments').set(A(admin)).send({ name: `E2E Workforce ${ts}`, code: `WF${String(ts).slice(-8)}` }).expect(201);
    const pol = await request(http)
      .post('/api/v1/workforce/policies')
      .set(A(admin))
      .send({ name: `E2E 24x7 ${ts}`, timezone: TZ, workDays: [1, 2, 3, 4, 5, 6, 7], workStart: '00:00', workEnd: '23:59', trackOutsideWorkHours: true, officeNetworks: ['10.99.0.0/16'] })
      .expect(201);
    policyId = pol.body.id;
    await request(http).post(`/api/v1/workforce/policies/${policyId}/assign`).set(A(admin)).send({ departmentIds: [dept.body.id] }).expect(200);

    const user = await request(http).post('/api/v1/users').set(A(admin)).send({ email, displayName: 'Wanda Force', roleKey: 'EMPLOYEE', departmentId: dept.body.id, password, jobTitle: 'QA Engineer' }).expect(201);
    userId = user.body.id;

    const tok = await request(http).post('/api/v1/enrollment/tokens').set(A(admin)).send({ name: 'wf-e2e', maxUses: 1, expiresInDays: 1, autoApprove: true }).expect(201);
    const enr = await request(http)
      .post('/api/v1/agent/enroll')
      .send({ enrollmentToken: tok.body.token, agentVersion: '1.1.0', hardware: { hostname: 'wf-e2e', serialNumber: `WF-E2E-${ts}`, platform: 'WINDOWS' } })
      .expect(201);
    deviceId = enr.body.deviceId;
    agentToken = enr.body.agentToken;
    await request(http).post(`/api/v1/devices/${deviceId}/assign`).set(A(admin)).send({ userId }).expect((r) => expect([200, 201]).toContain(r.status));

    emp = (await request(http).post('/api/v1/auth/login').send({ email, password }).expect(200)).body.accessToken;
  });

  afterAll(async () => {
    if (deviceId) await request(http).delete(`/api/v1/devices/${deviceId}`).set(A(admin));
    if (policyId) await request(http).delete(`/api/v1/workforce/policies/${policyId}`).set(A(admin));
    if (userId) await request(http).delete(`/api/v1/users/${userId}`).set(A(admin));
    await app?.close();
  });

  it('heartbeat returns the workforce block', async () => {
    const res = await request(http).post('/api/v1/agent/heartbeat').set(agent()).send({ agentVersion: '1.1.0' }).expect(200);
    expect(res.body.policy.workforce).toEqual(
      expect.objectContaining({ enabled: true, idleThresholdSec: 300, captureWindowTitles: false, clockedOut: false, screenshots: { enabled: false, intervalMin: 15, blur: true } }),
    );
    expect(res.body.policy.workforce.noticeText).toMatch(/No keystrokes/);
  });

  it('agent activity ingest -> session metrics -> live board shows ONLINE_ACTIVE', async () => {
    const now = Date.now();
    const seg = (fromMin: number, toMin: number, o: Record<string, unknown>) => ({
      startedAt: new Date(now - fromMin * 60_000).toISOString(),
      endedAt: new Date(now - toMin * 60_000).toISOString(),
      inputEvents: 120,
      ...o,
    });
    const body = {
      osUser,
      network: { ips: ['10.99.4.20'], ssid: 'Lab' },
      segments: [
        seg(9, 6, { active: true, app: 'Code' }),
        seg(6, 3, { active: true, app: 'chrome', domain: 'https://github.com/acme/repo?tab=prs', windowTitle: 'Secret PR title' }),
        seg(3, 0.1, { active: true, app: 'chrome', domain: 'www.youtube.com' }),
      ],
      sessionEvents: [{ type: 'UNLOCK', at: new Date(now - 10 * 60_000).toISOString() }],
    };
    const res = await request(http).post('/api/v1/agent/activity').set(agent()).send(body).expect(200);
    expect(res.body).toEqual({ accepted: 3, userId });

    // spool resend is ignored (idempotent)
    const again = await request(http).post('/api/v1/agent/activity').set(agent()).send(body).expect(200);
    expect(again.body.accepted).toBe(0);

    const me = await request(http).get('/api/v1/workforce/me').set(A(emp)).expect(200);
    expect(me.body.status).toBe('ONLINE_ACTIVE');
    expect(me.body.today).toEqual(expect.objectContaining({ location: 'OFFICE' }));
    expect(['PRESENT', 'LATE']).toContain(me.body.today.status);
    expect(me.body.today.activeSec).toBeGreaterThanOrEqual(530);
    expect(me.body.today.productiveSec).toBeGreaterThanOrEqual(355);
    expect(me.body.today.unproductiveSec).toBeGreaterThanOrEqual(170);
    expect(me.body.today.clockInAt).toBeTruthy(); // auto clock-in on first activity
    expect(me.body.trackingNotice).toMatch(/No keystrokes/);

    const live = await request(http).get('/api/v1/workforce/live').query({ search: 'Wanda' }).set(A(admin)).expect(200);
    const row = live.body.find((r: { userId: string }) => r.userId === userId);
    expect(row).toEqual(expect.objectContaining({ status: 'ONLINE_ACTIVE', currentApp: 'YouTube', currentCategory: 'UNPRODUCTIVE', location: 'OFFICE' }));

    const day = await request(http).get(`/api/v1/workforce/users/${userId}/day`).set(A(emp)).expect(200);
    expect(day.body.timeline).toHaveLength(24);
    expect(day.body.apps.map((a: { label: string }) => a.label)).toEqual(expect.arrayContaining(['VS Code', 'GitHub', 'YouTube']));
    expect(JSON.stringify(day.body)).not.toContain('Secret PR title'); // window titles dropped by policy
    expect(day.body.clockEvents.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['CLOCK_IN', 'UNLOCK']));

    // scoping: employees cannot read the team board or other people
    await request(http).get('/api/v1/workforce/live').set(A(emp)).expect(403);
  });

  it('clock in/out', async () => {
    await request(http).post('/api/v1/workforce/clock').set(A(emp)).send({ type: 'CLOCK_IN' }).expect(409); // auto clock-in already
    const out = await request(http).post('/api/v1/workforce/clock').set(A(emp)).send({ type: 'CLOCK_OUT' }).expect(200);
    expect(out.body.clockOutAt).toBeTruthy();
    expect((await request(http).get('/api/v1/workforce/me').set(A(emp)).expect(200)).body.status).toBe('CLOCKED_OUT');
    await request(http).post('/api/v1/workforce/clock').set(A(emp)).send({ type: 'CLOCK_OUT' }).expect(409);
    // clocked out: the agent is told to stop and new segments are dropped
    const hb = await request(http).post('/api/v1/agent/heartbeat').set(agent()).send({ agentVersion: '1.1.0' }).expect(200);
    expect(hb.body.policy.workforce.clockedOut).toBe(true);
    const drop = await request(http)
      .post('/api/v1/agent/activity')
      .set(agent())
      .send({ osUser, segments: [{ startedAt: new Date(Date.now() + 1_000).toISOString(), endedAt: new Date(Date.now() + 3_000).toISOString(), active: true, app: 'Code', inputEvents: 3 }] })
      .expect(200);
    expect(drop.body.accepted).toBe(0);
    await request(http).post('/api/v1/workforce/clock').set(A(emp)).send({ type: 'CLOCK_IN', note: 'back' }).expect(200);
    await request(http).post('/api/v1/workforce/clock').set(A(emp)).send({ type: 'BREAK_START' }).expect(200);
    expect((await request(http).get('/api/v1/workforce/me').set(A(emp)).expect(200)).body.status).toBe('ON_BREAK');
    await request(http).post('/api/v1/workforce/clock').set(A(emp)).send({ type: 'BREAK_END' }).expect(200);
  });

  it('task start/stop timer', async () => {
    const t = await request(http).post('/api/v1/tasks').set(A(emp)).send({ title: 'E2E: write test plan', estimatedMinutes: 60 }).expect(201);
    taskId = t.body.id;
    expect(t.body.assignee.id).toBe(userId);
    // employees cannot assign tasks to others
    await request(http).post('/api/v1/tasks').set(A(emp)).send({ title: 'x', assigneeId: '00000000-0000-4000-8000-000000000000' }).expect(403);

    const started = await request(http).post(`/api/v1/tasks/${taskId}/start`).set(A(emp)).expect(200);
    expect(started.body).toEqual(expect.objectContaining({ taskId, endedAt: null, source: 'TIMER' }));
    const me = await request(http).get('/api/v1/workforce/me').set(A(emp)).expect(200);
    expect(me.body.runningTimer.taskId).toBe(taskId);
    const hb = await request(http).post('/api/v1/agent/heartbeat').set(agent()).send({ agentVersion: '1.1.0' }).expect(200);
    expect(hb.body.policy.workforce.currentTask).toEqual({ id: taskId, title: 'E2E: write test plan' });

    const stopped = await request(http).post('/api/v1/tasks/stop').set(A(emp)).expect(200);
    expect(stopped.body.endedAt).toBeTruthy();
    await request(http).post('/api/v1/tasks/stop').set(A(emp)).expect(409);
    const list = await request(http).get('/api/v1/tasks').query({ mine: 'true' }).set(A(emp)).expect(200);
    expect(list.body.data.find((x: { id: string }) => x.id === taskId)).toEqual(expect.objectContaining({ status: 'IN_PROGRESS', estimatedMinutes: 60, variancePercent: expect.any(Number) }));
  });

  it('daily report: 422 on vague text, then submits', async () => {
    const date = localToday();
    const draft = await request(http).get(`/api/v1/daily-reports/me/${date}`).set(A(emp)).expect(200);
    expect(draft.body.autoDraft.tasks.map((x: { taskId: string }) => x.taskId)).toContain(taskId);

    await request(http)
      .put(`/api/v1/daily-reports/me/${date}`)
      .set(A(emp))
      .send({ items: [{ taskId, taskTitle: 'E2E: write test plan', workCompleted: 'working on tasks and misc stuff', result: 'done' }] })
      .expect(200);
    const bad = await request(http).post(`/api/v1/daily-reports/me/${date}/submit`).set(A(emp)).send({}).expect(422);
    expect(bad.body.message).toEqual(expect.arrayContaining([expect.stringMatching(/Item 1: workCompleted is too vague/), expect.stringMatching(/blocker or nextAction is required/)]));

    const ok = await request(http)
      .post(`/api/v1/daily-reports/me/${date}/submit`)
      .set(A(emp))
      .send({
        summary: 'Test planning for the workforce module',
        items: [{ taskId, taskTitle: 'E2E: write test plan', workCompleted: 'Drafted the e2e test plan covering ingest, clock and reports', result: 'Plan shared with the team', nextAction: 'Review with QA lead' }],
      })
      .expect(200);
    expect(ok.body.status).toBe('SUBMITTED');
    await request(http).put(`/api/v1/daily-reports/me/${date}`).set(A(emp)).send({ items: [] }).expect(409);
  });

  it('screenshot upload is rejected while screenshots are disabled; accepted + audited once enabled', async () => {
    const upload = (blurred: string) =>
      request(http)
        .post('/api/v1/agent/screenshots')
        .set(agent())
        .field('capturedAt', new Date().toISOString())
        .field('osUser', osUser)
        .field('activeApp', 'Code')
        .field('blurred', blurred)
        .attach('image', JPEG, { filename: 's.jpg', contentType: 'image/jpeg' });

    const denied = await upload('true').expect(409);
    expect(denied.body.message).toMatch(/disabled/);

    await request(http).patch(`/api/v1/workforce/policies/${policyId}`).set(A(admin)).send({ screenshotsEnabled: true, screenshotBlur: true }).expect(200);
    await upload('false').expect(409); // blur required
    const ok = await upload('true');
    expect([ok.status, ok.body.message]).toEqual([201, undefined]);
    expect(ok.body.id).toBeDefined();

    // not a JPEG
    await request(http)
      .post('/api/v1/agent/screenshots')
      .set(agent())
      .field('capturedAt', new Date().toISOString())
      .field('osUser', osUser)
      .field('blurred', 'true')
      .attach('image', Buffer.from('\x89PNG\r\n\x1a\nxxxx'), { filename: 's.png', contentType: 'image/png' })
      .expect(422);

    const list = await request(http).get('/api/v1/workforce/screenshots').query({ userId }).set(A(emp)).expect(200);
    expect(list.body).toEqual([expect.objectContaining({ id: ok.body.id, width: 800, height: 600, blurred: true })]);
    const img = await request(http).get(`/api/v1/workforce/screenshots/${ok.body.id}/image`).set(A(emp)).expect(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(img.headers['cache-control']).toBe('no-store');
    expect(Buffer.compare(img.body as Buffer, JPEG)).toBe(0);
    const audit = await request(http).get('/api/v1/audit').query({ action: 'workforce.screenshot.view', resourceId: ok.body.id }).set(A(admin)).expect(200);
    expect(audit.body.meta.total).toBeGreaterThanOrEqual(1);
    await request(http).delete(`/api/v1/workforce/screenshots/${ok.body.id}`).set(A(emp)).expect(204);
  });

  it('attendance correction, monthly sheet and AI status', async () => {
    const sessions = await request(http).get('/api/v1/workforce/attendance').query({ userId }).set(A(admin)).expect(200);
    expect(sessions.body.meta.total).toBe(1);
    const fixed = await request(http)
      .patch(`/api/v1/workforce/attendance/${sessions.body.data[0].id}`)
      .set(A(admin))
      .send({ location: 'REMOTE', note: 'Worked from client site' })
      .expect(200);
    expect(fixed.body).toEqual(expect.objectContaining({ location: 'REMOTE', isManuallyAdjusted: true }));
    await request(http).patch(`/api/v1/workforce/attendance/${sessions.body.data[0].id}`).set(A(emp)).send({ note: 'self edit' }).expect(403);
    const month = localToday().substring(0, 7);
    const sheet = await request(http).get('/api/v1/workforce/attendance/monthly').query({ month }).set(A(emp)).expect(200);
    expect(sheet.body.rows).toHaveLength(1); // employees only see themselves
    const csv = await request(http).get('/api/v1/workforce/attendance/export').query({ month, format: 'csv' }).set(A(emp)).expect(200);
    expect(csv.text).toContain('Wanda Force');
    const ai = await request(http).get('/api/v1/ai/status').set(A(emp)).expect(200);
    expect(ai.body).toEqual(expect.objectContaining({ enabled: !!process.env.ANTHROPIC_API_KEY, model: expect.any(String) }));
  });
});
