import { BadRequestException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { DeployService } from './deploy.service';

type Notice = { version: number; title: string; body: string };

function makeService(
  over: Partial<{ user: unknown; enabled: boolean; notice: Notice | null; apiPublicUrl: string }> = {},
) {
  const tokens: Record<string, unknown> = {};
  const prisma = {
    systemSetting: { findMany: jest.fn(async () => []), upsert: jest.fn() },
    user: { findFirst: jest.fn(async () => over.user ?? null) },
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
  const server = over.apiPublicUrl ?? 'https://sem.acme.com';
  const config = {
    deployEnabledEnv: over.enabled ?? true,
    deployCompanyName: 'Acme',
    deployAllowedDomains: [],
    deployImapHost: '',
    deployImapPort: 993,
    deployImapSecure: true,
    deploySessionTtlMin: 20,
    deployDownloadBaseUrl: `${server}/downloads`,
    apiPublicUrl: server,
    webUrl: server,
  };
  const audit = { log: jest.fn(async () => undefined) };
  const mail = { verify: jest.fn() };
  const notices = {
    current: jest.fn(async () => over.notice ?? null),
    acknowledge: jest.fn(async () => ({ id: 'ack-1' })),
  };
  const svc = new DeployService(prisma as never, config as never, audit as never, mail as never, notices as never);
  return { svc, prisma, audit, notices };
}

const JANE = { id: 'u-1', email: 'jane@acme.com', displayName: 'Jane Doe', departmentId: 'd1', isActive: true, employeeCode: 'CSS0004' };
const NOTICE: Notice = { version: 3, title: 'Device monitoring notice', body: 'We collect device inventory and security status.' };

describe('DeployService (Employee ID self-enrollment)', () => {
  it('rejects an unknown Employee ID and issues no token', async () => {
    const { svc, prisma } = makeService();
    await expect(svc.createSession('CSS9999', '1.1.1.1')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.enrollmentToken.create).not.toHaveBeenCalled();
  });

  it('rejects an inactive employee', async () => {
    const { svc } = makeService({ user: { ...JANE, isActive: false } });
    await expect(svc.createSession('CSS0004', null)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('is unavailable when self-service enrollment is disabled', async () => {
    const { svc } = makeService({ user: JANE, enabled: false });
    await expect(svc.createSession('CSS0004', null)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('looks the Employee ID up trimmed and case-insensitively', async () => {
    const { svc, prisma } = makeService({ user: JANE });
    await svc.createSession('  css0004 ', null);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { employeeCode: { equals: 'css0004', mode: 'insensitive' } } });
  });

  it('mints a single-use, admin-approved Windows token bound to the employee', async () => {
    const { svc, prisma } = makeService({ user: JANE });
    const res = await svc.createSession('CSS0004', '1.1.1.1');
    expect(res.deployToken).toMatch(/^sem_enr_/);
    expect(res.employee.email).toBe('jane@acme.com');
    const data = (prisma.enrollmentToken.create as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ maxUses: 1, autoApprove: false, platform: 'WINDOWS', assignToUserId: 'u-1' });
    expect(res.setupUrl).toContain(encodeURIComponent(res.deployToken));
  });

  describe('monitoring notice acknowledgement', () => {
    it('refuses to issue a link until the published notice is accepted', async () => {
      const { svc, prisma, notices } = makeService({ user: JANE, notice: NOTICE });
      await expect(svc.createSession('CSS0004', null)).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        svc.createSession('CSS0004', null, { noticeVersion: 3, signedName: 'Jane Doe', accepted: false }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(notices.acknowledge).not.toHaveBeenCalled();
      expect(prisma.enrollmentToken.create).not.toHaveBeenCalled();
    });

    it('records the signature (version, name, IP, browser) before issuing the link', async () => {
      const { svc, prisma, notices } = makeService({ user: JANE, notice: NOTICE });
      const ack = { noticeVersion: 3, signedName: 'Jane Doe', accepted: true };
      const res = await svc.createSession('CSS0004', '9.9.9.9', ack, 'Mozilla/5.0');
      expect(notices.acknowledge).toHaveBeenCalledWith('u-1', ack, 'INSTALL', '9.9.9.9', 'Mozilla/5.0');
      expect(prisma.enrollmentToken.create).toHaveBeenCalledTimes(1);
      expect(res.deployToken).toMatch(/^sem_enr_/);
    });

    it('does not require an acknowledgement when no notice is published', async () => {
      const { svc, notices } = makeService({ user: JANE, notice: null });
      await svc.createSession('CSS0004', null);
      expect(notices.acknowledge).not.toHaveBeenCalled();
    });

    it('publishes the current notice on the public /install config', async () => {
      const { svc } = makeService({ notice: NOTICE });
      expect((await svc.publicConfig()).notice).toEqual({ version: 3, title: NOTICE.title, body: NOTICE.body });
      const { svc: none } = makeService({ notice: null });
      expect((await none.publicConfig()).notice).toBeNull();
    });
  });

  describe('setup.cmd', () => {
    it('embeds the one-time token + server, downloads the agent .exe, and rejects an unknown token', async () => {
      const { svc } = makeService({ user: JANE });
      const res = await svc.createSession('CSS0004', null);
      const cmd = await svc.setupCmd(res.deployToken);
      expect(cmd).toContain(res.deployToken);
      expect(cmd).toContain('set "SERVER=https://sem.acme.com"');
      expect(cmd).toContain('sem-agent-windows-%ARCH%.exe');
      expect(cmd).toContain('curl.exe');
      expect(cmd).not.toContain('msiexec');
      await expect(svc.setupCmd('sem_enr_unknown')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('never skips TLS verification for a public hostname', async () => {
      const { svc } = makeService({ user: JANE, apiPublicUrl: 'https://sem.163-227-190-66.sslip.io' });
      const cmd = await svc.setupCmd((await svc.createSession('CSS0004', null)).deployToken);
      expect(cmd).not.toContain('--insecure-skip-verify');
      expect(cmd).not.toContain('ServerCertificateValidationCallback');
      expect(cmd).not.toMatch(/curl\.exe -fSL -k/);
    });

    it('trusts the self-signed cert only for localhost / private LAN addresses', async () => {
      for (const url of ['https://localhost', 'https://10.1.0.239', 'https://192.168.1.5', 'https://172.20.0.4']) {
        const { svc } = makeService({ user: JANE, apiPublicUrl: url });
        const cmd = await svc.setupCmd((await svc.createSession('CSS0004', null)).deployToken);
        expect(cmd).toContain('--insecure-skip-verify');
        expect(cmd).toMatch(/curl\.exe -fSL -k/);
      }
      // 172.32.x is outside 172.16/12 → public
      const { svc } = makeService({ user: JANE, apiPublicUrl: 'https://172.32.0.1' });
      expect(await svc.setupCmd((await svc.createSession('CSS0004', null)).deployToken)).not.toContain('--insecure-skip-verify');
    });
  });

  it('status walks PENDING_DOWNLOAD -> device state', async () => {
    const { svc, prisma } = makeService({ user: JANE });
    const res = await svc.createSession('CSS0004', null);
    expect((await svc.status(res.deployToken)).state).toBe('PENDING_DOWNLOAD');

    (prisma.enrollmentToken.findUnique as jest.Mock).mockImplementationOnce(async () => ({
      id: 'tok-1', assignToUserId: 'u-1', usedCount: 1, maxUses: 1, revokedAt: null, createdAt: new Date(), expiresAt: new Date(Date.now() + 1e6),
    }));
    (prisma.device.findFirst as jest.Mock).mockImplementationOnce(async () => ({
      deviceName: 'DESKTOP-ABC', osName: 'Windows 11', osVersion: '24H2', status: 'PENDING', lastSeenAt: new Date(), complianceState: 'UNKNOWN',
    }));
    const s = await svc.status(res.deployToken);
    expect(s.state).toBe('ENROLLED_PENDING_APPROVAL');
    expect(s.device?.name).toBe('DESKTOP-ABC');
  });
});
