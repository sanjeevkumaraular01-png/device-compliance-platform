import type { ActivityCategory } from '@prisma/client';
import { categoryBucket, isMeetingLabel } from './classifier';
import { dayRange, localIso } from './time';

export interface HourBucket {
  hour: string;
  activeSec: number;
  idleSec: number;
  productiveSec: number;
  neutralSec: number;
  unproductiveSec: number;
  topApp: string | null;
}

interface Seg {
  startedAt: Date;
  endedAt: Date;
  active: boolean;
  category: ActivityCategory;
  appLabel: string | null;
}

interface HourlyRow {
  hour: Date;
  activeSec: number;
  idleSec: number;
  productiveSec: number;
  neutralSec: number;
  unproductiveSec: number;
  topApp: string | null;
}

function emptyBuckets(dateStr: string, tz: string): { buckets: HourBucket[]; starts: number[] } {
  const { start } = dayRange(dateStr, tz);
  const starts = Array.from({ length: 24 }, (_, i) => start.getTime() + i * 3_600_000);
  return {
    starts,
    buckets: starts.map((t) => ({ hour: localIso(new Date(t), tz), activeSec: 0, idleSec: 0, productiveSec: 0, neutralSec: 0, unproductiveSec: 0, topApp: null })),
  };
}

/** 24 local-hour buckets from raw segments (exact; meeting time counts as active). */
export function timelineFromSegments(segments: Seg[], dateStr: string, tz: string): HourBucket[] {
  const { buckets, starts } = emptyBuckets(dateStr, tz);
  const apps: Map<string, number>[] = starts.map(() => new Map());
  for (const s of segments) {
    const a = s.startedAt.getTime();
    const b = s.endedAt.getTime();
    const working = s.active || isMeetingLabel(s.appLabel);
    starts.forEach((h, i) => {
      const part = (Math.min(b, h + 3_600_000) - Math.max(a, h)) / 1000;
      if (part <= 0) return;
      const bk = buckets[i];
      if (working) {
        bk.activeSec += part;
        const c = categoryBucket(s.category);
        if (c === 'productive') bk.productiveSec += part;
        else if (c === 'unproductive') bk.unproductiveSec += part;
        else bk.neutralSec += part;
        if (s.appLabel) apps[i].set(s.appLabel, (apps[i].get(s.appLabel) ?? 0) + part);
      } else bk.idleSec += part;
    });
  }
  return buckets.map((bk, i) => ({
    ...bk,
    activeSec: Math.round(bk.activeSec),
    idleSec: Math.round(bk.idleSec),
    productiveSec: Math.round(bk.productiveSec),
    neutralSec: Math.round(bk.neutralSec),
    unproductiveSec: Math.round(bk.unproductiveSec),
    topApp: [...apps[i].entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
  }));
}

/** 24 local-hour buckets from UTC hourly rollups (proportional split for :30/:45 offsets). */
export function timelineFromHourly(rows: HourlyRow[], dateStr: string, tz: string): HourBucket[] {
  const { buckets, starts } = emptyBuckets(dateStr, tz);
  const best: { overlap: number; app: string | null }[] = starts.map(() => ({ overlap: 0, app: null }));
  for (const r of rows) {
    const a = r.hour.getTime();
    const b = a + 3_600_000;
    starts.forEach((h, i) => {
      const overlap = (Math.min(b, h + 3_600_000) - Math.max(a, h)) / 3_600_000;
      if (overlap <= 0) return;
      const bk = buckets[i];
      bk.activeSec += r.activeSec * overlap;
      bk.idleSec += r.idleSec * overlap;
      bk.productiveSec += r.productiveSec * overlap;
      bk.neutralSec += r.neutralSec * overlap;
      bk.unproductiveSec += r.unproductiveSec * overlap;
      if (overlap > best[i].overlap && r.topApp) best[i] = { overlap, app: r.topApp };
    });
  }
  return buckets.map((bk, i) => ({
    ...bk,
    activeSec: Math.round(bk.activeSec),
    idleSec: Math.round(bk.idleSec),
    productiveSec: Math.round(bk.productiveSec),
    neutralSec: Math.round(bk.neutralSec),
    unproductiveSec: Math.round(bk.unproductiveSec),
    topApp: best[i].app,
  }));
}
