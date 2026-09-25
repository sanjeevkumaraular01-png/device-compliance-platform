import { addDays, dayRange, isoWeekday, localDate, localIso, zonedTime } from './time';
import { isJpeg, jpegSize } from './jpeg';
import { timelineFromHourly, timelineFromSegments } from './timeline';

describe('time helpers', () => {
  it('converts local wall time to instants (IST +05:30, New York with DST)', () => {
    expect(zonedTime('2026-09-24', '09:30', 'Asia/Kolkata').toISOString()).toBe('2026-09-24T04:00:00.000Z');
    expect(zonedTime('2026-07-01', '09:00', 'America/New_York').toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(zonedTime('2026-01-15', '09:00', 'America/New_York').toISOString()).toBe('2026-01-15T14:00:00.000Z');
  });

  it('local date / day range / weekday', () => {
    expect(localDate(new Date('2026-09-24T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-09-25');
    const r = dayRange('2026-09-25', 'Asia/Kolkata');
    expect(r.start.toISOString()).toBe('2026-09-24T18:30:00.000Z');
    expect(r.end.getTime() - r.start.getTime()).toBe(86_400_000);
    expect(isoWeekday('2026-09-27')).toBe(7);
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(localIso(new Date('2026-09-24T04:00:00Z'), 'Asia/Kolkata')).toBe('2026-09-24T09:30:00+05:30');
  });
});

describe('jpeg helpers', () => {
  it('detects magic bytes and reads SOF dimensions', () => {
    // SOI, APP0 (len 16), SOF0 (len 17, precision 8, h=600, w=800)
    const buf = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    ]);
    expect(isJpeg(buf)).toBe(true);
    expect(jpegSize(buf)).toEqual({ width: 800, height: 600 });
    expect(isJpeg(Buffer.from('\x89PNG\r\n'))).toBe(false);
  });
});

describe('timeline buckets', () => {
  const tz = 'Asia/Kolkata';
  it('splits segments into 24 local hours', () => {
    const start = zonedTime('2026-09-24', '09:50', tz);
    const b = timelineFromSegments(
      [{ startedAt: start, endedAt: new Date(start.getTime() + 20 * 60_000), active: true, category: 'PRODUCTIVE', appLabel: 'VS Code' }],
      '2026-09-24',
      tz,
    );
    expect(b).toHaveLength(24);
    expect(b[9]).toMatchObject({ hour: '2026-09-24T09:00:00+05:30', activeSec: 600, productiveSec: 600, topApp: 'VS Code' });
    expect(b[10].activeSec).toBe(600);
  });

  it('spreads UTC hourly rollups over :30-offset local hours', () => {
    const b = timelineFromHourly(
      [{ hour: new Date('2026-09-24T04:00:00Z'), activeSec: 3600, idleSec: 0, productiveSec: 3600, neutralSec: 0, unproductiveSec: 0, topApp: 'Excel' }],
      '2026-09-24',
      tz,
    );
    expect(b[9].activeSec).toBe(1800); // 09:00-10:00 IST overlaps 04:00-04:30 UTC
    expect(b[10].activeSec).toBe(1800);
  });
});
