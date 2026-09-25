import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WorkforceIngestService } from '../workforce/ingest.service';
import { WorkforcePoliciesService } from '../workforce/policies.service';
import { hmToMinutes, localDate, localParts } from '../workforce/core/time';
import type { AgentDevice } from '../common/types';
import { DEMO_APP_MIX } from '../workforce/demo-app-mix';

/** Setting written by the seed: ids of seeded demo employees (never real users). */
export const DEMO_USERS_SETTING = 'seed.workforceDemoUserIds';

function hashFrac(s: string): number {
  return parseInt(createHash('sha1').update(s).digest('hex').substring(0, 8), 16) / 0xffffffff;
}

/**
 * Keeps seeded demo employees "working" so the live board has data without real agents:
 * every run appends segments (on realistic apps) from each demo user's last segment up to
 * now, during their policy's work hours, through the real ingest pipeline.
 */
@Injectable()
export class DemoWorkforceActivity {
  private readonly logger = new Logger(DemoWorkforceActivity.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: WorkforceIngestService,
    private readonly policies: WorkforcePoliciesService,
  ) {}

  async run(now = new Date()): Promise<{ users: number; segments: number }> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: DEMO_USERS_SETTING } });
    const ids = Array.isArray(row?.value) ? (row!.value as string[]) : [];
    if (!ids.length) return { users: 0, segments: 0 };
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, isActive: true },
      select: {
        id: true, email: true, departmentId: true, department: { select: { code: true } },
        assignedDevices: { where: { status: 'ACTIVE' }, select: { id: true, serialNumber: true, platform: true, deviceName: true, departmentId: true, assignedUserId: true, status: true, ipAddress: true }, take: 1 },
      },
    });
    let active = 0;
    let segments = 0;
    for (const u of users) {
      const device = u.assignedDevices[0];
      if (!device) continue;
      const policy = await this.policies.forDepartment(u.departmentId);
      const p = localParts(now, policy.timezone);
      const today = localDate(now, policy.timezone);
      if (!policy.workDays.includes(p.weekday)) continue;
      const minute = p.hour * 60 + p.minute;
      const startMin = hmToMinutes(policy.workStart) + Math.floor(hashFrac(`${u.id}:${today}:start`) * 40) - 10;
      const endMin = hmToMinutes(policy.workEnd) + Math.floor(hashFrac(`${u.id}:${today}:end`) * 60) - 20;
      if (minute < startMin || minute >= endMin) continue;
      if (hashFrac(`${u.id}:${today}:absent`) < 0.08) continue; // a few people are out today
      const last = await this.prisma.activitySegment.findFirst({ where: { userId: u.id }, orderBy: { endedAt: 'desc' }, select: { endedAt: true } });
      const dayStart = new Date(now.getTime() - (minute - startMin) * 60_000);
      let t = Math.max(last?.endedAt.getTime() ?? 0, now.getTime() - 15 * 60_000, dayStart.getTime());
      const mix = DEMO_APP_MIX[u.department?.code ?? ''] ?? DEMO_APP_MIX.OPS;
      const total = mix.reduce((a, b) => a + b.weight, 0);
      const segs = [];
      let i = 0;
      while (t < now.getTime() - 20_000 && segs.length < 20) {
        const r = hashFrac(`${u.id}:${t}:${i++}`);
        const len = Math.min(now.getTime() - t, (60 + Math.floor(r * 240)) * 1000);
        const idle = hashFrac(`${u.id}:${t}:idle`) < 0.12;
        let x = hashFrac(`${u.id}:${t}:app`) * total;
        let pick = mix[0];
        for (const m of mix) if ((x -= m.weight) <= 0) { pick = m; break; }
        segs.push({
          startedAt: new Date(t).toISOString(),
          endedAt: new Date(t + len).toISOString(),
          active: !idle,
          app: pick.app,
          ...(pick.domain ? { domain: pick.domain } : {}),
          inputEvents: idle ? 0 : 40 + Math.floor(r * 400),
        });
        t += len;
      }
      if (!segs.length) continue;
      const agent: AgentDevice = { ...device, assignedUserId: u.id } as AgentDevice;
      const res = await this.ingest
        .ingestActivity(agent, { osUser: u.email.split('@')[0], network: device.ipAddress ? { ips: [device.ipAddress] } : undefined, segments: segs } as never)
        .catch((e) => {
          this.logger.warn(`demo ingest for ${u.id} failed: ${(e as Error).message}`);
          return { accepted: 0 };
        });
      segments += res.accepted;
      active++;
    }
    return { users: active, segments };
  }
}
