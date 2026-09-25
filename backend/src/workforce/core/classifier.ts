import type { ActivityCategory, AppRuleKind, MatchType } from '@prisma/client';

export interface RuleLike {
  id: string;
  kind: AppRuleKind;
  pattern: string;
  matchType: MatchType;
  label: string;
  category: ActivityCategory;
  departmentId: string | null;
}

export interface Classification {
  category: ActivityCategory;
  /** Display label (rule label, else the domain or app name). */
  label: string | null;
  ruleId: string | null;
  kind: AppRuleKind;
  /** Rule label starts with "Meeting:" (Teams, Zoom, Meet, Webex, Skype). */
  meeting: boolean;
}

export const MEETING_PREFIX = 'Meeting:';

const MATCH_RANK: Record<MatchType, number> = { EXACT: 0, CONTAINS: 1, REGEX: 2 };
const regexCache = new Map<string, RegExp | null>();

function compile(pattern: string): RegExp | null {
  if (!regexCache.has(pattern)) {
    let re: RegExp | null = null;
    try {
      re = new RegExp(pattern, 'i');
    } catch {
      re = null;
    }
    if (regexCache.size > 5000) regexCache.clear();
    regexCache.set(pattern, re);
  }
  return regexCache.get(pattern) ?? null;
}

/** Normalize a website host: lowercase, strip scheme, credentials, port, path, query and "www.". */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = String(input).trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[/?#]/)[0];
  s = s.substring(s.lastIndexOf('@') + 1);
  if (s.startsWith('[')) s = s.substring(0, s.indexOf(']') + 1);
  else s = s.split(':')[0];
  s = s.replace(/^www\./, '').replace(/\.$/, '');
  if (!s || s.length > 253 || !/^[a-z0-9.\-[\]:]+$/.test(s)) return null;
  return s;
}

export function ruleMatches(rule: Pick<RuleLike, 'kind' | 'pattern' | 'matchType'>, value: string): boolean {
  const v = value.toLowerCase();
  const p = rule.pattern.toLowerCase();
  switch (rule.matchType) {
    case 'EXACT':
      // For websites EXACT also covers subdomains: "youtube.com" matches "m.youtube.com".
      return rule.kind === 'WEBSITE' ? v === p || v.endsWith(`.${p}`) : v === p;
    case 'CONTAINS':
      return v.includes(p);
    case 'REGEX': {
      const re = compile(rule.pattern);
      return !!re && re.test(value);
    }
    default:
      return false;
  }
}

/**
 * Pick the winning rule among matches: department rule beats global rule, then
 * EXACT > CONTAINS > REGEX, then the longer (more specific) pattern, then id for stability.
 */
export function pickRule<T extends RuleLike>(matches: T[], departmentId: string | null): T | null {
  if (!matches.length) return null;
  return [...matches].sort((a, b) => {
    const da = a.departmentId && a.departmentId === departmentId ? 0 : 1;
    const db = b.departmentId && b.departmentId === departmentId ? 0 : 1;
    if (da !== db) return da - db;
    const ma = MATCH_RANK[a.matchType] - MATCH_RANK[b.matchType];
    if (ma !== 0) return ma;
    if (a.pattern.length !== b.pattern.length) return b.pattern.length - a.pattern.length;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}

/**
 * Classify one activity segment (docs/WORKFORCE.md "Category"): match the domain against
 * WEBSITE rules when a domain is present, otherwise the app against APP rules. Rules of
 * other departments are ignored. Unmatched -> UNCATEGORIZED.
 */
export function classify(
  input: { app?: string | null; domain?: string | null },
  rules: RuleLike[],
  departmentId: string | null,
): Classification {
  const applicable = rules.filter((r) => r.departmentId === null || r.departmentId === departmentId);
  const domain = normalizeDomain(input.domain);
  if (domain) {
    const hit = pickRule(applicable.filter((r) => r.kind === 'WEBSITE' && ruleMatches(r, domain)), departmentId);
    if (hit) return { category: hit.category, label: hit.label, ruleId: hit.id, kind: 'WEBSITE', meeting: hit.label.startsWith(MEETING_PREFIX) };
    return { category: 'UNCATEGORIZED', label: domain, ruleId: null, kind: 'WEBSITE', meeting: false };
  }
  const app = input.app?.trim();
  if (app) {
    const hit = pickRule(applicable.filter((r) => r.kind === 'APP' && ruleMatches(r, app)), departmentId);
    if (hit) return { category: hit.category, label: hit.label, ruleId: hit.id, kind: 'APP', meeting: hit.label.startsWith(MEETING_PREFIX) };
    return { category: 'UNCATEGORIZED', label: app, ruleId: null, kind: 'APP', meeting: false };
  }
  return { category: 'UNCATEGORIZED', label: null, ruleId: null, kind: 'APP', meeting: false };
}

/** Category bucket used in percentages: UNCATEGORIZED counts as neutral, BLOCKED as unproductive. */
export function categoryBucket(c: ActivityCategory): 'productive' | 'neutral' | 'unproductive' {
  if (c === 'PRODUCTIVE') return 'productive';
  if (c === 'UNPRODUCTIVE' || c === 'BLOCKED') return 'unproductive';
  return 'neutral';
}

export function isMeetingLabel(label: string | null | undefined): boolean {
  return !!label && label.startsWith(MEETING_PREFIX);
}
