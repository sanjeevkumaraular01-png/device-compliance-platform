import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppConfigService } from '../config/app-config.service';
import { NotifierService } from '../alerts/notifier.service';
import { UsersService } from '../users/users.service';
import { DevicesService } from '../devices/devices.service';
import { orderBy, paginated, skipTake } from '../common/dto/pagination.dto';
import { userScope } from '../common/scope';
import type { AuthUser } from '../common/types';
import { DirectoryQueryDto, OffboardDto, OnboardDto } from './hr.dto';
import { NoticeService, acknowledgementStatus } from './notice.service';

const DIRECTORY_SELECT = {
  id: true,
  displayName: true,
  email: true,
  employeeCode: true,
  jobTitle: true,
  location: true,
  isActive: true,
  createdAt: true,
  role: { select: { key: true, name: true } },
  department: { select: { id: true, name: true } },
  workProfile: { select: { id: true, key: true, name: true } },
  assignedDevices: {
    where: { status: { not: 'RETIRED' } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, deviceName: true, status: true, platform: true, lastSeenAt: true },
  },
  acknowledgements: {
    orderBy: { noticeVersion: 'desc' },
    take: 1,
    select: { noticeVersion: true, signedName: true, method: true, acknowledgedAt: true },
  },
} satisfies Prisma.UserSelect;

@Injectable()
export class HrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly notifier: NotifierService,
    private readonly users: UsersService,
    private readonly devices: DevicesService,
    private readonly notices: NoticeService,
  ) {}

  /** Employee directory with devices and notice-acknowledgement status. */
  async directory(q: DirectoryQueryDto, actor: AuthUser) {
    const current = await this.notices.current();
    const and: Prisma.UserWhereInput[] = [userScope(actor)];
    const status = q.status ?? 'active';
    if (status !== 'all') and.push({ isActive: status === 'active' });
    if (q.departmentId) and.push({ departmentId: q.departmentId });
    if (q.search) {
      const s = q.search;
      and.push({
        OR: [
          { displayName: { contains: s, mode: 'insensitive' } },
          { email: { contains: s, mode: 'insensitive' } },
          { employeeCode: { contains: s, mode: 'insensitive' } },
          { jobTitle: { contains: s, mode: 'insensitive' } },
        ],
      });
    }
    if (q.acknowledgement && current) {
      const signedCurrent: Prisma.UserWhereInput = { acknowledgements: { some: { noticeVersion: current.version } } };
      and.push(q.acknowledgement === 'signed' ? signedCurrent : { NOT: signedCurrent });
    }
    const where: Prisma.UserWhereInput = { AND: and };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: DIRECTORY_SELECT,
        orderBy: orderBy({ sortBy: q.sortBy, sortOrder: q.sortBy ? q.sortOrder : 'asc' }, ['displayName', 'email', 'employeeCode', 'createdAt'], 'displayName'),
        ...skipTake(q),
      }),
      this.prisma.user.count({ where }),
    ]);
    const data = rows.map(({ acknowledgements, ...u }) => {
      const latest = acknowledgements[0] ?? null;
      return {
        ...u,
        acknowledgement: {
          status: acknowledgementStatus(latest?.noticeVersion, current?.version),
          latest,
        },
      };
    });
    return { ...paginated(data, q.page, q.pageSize, total), currentNoticeVersion: current?.version ?? null };
  }

  async acknowledgementsFor(userId: string, actor: AuthUser) {
    await this.findScoped(userId, actor);
    return this.prisma.policyAcknowledgement.findMany({
      where: { userId },
      orderBy: { acknowledgedAt: 'desc' },
      select: { id: true, noticeVersion: true, signedName: true, method: true, ipAddress: true, userAgent: true, acknowledgedAt: true },
    });
  }

  /** Give an employee their enrollment instructions; optionally email them. */
  async onboard(userId: string, dto: OnboardDto, actor: AuthUser) {
    const user = await this.findScoped(userId, actor);
    if (!user.isActive) throw new UnprocessableEntityException('This employee is inactive');
    if (!user.employeeCode) {
      throw new UnprocessableEntityException('Set an Employee ID for this employee first (Users → edit), then send the link');
    }
    const installUrl = `${this.config.webUrl}/install`;
    const instructions =
      `Hi ${user.displayName}, please set up SecureEndpoint on your company Windows laptop:\n` +
      `1. Open ${installUrl}\n` +
      `2. Read the monitoring notice, then sign it with your full name\n` +
      `3. Enter your Employee ID: ${user.employeeCode}\n` +
      `4. Download the installer and run it as administrator (right-click → Run as administrator)\n` +
      `IT will approve your device shortly after.`;

    let emailed = false;
    if (dto.sendEmail) {
      if (!this.config.smtpConfigured) {
        throw new UnprocessableEntityException('Email is not configured on this server (SMTP). Copy the link and send it instead.');
      }
      await this.notifier.sendEmail([user.email], {
        title: 'Set up SecureEndpoint on your laptop',
        message: instructions,
        severity: 'INFO',
        category: 'ONBOARDING',
        url: installUrl,
      });
      emailed = true;
    }
    await this.audit.log({
      category: 'USER_ACTION',
      action: 'hr.onboard',
      resourceType: 'User',
      resourceId: user.id,
      metadata: { emailed, employeeCode: user.employeeCode },
    });
    return { installUrl, employeeCode: user.employeeCode, email: user.email, emailed, instructions };
  }

  /**
   * Leaver workflow: retire every assigned device (revokes agent token + certificates),
   * revoke unused self-enrollment links, then deactivate the account (revokes sessions).
   * Preconditions are checked up front so nothing is half-done on a refusal.
   */
  async offboard(userId: string, dto: OffboardDto, actor: AuthUser) {
    if (userId === actor.id) throw new ForbiddenException('You cannot offboard yourself');
    const user = await this.findScoped(userId, actor);
    if (user.role.key === 'SUPER_ADMIN' && actor.roleKey !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only a Super Admin can offboard a Super Admin');
    }

    const retiredDevices: string[] = [];
    const failedDevices: { deviceName: string; error: string }[] = [];
    for (const d of user.assignedDevices) {
      try {
        await this.devices.retire(d.id, false, actor);
        retiredDevices.push(d.deviceName);
      } catch (e) {
        failedDevices.push({ deviceName: d.deviceName, error: (e as Error).message });
      }
    }
    const tokens = await this.prisma.enrollmentToken.updateMany({
      where: { assignToUserId: userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (user.isActive) await this.users.deactivate(userId, actor);

    await this.audit.log({
      category: 'USER_ACTION',
      action: 'hr.offboard',
      resourceType: 'User',
      resourceId: userId,
      before: { isActive: user.isActive, devices: user.assignedDevices.map((d) => d.deviceName) },
      after: { isActive: false },
      metadata: { reason: dto.reason ?? null, retiredDevices, failedDevices, enrollmentLinksRevoked: tokens.count },
    });
    return { deactivated: true, retiredDevices, failedDevices, enrollmentLinksRevoked: tokens.count };
  }

  private async findScoped(userId: string, actor: AuthUser) {
    const user = await this.prisma.user.findFirst({
      where: { AND: [{ id: userId }, userScope(actor)] },
      select: {
        id: true,
        email: true,
        displayName: true,
        employeeCode: true,
        isActive: true,
        role: { select: { key: true } },
        assignedDevices: { where: { status: { not: 'RETIRED' } }, select: { id: true, deviceName: true } },
      },
    });
    if (!user) throw new NotFoundException('Employee not found');
    return user;
  }
}
