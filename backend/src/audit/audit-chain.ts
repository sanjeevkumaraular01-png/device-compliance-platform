import { ActorType, AuditCategory, Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { canonicalJson, toJsonSafe } from '../common/utils/canonical-json';

/** Advisory lock key serializing audit appends across all processes. */
export const AUDIT_LOCK_KEY = 0x5e3a_d17; // arbitrary constant

export interface AuditEntryInput {
  category: AuditCategory;
  action: string;
  actorType?: ActorType;
  actorId?: string | null;
  actorName?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  deviceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  success?: boolean;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  occurredAt?: Date;
}

/** Fields covered by the hash (everything except id, prevHash, hash). */
export interface AuditHashFields {
  occurredAt: Date | string;
  category: string;
  action: string;
  actorType: string;
  actorId: string | null;
  actorName: string | null;
  resourceType: string | null;
  resourceId: string | null;
  deviceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  success: boolean;
  before: unknown;
  after: unknown;
  metadata: unknown;
}

export function auditCanonical(row: AuditHashFields): string {
  return canonicalJson({
    occurredAt: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : new Date(row.occurredAt).toISOString(),
    category: row.category,
    action: row.action,
    actorType: row.actorType,
    actorId: row.actorId ?? null,
    actorName: row.actorName ?? null,
    resourceType: row.resourceType ?? null,
    resourceId: row.resourceId ?? null,
    deviceId: row.deviceId ?? null,
    ipAddress: row.ipAddress ?? null,
    userAgent: row.userAgent ?? null,
    success: row.success,
    before: row.before ?? null,
    after: row.after ?? null,
    metadata: row.metadata ?? null,
  });
}

/** hash = sha256(prevHash + canonicalJSON(row)) */
export function computeAuditHash(prevHash: string | null, row: AuditHashFields): string {
  return createHash('sha256').update((prevHash ?? '') + auditCanonical(row)).digest('hex');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normalise an entry to exactly what will be stored (JSON-safe, truncated strings). */
export function normalizeAuditEntry(e: AuditEntryInput): AuditHashFields {
  const trunc = (s: string | null | undefined, n: number) => (s == null ? null : String(s).substring(0, n));
  // occurredAt stored with millisecond precision
  const occurredAt = new Date(Math.floor((e.occurredAt ?? new Date()).getTime()));
  return {
    occurredAt,
    category: e.category,
    action: trunc(e.action, 128) as string,
    actorType: e.actorType ?? 'SYSTEM',
    actorId: trunc(e.actorId, 64),
    actorName: trunc(e.actorName, 256),
    resourceType: trunc(e.resourceType, 64),
    resourceId: trunc(e.resourceId, 128),
    deviceId: e.deviceId && UUID_RE.test(e.deviceId) ? e.deviceId : null,
    ipAddress: trunc(e.ipAddress, 64),
    userAgent: trunc(e.userAgent, 512),
    success: e.success ?? true,
    before: e.before === undefined ? null : toJsonSafe(e.before),
    after: e.after === undefined ? null : toJsonSafe(e.after),
    metadata: e.metadata === undefined ? null : toJsonSafe(e.metadata),
  };
}

type TxClient = Prisma.TransactionClient | PrismaClient;

const jsonOrNull = (v: unknown) => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue));

/**
 * Append one entry to the hash chain. Serialized with a transaction-scoped
 * Postgres advisory lock so concurrent writers (API + workers) never fork the chain.
 */
export async function appendAuditLog(prisma: TxClient, entry: AuditEntryInput): Promise<{ id: bigint; hash: string }> {
  const row = normalizeAuditEntry(entry);
  const write = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;
    const last = await tx.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { hash: true } });
    const prevHash = last?.hash ?? null;
    const hash = computeAuditHash(prevHash, row);
    const created = await (tx as TxClient).auditLog.create({
      data: {
        occurredAt: row.occurredAt as Date,
        category: row.category as AuditCategory,
        action: row.action,
        actorType: row.actorType as ActorType,
        actorId: row.actorId,
        actorName: row.actorName,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        deviceId: row.deviceId,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        success: row.success,
        before: jsonOrNull(row.before),
        after: jsonOrNull(row.after),
        metadata: jsonOrNull(row.metadata),
        prevHash,
        hash,
      },
      select: { id: true, hash: true },
    });
    return created;
  };
  // Already inside a transaction (e.g. the demo seed): the xact lock is held until it commits.
  return '$transaction' in prisma ? prisma.$transaction(write) : write(prisma);
}

export interface VerifyResult {
  valid: boolean;
  checked: number;
  brokenAt: string | null;
}

/** Walk the whole chain in id order and recompute every hash. */
export async function verifyAuditChain(prisma: PrismaClient, batchSize = 2000): Promise<VerifyResult> {
  let prevHash: string | null = null;
  let checked = 0;
  let cursor: bigint | null = null;
  for (;;) {
    const rows: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = await prisma.auditLog.findMany({
      where: cursor === null ? {} : { id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (!rows.length) break;
    for (const r of rows) {
      const expected = computeAuditHash(prevHash, {
        occurredAt: r.occurredAt,
        category: r.category,
        action: r.action,
        actorType: r.actorType,
        actorId: r.actorId,
        actorName: r.actorName,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        deviceId: r.deviceId,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        success: r.success,
        before: r.before,
        after: r.after,
        metadata: r.metadata,
      });
      if ((r.prevHash ?? null) !== prevHash || r.hash !== expected) {
        return { valid: false, checked, brokenAt: r.id.toString() };
      }
      prevHash = r.hash;
      checked++;
    }
    cursor = rows[rows.length - 1].id;
  }
  return { valid: true, checked, brokenAt: null };
}
