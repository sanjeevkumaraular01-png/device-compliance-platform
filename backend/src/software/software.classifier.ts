/**
 * Pure software classification (docs/API.md "Software"):
 *   blacklist match -> BLACKLISTED; OS-bundled component -> APPROVED;
 *   whitelist match -> APPROVED; otherwise UNAUTHORIZED if the effective policy
 *   blocks unauthorized software, else UNKNOWN.
 */

export type SoftwareStatus = 'APPROVED' | 'UNAUTHORIZED' | 'BLACKLISTED' | 'UNKNOWN';
export type MatchType = 'EXACT' | 'CONTAINS' | 'REGEX';

export interface ClassifiableSoftware {
  name: string;
  version?: string | null;
  publisher?: string | null;
  source?: string | null;
}

export interface CatalogRule {
  id: string;
  name: string;
  publisher?: string | null;
  matchType: MatchType | string;
  platform?: string | null;
  minVersion?: string | null; // whitelist only
}

export interface Classification {
  status: SoftwareStatus;
  matchedRuleId: string | null;
}

const OS_PUBLISHERS = [
  'microsoft corporation',
  'microsoft',
  'apple',
  'apple inc.',
  'apple inc',
  'canonical',
  'canonical ltd.',
  'canonical ltd',
  'canonical group limited',
];

const regexCache = new Map<string, RegExp | null>();

function getRegex(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) return regexCache.get(pattern)!;
  let re: RegExp | null = null;
  try {
    // guard against pathological patterns: cap length
    re = pattern.length <= 500 ? new RegExp(pattern, 'i') : null;
  } catch {
    re = null;
  }
  if (regexCache.size > 5000) regexCache.clear();
  regexCache.set(pattern, re);
  return re;
}

export function matchesName(name: string, ruleName: string, matchType: string): boolean {
  const n = name.trim().toLowerCase();
  const r = ruleName.trim().toLowerCase();
  switch (matchType) {
    case 'EXACT':
      return n === r;
    case 'REGEX': {
      const re = getRegex(ruleName);
      return re ? re.test(name) : false;
    }
    case 'CONTAINS':
    default:
      return r.length > 0 && n.includes(r);
  }
}

function publisherMatches(item: ClassifiableSoftware, rule: CatalogRule): boolean {
  if (!rule.publisher) return true;
  if (!item.publisher) return false;
  return item.publisher.toLowerCase().includes(rule.publisher.toLowerCase());
}

function platformMatches(rule: CatalogRule, platform: string | null | undefined): boolean {
  return !rule.platform || !platform || rule.platform === platform;
}

/** Compare dotted versions numerically: returns -1, 0, 1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-+_ ]/).map((x) => parseInt(x, 10));
  const pb = b.split(/[.\-+_ ]/).map((x) => parseInt(x, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0;
    const y = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function ruleMatches(item: ClassifiableSoftware, rule: CatalogRule, platform?: string | null): boolean {
  return platformMatches(rule, platform) && matchesName(item.name, rule.name, rule.matchType) && publisherMatches(item, rule);
}

export function isOsBundled(item: ClassifiableSoftware): boolean {
  return (
    (item.source ?? '').toLowerCase() === 'system' &&
    !!item.publisher &&
    OS_PUBLISHERS.includes(item.publisher.trim().toLowerCase())
  );
}

export function classifySoftware(
  item: ClassifiableSoftware,
  whitelist: CatalogRule[],
  blacklist: CatalogRule[],
  opts: { platform?: string | null; blockUnauthorized: boolean },
): Classification {
  const bl = blacklist.find((r) => ruleMatches(item, r, opts.platform));
  if (bl) return { status: 'BLACKLISTED', matchedRuleId: bl.id };

  if (isOsBundled(item)) return { status: 'APPROVED', matchedRuleId: null };

  const wl = whitelist.find(
    (r) =>
      ruleMatches(item, r, opts.platform) &&
      (!r.minVersion || !item.version || compareVersions(item.version, r.minVersion) >= 0),
  );
  if (wl) return { status: 'APPROVED', matchedRuleId: wl.id };

  return { status: opts.blockUnauthorized ? 'UNAUTHORIZED' : 'UNKNOWN', matchedRuleId: null };
}
