import { auditCanonical, computeAuditHash, normalizeAuditEntry, verifyAuditChain, AuditHashFields } from './audit-chain';
import { createHash } from 'crypto';

function row(action: string, extra: Partial<AuditHashFields> = {}): AuditHashFields {
  return normalizeAuditEntry({
    category: 'USER_ACTION',
    action,
    actorType: 'USER',
    actorId: 'u1',
    actorName: 'admin@example.com',
    resourceType: 'Device',
    resourceId: 'd1',
    ipAddress: '10.0.0.1',
    before: { b: 1, a: [1, 2] },
    after: { z: 'x', y: { k: true } },
    occurredAt: new Date('2026-09-25T10:00:00.123Z'),
    ...extra,
  } as never);
}

/** Minimal in-memory stand-in for prisma.auditLog used by verifyAuditChain. */
function fakePrisma(rows: (AuditHashFields & { id: bigint; prevHash: string | null; hash: string })[]) {
  return {
    auditLog: {
      findMany: async ({ where, take }: { where: { id?: { gt: bigint } }; take: number }) =>
        rows.filter((r) => !where.id || r.id > where.id.gt).slice(0, take),
    },
  } as never;
}

function buildChain(n: number) {
  const out: (AuditHashFields & { id: bigint; prevHash: string | null; hash: string })[] = [];
  let prev: string | null = null;
  for (let i = 1; i <= n; i++) {
    const r = row(`action.${i}`);
    const hash = computeAuditHash(prev, r);
    out.push({ ...r, id: BigInt(i), prevHash: prev, hash });
    prev = hash;
  }
  return out;
}

describe('audit hash chain', () => {
  it('hash = sha256(prevHash + canonicalJSON(row))', () => {
    const r = row('device.update');
    const expected = createHash('sha256').update('abc' + auditCanonical(r)).digest('hex');
    expect(computeAuditHash('abc', r)).toBe(expected);
    expect(computeAuditHash(null, r)).toBe(createHash('sha256').update(auditCanonical(r)).digest('hex'));
  });

  it('canonical JSON is independent of key order (jsonb round trip safe)', () => {
    const a = row('x', { after: { b: 1, a: { d: 2, c: 3 } } });
    const b = row('x', { after: { a: { c: 3, d: 2 }, b: 1 } });
    expect(auditCanonical(a)).toBe(auditCanonical(b));
    expect(computeAuditHash('p', a)).toBe(computeAuditHash('p', b));
  });

  it('any field change alters the hash', () => {
    const base = row('x');
    const h = computeAuditHash('p', base);
    expect(computeAuditHash('p', { ...base, success: false })).not.toBe(h);
    expect(computeAuditHash('p', { ...base, actorId: 'u2' })).not.toBe(h);
    expect(computeAuditHash('q', base)).not.toBe(h);
  });

  it('normalization makes values JSON-safe and drops invalid device ids', () => {
    const r = normalizeAuditEntry({ category: 'SYSTEM', action: 'a', deviceId: 'not-a-uuid', after: { n: BigInt(5), d: new Date(0) } });
    expect(r.deviceId).toBeNull();
    expect(r.after).toEqual({ n: '5', d: '1970-01-01T00:00:00.000Z' });
    expect(r.actorType).toBe('SYSTEM');
    expect(r.success).toBe(true);
  });

  it('verify accepts an intact chain', async () => {
    const chain = buildChain(25);
    await expect(verifyAuditChain(fakePrisma(chain), 7)).resolves.toEqual({ valid: true, checked: 25, brokenAt: null });
  });

  it('verify detects a modified row', async () => {
    const chain = buildChain(10);
    chain[6] = { ...chain[6], action: 'tampered' };
    await expect(verifyAuditChain(fakePrisma(chain), 4)).resolves.toEqual({ valid: false, checked: 6, brokenAt: '7' });
  });

  it('verify detects a deleted row', async () => {
    const chain = buildChain(10);
    chain.splice(3, 1);
    const res = await verifyAuditChain(fakePrisma(chain));
    expect(res.valid).toBe(false);
    expect(res.brokenAt).toBe('5');
  });

  it('verify detects a re-hashed forged row (prevHash linkage)', async () => {
    const chain = buildChain(5);
    const forged = { ...chain[2], action: 'forged' };
    forged.hash = computeAuditHash('0'.repeat(64), forged);
    forged.prevHash = '0'.repeat(64);
    chain[2] = forged;
    const res = await verifyAuditChain(fakePrisma(chain));
    expect(res).toEqual({ valid: false, checked: 2, brokenAt: '3' });
  });

  it('empty chain is valid', async () => {
    await expect(verifyAuditChain(fakePrisma([]))).resolves.toEqual({ valid: true, checked: 0, brokenAt: null });
  });
});
