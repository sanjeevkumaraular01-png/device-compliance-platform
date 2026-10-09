import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { MonitoringNotice } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/types';

export type AcknowledgementStatus = 'SIGNED' | 'OUTDATED' | 'NONE' | 'NOT_REQUIRED';
export type AcknowledgementMethod = 'INSTALL' | 'WEB';

/**
 * Where an employee stands against the current notice.
 * NOT_REQUIRED when no notice has been published yet.
 */
export function acknowledgementStatus(latestSignedVersion: number | null | undefined, currentVersion: number | null | undefined): AcknowledgementStatus {
  if (!currentVersion) return 'NOT_REQUIRED';
  if (latestSignedVersion == null) return 'NONE';
  return latestSignedVersion >= currentVersion ? 'SIGNED' : 'OUTDATED';
}

/** Versioned monitoring notice and employee acknowledgements (DPDP/GDPR transparency evidence). */
@Injectable()
export class NoticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  current(): Promise<MonitoringNotice | null> {
    return this.prisma.monitoringNotice.findFirst({ orderBy: { version: 'desc' } });
  }

  history() {
    return this.prisma.monitoringNotice.findMany({
      orderBy: { version: 'desc' },
      select: {
        version: true,
        title: true,
        body: true,
        createdAt: true,
        createdBy: { select: { id: true, displayName: true } },
        _count: { select: { acknowledgements: true } },
      },
    });
  }

  /** Publish a new immutable version; earlier versions and their signatures are kept. */
  async publish(input: { title: string; body: string }, actor: AuthUser) {
    const title = input.title.trim();
    const body = input.body.trim();
    if (!title || !body) throw new BadRequestException('Title and notice text are required');
    const cur = await this.current();
    if (cur && cur.title === title && cur.body === body) {
      throw new ConflictException('This text is identical to the current version; nothing to publish');
    }
    const notice = await this.prisma.monitoringNotice.create({
      data: { version: (cur?.version ?? 0) + 1, title, body, createdById: actor.id },
    });
    await this.audit.log({
      category: 'POLICY_CHANGE',
      action: 'hr.notice.publish',
      resourceType: 'MonitoringNotice',
      resourceId: String(notice.version),
      before: cur ? { version: cur.version } : null,
      after: { version: notice.version, title: notice.title },
    });
    return notice;
  }

  /**
   * Record that `userId` read and accepted the current notice. The client must
   * send the version it displayed so a notice edited mid-read is never signed blind.
   * Idempotent per (user, version): the first signature is kept.
   */
  async acknowledge(
    userId: string,
    input: { noticeVersion: number; signedName: string },
    method: AcknowledgementMethod,
    ip: string | null,
    userAgent: string | null,
  ) {
    const cur = await this.current();
    if (!cur) throw new BadRequestException('No monitoring notice has been published');
    if (input.noticeVersion !== cur.version) {
      throw new ConflictException('The monitoring notice was updated. Please read the new version and acknowledge again.');
    }
    const signedName = input.signedName.trim().replace(/\s+/g, ' ');
    if (signedName.length < 2) throw new BadRequestException('Please type your full name to sign');

    const existing = await this.prisma.policyAcknowledgement.findUnique({
      where: { userId_noticeVersion: { userId, noticeVersion: cur.version } },
    });
    if (existing) return existing;

    const ack = await this.prisma.policyAcknowledgement.create({
      data: {
        userId,
        noticeVersion: cur.version,
        signedName: signedName.substring(0, 200),
        method,
        ipAddress: ip?.substring(0, 64) ?? null,
        userAgent: userAgent?.substring(0, 500) ?? null,
      },
    });
    await this.audit.log({
      category: 'USER_ACTION',
      action: 'hr.notice.acknowledge',
      actorType: 'USER',
      actorId: userId,
      actorName: signedName,
      resourceType: 'PolicyAcknowledgement',
      resourceId: ack.id,
      ipAddress: ip,
      metadata: { noticeVersion: cur.version, method },
    });
    return ack;
  }
}
