import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { HrService } from './hr.service';

type Emp = {
  id: string;
  email: string;
  displayName: string;
  employeeCode: string | null;
  isActive: boolean;
  role: { key: string };
  assignedDevices: { id: string; deviceName: string }[];
};

function makeService(emp: Emp | null, opts: { smtp?: boolean; retireFails?: string[] } = {}) {
  const prisma = {
    user: { findFirst: jest.fn(async () => emp) },
    enrollmentToken: { updateMany: jest.fn(async () => ({ count: 2 })) },
  };
  const audit = { log: jest.fn(async () => undefined) };
  const config = { webUrl: 'https://sem.acme.com', smtpConfigured: opts.smtp ?? false };
  const notifier = { sendEmail: jest.fn(async () => undefined) };
  const users = { deactivate: jest.fn(async () => undefined) };
  const devices = {
    retire: jest.fn(async (id: string) => {
      if (opts.retireFails?.includes(id)) throw new Error('boom');
    }),
  };
  const notices = { current: jest.fn(async () => null) };
  const svc = new HrService(prisma as never, audit as never, config as never, notifier as never, users as never, devices as never, notices as never);
  return { svc, prisma, audit, notifier, users, devices };
}

const ADMIN = { id: 'admin-1', roleKey: 'SUPER_ADMIN' } as never;
const IT = { id: 'it-1', roleKey: 'IT_ADMIN' } as never;
const emp = (over: Partial<Emp> = {}): Emp => ({
  id: 'u-1',
  email: 'ravi@acme.com',
  displayName: 'Ravi Kumar',
  employeeCode: 'CSS0001',
  isActive: true,
  role: { key: 'EMPLOYEE' },
  assignedDevices: [
    { id: 'd-1', deviceName: 'LAPTOP-1' },
    { id: 'd-2', deviceName: 'LAPTOP-2' },
  ],
  ...over,
});

describe('HrService.onboard', () => {
  it('requires an Employee ID before sending the link', async () => {
    const { svc } = makeService(emp({ employeeCode: null }));
    await expect(svc.onboard('u-1', {}, ADMIN)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('refuses inactive employees and unknown ids', async () => {
    await expect(makeService(emp({ isActive: false })).svc.onboard('u-1', {}, ADMIN)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(makeService(null).svc.onboard('u-x', {}, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the install link and instructions without emailing by default', async () => {
    const { svc, notifier, audit } = makeService(emp());
    const res = await svc.onboard('u-1', {}, ADMIN);
    expect(res).toMatchObject({ installUrl: 'https://sem.acme.com/install', employeeCode: 'CSS0001', emailed: false });
    expect(res.instructions).toContain('CSS0001');
    expect(notifier.sendEmail).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'hr.onboard' }));
  });

  it('explains when email is requested but SMTP is not configured', async () => {
    const { svc } = makeService(emp(), { smtp: false });
    await expect(svc.onboard('u-1', { sendEmail: true }, ADMIN)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('emails the employee when SMTP is configured', async () => {
    const { svc, notifier } = makeService(emp(), { smtp: true });
    expect((await svc.onboard('u-1', { sendEmail: true }, ADMIN)).emailed).toBe(true);
    expect(notifier.sendEmail).toHaveBeenCalledWith(['ravi@acme.com'], expect.objectContaining({ url: 'https://sem.acme.com/install' }));
  });
});

describe('HrService.offboard', () => {
  it('cannot offboard yourself', async () => {
    const { svc, devices, users } = makeService(emp({ id: 'admin-1' }));
    await expect(svc.offboard('admin-1', {}, ADMIN)).rejects.toBeInstanceOf(ForbiddenException);
    expect(devices.retire).not.toHaveBeenCalled();
    expect(users.deactivate).not.toHaveBeenCalled();
  });

  it('only a Super Admin can offboard a Super Admin, and nothing is changed on refusal', async () => {
    const { svc, devices, prisma } = makeService(emp({ role: { key: 'SUPER_ADMIN' } }));
    await expect(svc.offboard('u-1', {}, IT)).rejects.toBeInstanceOf(ForbiddenException);
    expect(devices.retire).not.toHaveBeenCalled();
    expect(prisma.enrollmentToken.updateMany).not.toHaveBeenCalled();
  });

  it('retires every device, revokes enrollment links, then deactivates', async () => {
    const { svc, devices, users, prisma, audit } = makeService(emp());
    const res = await svc.offboard('u-1', { reason: 'Resigned' }, ADMIN);
    expect(devices.retire).toHaveBeenCalledWith('d-1', false, ADMIN);
    expect(devices.retire).toHaveBeenCalledWith('d-2', false, ADMIN);
    expect(prisma.enrollmentToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { assignToUserId: 'u-1', revokedAt: null } }));
    expect(users.deactivate).toHaveBeenCalledWith('u-1', ADMIN);
    expect(res).toEqual({ deactivated: true, retiredDevices: ['LAPTOP-1', 'LAPTOP-2'], failedDevices: [], enrollmentLinksRevoked: 2 });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'hr.offboard' }));
  });

  it('still deactivates the account and reports devices that could not be retired', async () => {
    const { svc, users } = makeService(emp(), { retireFails: ['d-2'] });
    const res = await svc.offboard('u-1', {}, ADMIN);
    expect(res.retiredDevices).toEqual(['LAPTOP-1']);
    expect(res.failedDevices).toEqual([{ deviceName: 'LAPTOP-2', error: 'boom' }]);
    expect(users.deactivate).toHaveBeenCalled();
  });

  it('does not call deactivate again for an already inactive account', async () => {
    const { svc, users } = makeService(emp({ isActive: false, assignedDevices: [] }));
    await svc.offboard('u-1', {}, ADMIN);
    expect(users.deactivate).not.toHaveBeenCalled();
  });
});
