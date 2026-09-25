/**
 * End-to-end: boots the full Nest app against the real database/Redis
 * (DATABASE_URL / REDIS_URL, migrated and seeded) and exercises
 * login -> devices list -> agent enroll -> agent report -> compliance result.
 */
import { INestApplication } from '@nestjs/common';
import * as forge from 'node-forge';
import request from 'supertest';
import { createApp } from '../src/main';

describe('SecureEndpoint Manager (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let accessToken: string;
  let deviceId: string;
  let agentToken: string;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@secureendpoint.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!Secure2026';
  const serial = `E2E-${Date.now()}`;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/v1/health', async () => {
    const res = await request(http).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('rejects unauthenticated console requests with the contract error shape', async () => {
    const res = await request(http).get('/api/v1/devices').expect(401);
    expect(res.body).toEqual(
      expect.objectContaining({ statusCode: 401, error: 'Unauthorized', path: '/api/v1/devices', requestId: expect.any(String) }),
    );
  });

  it('POST /api/v1/auth/login', async () => {
    const res = await request(http).post('/api/v1/auth/login').send({ email: adminEmail, password: adminPassword }).expect(200);
    expect(res.body.mfaRequired).toBe(false);
    expect(res.body.user.role).toBe('SUPER_ADMIN');
    accessToken = res.body.accessToken;
  });

  it('GET /api/v1/devices returns the paginated envelope', async () => {
    const res = await request(http)
      .get('/api/v1/devices?page=1&pageSize=10')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.meta).toEqual(expect.objectContaining({ page: 1, pageSize: 10, total: expect.any(Number), totalPages: expect.any(Number) }));
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('agent enrolls with an enrollment token and RSA CSR', async () => {
    const tok = await request(http)
      .post('/api/v1/enrollment/tokens')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'e2e', maxUses: 2, expiresInDays: 1 })
      .expect(201);
    expect(tok.body.token).toMatch(/^sem_enr_/);

    const keys = forge.pki.rsa.generateKeyPair(2048);
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = keys.publicKey;
    csr.setSubject([{ name: 'commonName', value: serial }]);
    csr.sign(keys.privateKey, forge.md.sha256.create());

    const res = await request(http)
      .post('/api/v1/agent/enroll')
      .send({
        enrollmentToken: tok.body.token,
        csrPem: forge.pki.certificationRequestToPem(csr),
        agentVersion: '1.0.0',
        hardware: { hostname: 'e2e-host', serialNumber: serial, platform: 'LINUX', osName: 'Ubuntu 24.04 LTS', ramMb: 16384 },
      })
      .expect(201);
    expect(res.body.agentToken).toMatch(/^sem_agt_/);
    expect(res.body.certificatePem).toContain('BEGIN CERTIFICATE');
    expect(res.body.policy.policyId).toBeDefined();
    deviceId = res.body.deviceId;
    agentToken = res.body.agentToken;
  });

  it('agent heartbeat returns policy and commands', async () => {
    const res = await request(http)
      .post('/api/v1/agent/heartbeat')
      .set('Authorization', `Bearer ${agentToken}`)
      .set('X-Device-Id', deviceId)
      .send({ agentVersion: '1.0.0' })
      .expect(200);
    expect(res.body.policyVersion).toEqual(expect.any(Number));
    expect(Array.isArray(res.body.commands)).toBe(true);
  });

  it('agent report is evaluated by the compliance engine', async () => {
    const now = new Date();
    const res = await request(http)
      .post('/api/v1/agent/report')
      .set('Authorization', `Bearer ${agentToken}`)
      .set('X-Device-Id', deviceId)
      .send({
        collectedAt: now.toISOString(),
        hardware: { hostname: 'e2e-host', serialNumber: serial, platform: 'LINUX' },
        security: {
          antivirusState: 'ENABLED',
          antivirusSignatureAt: now.toISOString(),
          edrState: 'ENABLED',
          firewallState: 'DISABLED',
          diskEncryptionState: 'ENABLED',
          secureBootState: 'ENABLED',
          screenLockEnabled: true,
          screenLockTimeoutSec: 120,
          passwordOnWake: true,
          autoUpdateEnabled: true,
          usbStorageEnabled: false,
        },
        software: [{ name: 'git', version: '2.43.0', publisher: 'Canonical Ltd.', source: 'dpkg' }],
        patches: [],
      })
      .expect(200);
    expect(res.body.complianceState).toBe('NON_COMPLIANT');
    expect(res.body.complianceScore).toBe(90);
    expect(res.body.riskLevel).toBe('HIGH');
    const failing = res.body.findings.filter((f: { passed: boolean }) => !f.passed).map((f: { ruleKey: string }) => f.ruleKey);
    expect(failing).toEqual(['FIREWALL_DISABLED']);
  });

  it('console sees the new compliance result', async () => {
    const res = await request(http)
      .get(`/api/v1/devices/${deviceId}/compliance`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body[0]).toEqual(expect.objectContaining({ deviceId, state: 'NON_COMPLIANT', score: 90 }));
    const detail = await request(http).get(`/api/v1/devices/${deviceId}`).set('Authorization', `Bearer ${accessToken}`).expect(200);
    expect(detail.body.complianceState).toBe('NON_COMPLIANT');
    expect(detail.body.securityStatus.firewallState).toBe('DISABLED');
  });

  it('audit chain stays valid', async () => {
    const res = await request(http).get('/api/v1/audit/verify').set('Authorization', `Bearer ${accessToken}`).expect(200);
    expect(res.body.valid).toBe(true);
  });

  it('retires the e2e device (revokes agent token)', async () => {
    await request(http).delete(`/api/v1/devices/${deviceId}`).set('Authorization', `Bearer ${accessToken}`).expect(204);
    await request(http)
      .post('/api/v1/agent/heartbeat')
      .set('Authorization', `Bearer ${agentToken}`)
      .set('X-Device-Id', deviceId)
      .send({ agentVersion: '1.0.0' })
      .expect(401);
  });
});
