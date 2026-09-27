import { ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { DeployService } from './deploy.service';
import type { VerifyResult } from './mail-verifier';

function makeService(over: Partial<{ imapHost: string; allowedDomains: string[]; verify: VerifyResult; user: unknown }> = {}) {
  const settings = new Map<string, unknown>();
  const tokens: Record<string, unknown> = {};
  const prisma = {
    systemSetting: {
      findMany: jest.fn(async () => [...settings.entries()].map(([key, value]) => ({ key, value }))),
      upsert: jest.fn(async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => {
        settings.set(where.key, create.value);
      }),
    },
    user: {
      findUnique: jest.fn(async () => over.user ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'u-new', departmentId: null, ...data })),
    },
    role: { findUniqueOrThrow: jest.fn(async () => ({ id: 'role-emp', key: 'EMPLOYEE' })) },
    enrollmentToken: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'tok-1', usedCount: 0, revokedAt: null, maxUses: 1, createdAt: new Date(), ...data };
        tokens[data.tokenHash as string] = row;
        return row;
      }),
      findUnique: jest.fn(async ({ where }: { where: { tokenHash: string } }) => tokens[where.tokenHash] ?? null),
    },
    device: { findFirst: jest.fn(async () => null) },
  };
  const config = {
    deployEnabledEnv: true,
    deployCompanyName: 'Acme',
    deployAllowedDomains: over.allowedDomains ?? ['acme.com'],
    deployImapHost: over.imapHost ?? 'imap.acme.com',
    deployImapPort: 993,
    deployImapSecure: true,
    deploySessionTtlMin: 20,
    deployDownloadBaseUrl: 'https://sem.acme.com/downloads',
    apiPublicUrl: 'https://sem.acme.com',
    webUrl: 'https://sem.acme.com',
  };
  const audit = { log: jest.fn(async () => undefined) };
  const mail = { verify: jest.fn(async (): Promise<VerifyResult> => over.verify ?? 'OK') };
  const svc = new DeployService(prisma as never, config as never, audit as never, mail as never);
  return { svc, prisma, mail, audit };
}

describe('DeployService', () => {
  it('rejects a disallowed email domain before ever contacting the mail server', async () => {
    const { svc, mail } = makeService();
    await expect(svc.createSession('jane@evil.com', 'pw', '1.1.1.1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(mail.verify).not.toHaveBeenCalled();
  });

  it('rejects invalid credentials', async () => {
    const { svc } = makeService({ verify: 'INVALID_CREDENTIALS' });
    await expect(svc.createSession('jane@acme.com', 'wrong', null)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('surfaces an unreachable mail server as 503, not a wrong password', async () => {
    const { svc } = makeService({ verify: 'UNAVAILABLE' });
    await expect(svc.createSession('jane@acme.com', 'pw', null)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('is unavailable when IMAP host is not configured', async () => {
    const { svc } = makeService({ imapHost: '' });
    await expect(svc.createSession('jane@acme.com', 'pw', null)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('mints a single-use Windows token bound to the employee on success', async () => {
    const { svc, prisma } = makeService();
    const res = await svc.createSession('Jane.Doe@ACME.com', 'pw', '1.1.1.1');
    expect(res.deployToken).toMatch(/^sem_enr_/);
    expect(res.employee.email).toBe('jane.doe@acme.com');
    const data = (prisma.enrollmentToken.create as jest.Mock).mock.calls[0][0].data;
    expect(data.maxUses).toBe(1);
    expect(data.autoApprove).toBe(false);
    expect(data.platform).toBe('WINDOWS');
    expect(data.assignToUserId).toBe('u-new');
    expect(res.setupUrl).toContain(encodeURIComponent(res.deployToken));
  });

  it('reuses an existing user instead of creating a duplicate', async () => {
    const { svc, prisma } = makeService({ user: { id: 'u-1', email: 'jane@acme.com', displayName: 'Jane', departmentId: 'd1', isActive: true } });
    const res = await svc.createSession('jane@acme.com', 'pw', null);
    expect(res.employee.displayName).toBe('Jane');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('setup.cmd embeds the one-time token + server and rejects an unknown token', async () => {
    const { svc } = makeService();
    const res = await svc.createSession('jane@acme.com', 'pw', null);
    const cmd = await svc.setupCmd(res.deployToken);
    expect(cmd).toContain(res.deployToken);
    expect(cmd).toContain('https://sem.acme.com');
    expect(cmd).toContain('msiexec /i');
    expect(cmd).toContain('DEPLOY_TOKEN=');
    await expect(svc.setupCmd('sem_enr_unknown')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('status walks PENDING_DOWNLOAD -> device state', async () => {
    const { svc, prisma } = makeService();
    const res = await svc.createSession('jane@acme.com', 'pw', null);
    expect((await svc.status(res.deployToken)).state).toBe('PENDING_DOWNLOAD');

    // simulate the token being consumed by enroll
    const row = (prisma.enrollmentToken.findUnique as jest.Mock).mock.results.length;
    void row;
    (prisma.enrollmentToken.findUnique as jest.Mock).mockImplementationOnce(async () => ({
      id: 'tok-1', assignToUserId: 'u-new', usedCount: 1, maxUses: 1, revokedAt: null, createdAt: new Date(), expiresAt: new Date(Date.now() + 1e6),
    }));
    (prisma.device.findFirst as jest.Mock).mockImplementationOnce(async () => ({
      deviceName: 'DESKTOP-ABC', osName: 'Windows 11', osVersion: '24H2', status: 'PENDING', lastSeenAt: new Date(), complianceState: 'UNKNOWN',
    }));
    const s = await svc.status(res.deployToken);
    expect(s.state).toBe('ENROLLED_PENDING_APPROVAL');
    expect(s.device?.name).toBe('DESKTOP-ABC');
  });
});
