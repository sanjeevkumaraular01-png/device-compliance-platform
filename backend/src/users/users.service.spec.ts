import { UsersService } from './users.service';

type Where = { AND: Record<string, unknown>[] };

function makeService(counter: (where: Where) => number) {
  const prisma = { user: { count: jest.fn(async ({ where }: { where: Where }) => counter(where)) } };
  const svc = new UsersService(prisma as never, {} as never, {} as never, {} as never);
  return { svc, prisma };
}

describe('UsersService.summary', () => {
  it('derives inactive from total minus active and returns every count', async () => {
    const { svc } = makeService(({ AND: [, extra] }) => {
      if (!extra || Object.keys(extra).length === 0) return 10;
      if ('mfaEnabled' in extra) return 3;
      if ('employeeCode' in extra) return 2;
      if ('lockedUntil' in extra) return 1;
      return 8; // isActive only
    });
    await expect(svc.summary({ id: 'a', roleKey: 'SUPER_ADMIN' } as never)).resolves.toEqual({
      total: 10,
      active: 8,
      inactive: 2,
      mfaEnabled: 3,
      missingEmployeeCode: 2,
      locked: 1,
    });
  });

  it('applies the caller row scope to every count', async () => {
    const { svc, prisma } = makeService(() => 0);
    await svc.summary({ id: 'emp-1', roleKey: 'EMPLOYEE' } as never);
    expect(prisma.user.count).toHaveBeenCalledTimes(5);
    for (const [arg] of prisma.user.count.mock.calls) {
      expect((arg as { where: Where }).where.AND[0]).toEqual({ id: 'emp-1' });
    }
  });
});
