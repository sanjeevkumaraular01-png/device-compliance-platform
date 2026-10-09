import { BadRequestException, ConflictException } from '@nestjs/common';
import { NoticeService, acknowledgementStatus } from './notice.service';

function makeService(current: { version: number; title: string; body: string } | null, existingAck: unknown = null) {
  const prisma = {
    monitoringNotice: {
      findFirst: jest.fn(async () => current),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ createdAt: new Date(), ...data })),
    },
    policyAcknowledgement: {
      findUnique: jest.fn(async () => existingAck),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ack-1', ...data })),
    },
  };
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new NoticeService(prisma as never, audit as never);
  return { svc, prisma, audit };
}

const ACTOR = { id: 'admin-1', roleKey: 'SUPER_ADMIN' } as never;
const V2 = { version: 2, title: 'Monitoring notice', body: 'We collect device inventory and security status.' };

describe('acknowledgementStatus', () => {
  it.each([
    [null, null, 'NOT_REQUIRED'],
    [3, null, 'NOT_REQUIRED'],
    [null, 2, 'NONE'],
    [1, 2, 'OUTDATED'],
    [2, 2, 'SIGNED'],
  ])('signed=%p current=%p -> %s', (signed, current, expected) => {
    expect(acknowledgementStatus(signed as number | null, current as number | null)).toBe(expected);
  });
});

describe('NoticeService.publish', () => {
  it('creates version 1 when none exists and audits it', async () => {
    const { svc, prisma, audit } = makeService(null);
    const n = await svc.publish({ title: ' Notice ', body: ' Body text that is long enough ' }, ACTOR);
    expect(n.version).toBe(1);
    expect((prisma.monitoringNotice.create as jest.Mock).mock.calls[0][0].data).toMatchObject({ title: 'Notice', body: 'Body text that is long enough' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'hr.notice.publish' }));
  });

  it('bumps the version instead of editing the old text', async () => {
    const { svc } = makeService(V2);
    expect((await svc.publish({ title: V2.title, body: `${V2.body} Updated.` }, ACTOR)).version).toBe(3);
  });

  it('refuses to publish an identical text', async () => {
    const { svc } = makeService(V2);
    await expect(svc.publish({ title: V2.title, body: V2.body }, ACTOR)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('NoticeService.acknowledge', () => {
  it('fails when no notice is published', async () => {
    const { svc } = makeService(null);
    await expect(svc.acknowledge('u1', { noticeVersion: 1, signedName: 'Jane Doe' }, 'INSTALL', null, null)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a signature for a version the employee did not see', async () => {
    const { svc, prisma } = makeService(V2);
    await expect(svc.acknowledge('u1', { noticeVersion: 1, signedName: 'Jane Doe' }, 'INSTALL', null, null)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.policyAcknowledgement.create).not.toHaveBeenCalled();
  });

  it('requires a typed name', async () => {
    const { svc } = makeService(V2);
    await expect(svc.acknowledge('u1', { noticeVersion: 2, signedName: ' x ' }, 'INSTALL', null, null)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores version, normalised name, method, IP and browser, and audits it', async () => {
    const { svc, prisma, audit } = makeService(V2);
    await svc.acknowledge('u1', { noticeVersion: 2, signedName: '  Jane   Doe ' }, 'INSTALL', '9.9.9.9', 'Mozilla/5.0');
    expect((prisma.policyAcknowledgement.create as jest.Mock).mock.calls[0][0].data).toEqual({
      userId: 'u1', noticeVersion: 2, signedName: 'Jane Doe', method: 'INSTALL', ipAddress: '9.9.9.9', userAgent: 'Mozilla/5.0',
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'hr.notice.acknowledge', actorId: 'u1' }));
  });

  it('is idempotent per version: the first signature is kept', async () => {
    const first = { id: 'ack-0', noticeVersion: 2, signedName: 'Jane Doe' };
    const { svc, prisma } = makeService(V2, first);
    expect(await svc.acknowledge('u1', { noticeVersion: 2, signedName: 'Jane D' }, 'WEB', null, null)).toBe(first);
    expect(prisma.policyAcknowledgement.create).not.toHaveBeenCalled();
  });
});
