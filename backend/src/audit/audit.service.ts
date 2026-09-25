import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContext } from '../common/request-context';
import { appendAuditLog, AuditEntryInput, verifyAuditChain, VerifyResult } from './audit-chain';
import { orderBy, paginated, skipTake } from '../common/dto/pagination.dto';
import { AuditQueryDto, LoginHistoryQueryDto } from './audit.dto';
import { toCsv } from '../common/utils/csv';

export type AuditLogInput = Omit<AuditEntryInput, 'occurredAt'> & { occurredAt?: Date };

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append an audit entry. Actor, IP and user agent default to the current request
   * context. Never throws: audit failures are logged loudly instead of breaking requests.
   */
  async log(entry: AuditLogInput): Promise<void> {
    const ctx = RequestContext.get();
    try {
      await appendAuditLog(this.prisma, {
        ...entry,
        actorType: entry.actorType ?? ctx?.actorType ?? 'SYSTEM',
        actorId: entry.actorId !== undefined ? entry.actorId : (ctx?.actorId ?? null),
        actorName: entry.actorName !== undefined ? entry.actorName : (ctx?.actorName ?? null),
        ipAddress: entry.ipAddress !== undefined ? entry.ipAddress : (ctx?.ip ?? null),
        userAgent: entry.userAgent !== undefined ? entry.userAgent : (ctx?.userAgent ?? null),
        metadata:
          entry.metadata !== undefined || ctx?.requestId
            ? { ...((entry.metadata as object) ?? {}), ...(ctx?.requestId ? { requestId: ctx.requestId } : {}) }
            : undefined,
      });
    } catch (e) {
      this.logger.error(`AUDIT WRITE FAILED for ${entry.action}: ${(e as Error).message}`);
    }
  }

  verify(): Promise<VerifyResult> {
    return verifyAuditChain(this.prisma);
  }

  buildWhere(q: AuditQueryDto): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};
    if (q.category) where.category = q.category;
    if (q.action) where.action = { contains: q.action, mode: 'insensitive' };
    if (q.actorId) where.actorId = q.actorId;
    if (q.resourceType) where.resourceType = q.resourceType;
    if (q.resourceId) where.resourceId = q.resourceId;
    if (q.deviceId) where.deviceId = q.deviceId;
    if (q.success !== undefined) where.success = q.success;
    if (q.from || q.to) where.occurredAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
    if (q.search) {
      where.OR = [
        { action: { contains: q.search, mode: 'insensitive' } },
        { actorName: { contains: q.search, mode: 'insensitive' } },
        { resourceId: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  async list(q: AuditQueryDto) {
    const where = this.buildWhere(q);
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: orderBy(q, ['occurredAt', 'id', 'category', 'action'], 'id'),
        ...skipTake(q),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginated(rows.map(serializeAudit), q.page, q.pageSize, total);
  }

  async get(id: string) {
    if (!/^\d+$/.test(id)) throw new NotFoundException('Audit entry not found');
    const row = await this.prisma.auditLog.findUnique({ where: { id: BigInt(id) } });
    if (!row) throw new NotFoundException('Audit entry not found');
    return serializeAudit(row);
  }

  async exportCsv(q: AuditQueryDto): Promise<string> {
    const rows = await this.prisma.auditLog.findMany({
      where: this.buildWhere(q),
      orderBy: { id: 'asc' },
      take: 100_000,
    });
    const header = ['id', 'occurredAt', 'category', 'action', 'actorType', 'actorId', 'actorName', 'resourceType',
      'resourceId', 'deviceId', 'ipAddress', 'userAgent', 'success', 'before', 'after', 'metadata', 'prevHash', 'hash'];
    return toCsv(
      header,
      rows.map((r) => [
        r.id.toString(), r.occurredAt.toISOString(), r.category, r.action, r.actorType, r.actorId, r.actorName,
        r.resourceType, r.resourceId, r.deviceId, r.ipAddress, r.userAgent, r.success,
        r.before == null ? '' : JSON.stringify(r.before), r.after == null ? '' : JSON.stringify(r.after),
        r.metadata == null ? '' : JSON.stringify(r.metadata), r.prevHash, r.hash,
      ]),
    );
  }

  async loginHistory(q: LoginHistoryQueryDto) {
    const where: Prisma.LoginHistoryWhereInput = {};
    if (q.userId) where.userId = q.userId;
    if (q.success !== undefined) where.success = q.success;
    if (q.from || q.to) where.occurredAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
    if (q.search) where.email = { contains: q.search, mode: 'insensitive' };
    const [rows, total] = await Promise.all([
      this.prisma.loginHistory.findMany({
        where,
        orderBy: orderBy(q, ['occurredAt', 'email', 'success'], 'occurredAt'),
        include: { user: { select: { id: true, displayName: true, email: true } } },
        ...skipTake(q),
      }),
      this.prisma.loginHistory.count({ where }),
    ]);
    return paginated(rows, q.page, q.pageSize, total);
  }
}

export function serializeAudit<T extends { id: bigint }>(row: T) {
  return { ...row, id: row.id.toString() };
}

export { AuditCategory };
