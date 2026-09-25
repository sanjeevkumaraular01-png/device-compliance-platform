import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, TaskSource, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { safeEqual } from '../common/crypto.service';
import { orderBy, paginated, skipTake } from '../common/dto/pagination.dto';
import { scopedDepartmentIds } from '../common/scope';
import type { AuthUser } from '../common/types';
import { WorkSessionsService } from '../workforce/sessions.service';
import { WorkforcePoliciesService } from '../workforce/policies.service';
import { localDate } from '../workforce/core/time';
import {
  CreateProjectDto,
  CreateTaskDto,
  ImportTaskItemDto,
  ManualTimeDto,
  ProjectQueryDto,
  TaskQueryDto,
  UpdateProjectDto,
  UpdateTaskDto,
} from './tasks.dto';

const TASK_INCLUDE = {
  project: { select: { id: true, name: true, code: true } },
  assignee: { select: { id: true, displayName: true, email: true, departmentId: true } },
  createdBy: { select: { id: true, displayName: true } },
} satisfies Prisma.WorkTaskInclude;

type TaskRow = Prisma.WorkTaskGetPayload<{ include: typeof TASK_INCLUDE }>;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly sessions: WorkSessionsService,
    private readonly policies: WorkforcePoliciesService,
  ) {}

  // ───────────────────────── Scope ─────────────────────────

  private manages(user: AuthUser) {
    return user.permissions.includes('tasks:manage');
  }

  private deptLimited(user: AuthUser) {
    return user.roleKey === 'DEPARTMENT_MANAGER';
  }

  /** Tasks visible to the caller. */
  taskScope(user: AuthUser): Prisma.WorkTaskWhereInput {
    const own: Prisma.WorkTaskWhereInput[] = [{ assigneeId: user.id }, { createdById: user.id }];
    if (!this.manages(user) && !user.permissions.includes('workforce:read')) return { OR: own };
    if (this.deptLimited(user)) {
      return { OR: [...own, { assignee: { departmentId: { in: scopedDepartmentIds(user) } } }, { project: { departmentId: { in: scopedDepartmentIds(user) } } }] };
    }
    return {};
  }

  private async assertAssignable(user: AuthUser, assigneeId: string | null | undefined) {
    if (!assigneeId || assigneeId === user.id) return;
    if (!this.manages(user)) throw new ForbiddenException('You can only create or assign tasks for yourself');
    const a = await this.prisma.user.findUnique({ where: { id: assigneeId }, select: { id: true, departmentId: true, isActive: true } });
    if (!a || !a.isActive) throw new BadRequestException('assigneeId does not refer to an active user');
    if (this.deptLimited(user) && (!a.departmentId || !scopedDepartmentIds(user).includes(a.departmentId))) {
      throw new ForbiddenException('Assignee is outside your department scope');
    }
  }

  private async getVisible(user: AuthUser, id: string): Promise<TaskRow> {
    const t = await this.prisma.workTask.findFirst({ where: { AND: [{ id }, this.taskScope(user)] }, include: TASK_INCLUDE });
    if (!t) throw new NotFoundException('Task not found');
    return t;
  }

  private canEdit(user: AuthUser, t: TaskRow) {
    if (t.assigneeId === user.id || t.createdById === user.id) return true;
    if (!this.manages(user)) return false;
    if (!this.deptLimited(user)) return true;
    const ids = scopedDepartmentIds(user);
    return !!t.assignee?.departmentId && ids.includes(t.assignee.departmentId);
  }

  private async withTracked(rows: TaskRow[]) {
    const running = rows.length
      ? await this.prisma.timeEntry.findMany({ where: { taskId: { in: rows.map((r) => r.id) }, endedAt: null }, select: { taskId: true, startedAt: true } })
      : [];
    const now = Date.now();
    return rows.map((t) => {
      const live = running.filter((r) => r.taskId === t.id).reduce((s, r) => s + Math.max(0, Math.round((now - r.startedAt.getTime()) / 1000)), 0);
      const trackedSec = t.trackedSec + live;
      const variancePercent = t.estimatedMinutes ? Math.round(((trackedSec / 60 - t.estimatedMinutes) / t.estimatedMinutes) * 1000) / 10 : null;
      return { ...t, trackedSec, estimatedMinutes: t.estimatedMinutes, variancePercent, timerRunning: live > 0 || running.some((r) => r.taskId === t.id) };
    });
  }

  // ───────────────────────── Tasks ─────────────────────────

  async list(user: AuthUser, q: TaskQueryDto) {
    const and: Prisma.WorkTaskWhereInput[] = [this.taskScope(user)];
    if (q.mine) and.push({ assigneeId: user.id });
    if (q.assigneeId) and.push({ assigneeId: q.assigneeId });
    if (q.projectId) and.push({ projectId: q.projectId });
    if (q.status) and.push({ status: q.status });
    if (q.source) and.push({ source: q.source });
    if (q.dueBefore) and.push({ dueDate: { lt: new Date(q.dueBefore) } });
    if (q.search) {
      and.push({
        OR: [
          { title: { contains: q.search, mode: 'insensitive' } },
          { externalRef: { contains: q.search, mode: 'insensitive' } },
          { project: { name: { contains: q.search, mode: 'insensitive' } } },
        ],
      });
    }
    const where = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.workTask.findMany({
        where,
        include: TASK_INCLUDE,
        orderBy: q.sortBy ? orderBy(q, ['createdAt', 'updatedAt', 'dueDate', 'priority', 'status', 'title', 'trackedSec'], 'createdAt') : [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        ...skipTake(q),
      }),
      this.prisma.workTask.count({ where }),
    ]);
    return paginated(await this.withTracked(rows), q.page, q.pageSize, total);
  }

  async get(user: AuthUser, id: string) {
    const [t] = await this.withTracked([await this.getVisible(user, id)]);
    return t;
  }

  async create(user: AuthUser, dto: CreateTaskDto) {
    const assigneeId = dto.assigneeId ?? user.id;
    await this.assertAssignable(user, assigneeId);
    if (dto.projectId) await this.assertProjectExists(dto.projectId);
    const t = await this.prisma.workTask.create({
      data: {
        title: dto.title.trim(),
        description: dto.description ?? null,
        projectId: dto.projectId ?? null,
        source: dto.source ?? 'MANUAL',
        externalRef: dto.externalRef ?? null,
        assigneeId,
        createdById: user.id,
        priority: dto.priority ?? 'MEDIUM',
        estimatedMinutes: dto.estimatedMinutes ?? null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      },
      include: TASK_INCLUDE,
    });
    const [row] = await this.withTracked([t]);
    return row;
  }

  async update(user: AuthUser, id: string, dto: UpdateTaskDto) {
    const t = await this.getVisible(user, id);
    if (!this.canEdit(user, t)) throw new ForbiddenException('You cannot edit this task');
    if (dto.assigneeId !== undefined && dto.assigneeId !== t.assigneeId) await this.assertAssignable(user, dto.assigneeId);
    if (dto.projectId) await this.assertProjectExists(dto.projectId);
    const data: Prisma.WorkTaskUncheckedUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.projectId !== undefined) data.projectId = dto.projectId;
    if (dto.assigneeId !== undefined) data.assigneeId = dto.assigneeId;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.estimatedMinutes !== undefined) data.estimatedMinutes = dto.estimatedMinutes;
    if (dto.dueDate !== undefined) {
      const next = dto.dueDate ? new Date(dto.dueDate) : null;
      data.dueDate = next;
      if (next && t.dueDate && next > t.dueDate) data.delayCount = { increment: 1 };
    }
    if (dto.status !== undefined && dto.status !== t.status) {
      data.status = dto.status;
      if (dto.status === 'DONE') data.completedAt = new Date();
      else if (t.status === 'DONE') data.completedAt = null;
      if (dto.status === 'IN_PROGRESS' && !t.startedAt) data.startedAt = new Date();
    }
    const updated = await this.prisma.workTask.update({ where: { id }, data, include: TASK_INCLUDE });
    if (dto.status === 'DONE' || dto.status === 'CANCELLED') {
      const running = await this.prisma.timeEntry.findFirst({ where: { taskId: id, endedAt: null } });
      if (running) await this.sessions.stopRunningTimer(running.userId);
    }
    const [row] = await this.withTracked([await this.prisma.workTask.findUniqueOrThrow({ where: { id: updated.id }, include: TASK_INCLUDE })]);
    return row;
  }

  async remove(user: AuthUser, id: string) {
    const t = await this.getVisible(user, id);
    if (!this.manages(user) && t.createdById !== user.id) throw new ForbiddenException('You cannot delete this task');
    await this.prisma.workTask.delete({ where: { id } });
    await this.audit.log({ category: 'USER_ACTION', action: 'task.delete', resourceType: 'WorkTask', resourceId: id, before: { title: t.title, assigneeId: t.assigneeId } });
  }

  // ───────────────────────── Timers ─────────────────────────

  async start(user: AuthUser, id: string) {
    const t = await this.getVisible(user, id);
    if (t.assigneeId && t.assigneeId !== user.id) throw new ForbiddenException('Only the assignee can track time on this task');
    if (t.status === 'DONE' || t.status === 'CANCELLED') throw new ConflictException(`Task is ${t.status}`);
    const now = new Date();
    await this.sessions.stopRunningTimer(user.id, now);
    const entry = await this.prisma.timeEntry.create({
      data: { userId: user.id, taskId: id, startedAt: now, source: 'TIMER' },
      include: { task: { select: { id: true, title: true, project: { select: { id: true, name: true } } } } },
    });
    await this.prisma.workTask.update({
      where: { id },
      data: {
        ...(t.assigneeId ? {} : { assigneeId: user.id }),
        ...(t.status === 'TODO' ? { status: 'IN_PROGRESS' as TaskStatus } : {}),
        ...(t.startedAt ? {} : { startedAt: now }),
      },
    });
    await this.setCurrentTask(user.id, id);
    return entry;
  }

  async stop(user: AuthUser) {
    const entry = await this.sessions.stopRunningTimer(user.id);
    if (!entry) throw new ConflictException('No timer is running');
    await this.setCurrentTask(user.id, null);
    return entry;
  }

  private async setCurrentTask(userId: string, taskId: string | null) {
    const { user, policy } = await this.policies.forUser(userId);
    const date = localDate(new Date(), policy.timezone);
    await this.prisma.workSession.updateMany({ where: { userId: user.id, date: new Date(`${date}T00:00:00Z`) }, data: { currentTaskId: taskId } });
  }

  async manualTime(user: AuthUser, id: string, dto: ManualTimeDto) {
    const t = await this.getVisible(user, id);
    if (t.assigneeId !== user.id && !this.canEdit(user, t)) throw new ForbiddenException('You cannot log time on this task');
    const startedAt = new Date(dto.startedAt);
    const endedAt = new Date(dto.endedAt);
    if (!(endedAt > startedAt)) throw new BadRequestException('endedAt must be after startedAt');
    if (endedAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException('Time entries cannot be in the future');
    const durationSec = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
    if (durationSec > 16 * 3600) throw new BadRequestException('A single manual entry cannot exceed 16 hours');
    const overlap = await this.prisma.timeEntry.findFirst({
      where: { userId: user.id, startedAt: { lt: endedAt }, OR: [{ endedAt: null }, { endedAt: { gt: startedAt } }] },
      select: { id: true },
    });
    if (overlap) throw new ConflictException('The entry overlaps another time entry');
    const [entry] = await this.prisma.$transaction([
      this.prisma.timeEntry.create({ data: { userId: user.id, taskId: id, startedAt, endedAt, durationSec, source: 'MANUAL', note: dto.note ?? null } }),
      this.prisma.workTask.update({ where: { id }, data: { trackedSec: { increment: durationSec } } }),
    ]);
    return entry;
  }

  // ───────────────────────── Import / webhook ─────────────────────────

  async import(user: AuthUser | null, source: TaskSource, items: ImportTaskItemDto[], via: 'api' | 'webhook') {
    const result = { created: 0, updated: 0, skipped: 0, errors: [] as string[] };
    const emails = [...new Set(items.map((i) => i.assigneeEmail?.toLowerCase()).filter((x): x is string => !!x))];
    const codes = [...new Set(items.map((i) => i.projectCode).filter((x): x is string => !!x))];
    const [users, projects] = await Promise.all([
      emails.length ? this.prisma.user.findMany({ where: { email: { in: emails, mode: 'insensitive' }, isActive: true }, select: { id: true, email: true, departmentId: true } }) : [],
      codes.length ? this.prisma.project.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } }) : [],
    ]);
    const userBy = new Map(users.map((u) => [u.email.toLowerCase(), u]));
    const projectBy = new Map(projects.map((p) => [p.code, p.id]));
    const scope = user && this.deptLimited(user) ? scopedDepartmentIds(user) : null;

    for (const [i, it] of items.entries()) {
      const assignee = it.assigneeEmail ? userBy.get(it.assigneeEmail.toLowerCase()) : undefined;
      if (it.assigneeEmail && !assignee) {
        result.errors.push(`items[${i}] (${it.externalRef}): unknown assignee ${it.assigneeEmail}`);
      }
      if (scope && assignee && (!assignee.departmentId || !scope.includes(assignee.departmentId))) {
        result.skipped++;
        result.errors.push(`items[${i}] (${it.externalRef}): assignee outside your department scope`);
        continue;
      }
      if (it.projectCode && !projectBy.has(it.projectCode)) result.errors.push(`items[${i}] (${it.externalRef}): unknown project ${it.projectCode}`);
      const data = {
        title: it.title.trim(),
        description: it.description ?? null,
        projectId: it.projectCode ? (projectBy.get(it.projectCode) ?? null) : undefined,
        assigneeId: assignee?.id,
        estimatedMinutes: it.estimatedMinutes,
        priority: it.priority,
      };
      const existing = await this.prisma.workTask.findUnique({ where: { source_externalRef: { source, externalRef: it.externalRef } } });
      const due = it.dueDate ? new Date(it.dueDate) : undefined;
      if (existing) {
        await this.prisma.workTask.update({
          where: { id: existing.id },
          data: {
            ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
            ...(due ? { dueDate: due, ...(existing.dueDate && due > existing.dueDate ? { delayCount: { increment: 1 } } : {}) } : {}),
          },
        });
        result.updated++;
      } else {
        await this.prisma.workTask.create({
          data: {
            ...data,
            source,
            externalRef: it.externalRef,
            projectId: data.projectId ?? null,
            assigneeId: data.assigneeId ?? null,
            priority: data.priority ?? 'MEDIUM',
            estimatedMinutes: data.estimatedMinutes ?? null,
            dueDate: due ?? null,
            createdById: user?.id ?? null,
          },
        });
        result.created++;
      }
    }
    await this.audit.log({
      category: 'USER_ACTION',
      action: via === 'webhook' ? 'task.webhook.import' : 'task.import',
      ...(user ? {} : { actorType: 'SYSTEM', actorId: null, actorName: `webhook:${source}` }),
      resourceType: 'WorkTask',
      after: { source, created: result.created, updated: result.updated, skipped: result.skipped, errors: result.errors.length },
    });
    return result;
  }

  async webhook(source: string, token: string | undefined, items: ImportTaskItemDto[]) {
    const expected = await this.settings.get<string>('taskWebhookToken');
    if (!expected || !token || !safeEqual(token, expected)) throw new UnauthorizedException('Invalid or missing X-SEM-Task-Token');
    const src = source.toUpperCase().replace(/-/g, '_');
    if (!(Object.values(TaskSource) as string[]).includes(src)) throw new BadRequestException(`Unknown task source "${source}"`);
    return this.import(null, src as TaskSource, items, 'webhook');
  }

  // ───────────────────────── Projects ─────────────────────────

  private async assertProjectExists(id: string) {
    const p = await this.prisma.project.findUnique({ where: { id }, select: { id: true } });
    if (!p) throw new BadRequestException('projectId does not exist');
  }

  projectScope(user: AuthUser): Prisma.ProjectWhereInput {
    if (!this.manages(user) && !user.permissions.includes('workforce:read')) {
      return { tasks: { some: { assigneeId: user.id } } };
    }
    if (this.deptLimited(user)) {
      const ids = scopedDepartmentIds(user);
      return { OR: [{ departmentId: { in: ids } }, { departmentId: null }, { ownerId: user.id }, { tasks: { some: { assignee: { departmentId: { in: ids } } } } }] };
    }
    return {};
  }

  async listProjects(user: AuthUser, q: ProjectQueryDto) {
    const and: Prisma.ProjectWhereInput[] = [this.projectScope(user)];
    if (q.status) and.push({ status: q.status });
    if (q.departmentId) and.push({ departmentId: q.departmentId });
    if (q.search) and.push({ OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } }, { clientName: { contains: q.search, mode: 'insensitive' } }] });
    const where = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        include: { department: { select: { id: true, name: true } }, owner: { select: { id: true, displayName: true } } },
        orderBy: orderBy(q, ['createdAt', 'name', 'code', 'dueDate', 'status'], 'name'),
        ...skipTake(q),
      }),
      this.prisma.project.count({ where }),
    ]);
    const stats = rows.length
      ? await this.prisma.workTask.groupBy({ by: ['projectId', 'status'], where: { projectId: { in: rows.map((r) => r.id) } }, _count: { _all: true }, _sum: { trackedSec: true, estimatedMinutes: true } })
      : [];
    const data = rows.map((p) => {
      const s = stats.filter((x) => x.projectId === p.id);
      return {
        ...p,
        tasksTotal: s.reduce((a, b) => a + b._count._all, 0),
        tasksDone: s.filter((x) => x.status === 'DONE').reduce((a, b) => a + b._count._all, 0),
        trackedSec: s.reduce((a, b) => a + (b._sum.trackedSec ?? 0), 0),
        estimatedMinutes: s.reduce((a, b) => a + (b._sum.estimatedMinutes ?? 0), 0),
      };
    });
    return paginated(data, q.page, q.pageSize, total);
  }

  async getProject(user: AuthUser, id: string) {
    const p = await this.prisma.project.findFirst({
      where: { AND: [{ id }, this.projectScope(user)] },
      include: { department: { select: { id: true, name: true } }, owner: { select: { id: true, displayName: true } } },
    });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  private assertProjectWrite(user: AuthUser, departmentId: string | null | undefined) {
    if (!this.deptLimited(user)) return;
    if (!departmentId || !scopedDepartmentIds(user).includes(departmentId)) {
      throw new ForbiddenException('Department managers can only manage projects of their own department');
    }
  }

  async createProject(user: AuthUser, dto: CreateProjectDto) {
    const departmentId = dto.departmentId ?? (this.deptLimited(user) ? user.departmentId : null);
    this.assertProjectWrite(user, departmentId);
    const exists = await this.prisma.project.findUnique({ where: { code: dto.code } });
    if (exists) throw new ConflictException('A project with this code already exists');
    const p = await this.prisma.project.create({
      data: {
        ...dto,
        departmentId,
        ownerId: dto.ownerId ?? user.id,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      },
    });
    await this.audit.log({ category: 'USER_ACTION', action: 'project.create', resourceType: 'Project', resourceId: p.id, after: p });
    return p;
  }

  async updateProject(user: AuthUser, id: string, dto: UpdateProjectDto) {
    const before = await this.getProject(user, id);
    this.assertProjectWrite(user, before.departmentId);
    if (dto.departmentId !== undefined) this.assertProjectWrite(user, dto.departmentId);
    const p = await this.prisma.project.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.startDate !== undefined ? { startDate: dto.startDate ? new Date(dto.startDate) : null } : {}),
        ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null } : {}),
      },
    });
    await this.audit.log({ category: 'USER_ACTION', action: 'project.update', resourceType: 'Project', resourceId: id, before, after: p });
    return p;
  }

  async deleteProject(user: AuthUser, id: string) {
    const before = await this.getProject(user, id);
    this.assertProjectWrite(user, before.departmentId);
    await this.prisma.project.delete({ where: { id } });
    await this.audit.log({ category: 'USER_ACTION', action: 'project.delete', resourceType: 'Project', resourceId: id, before });
  }
}
