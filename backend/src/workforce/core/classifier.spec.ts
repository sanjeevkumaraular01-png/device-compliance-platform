import { classify, normalizeDomain, pickRule, RuleLike, ruleMatches } from './classifier';
import { DEFAULT_APP_RULES } from '../default-app-rules';

let n = 0;
const rule = (r: Partial<RuleLike> & Pick<RuleLike, 'pattern' | 'category'>): RuleLike => ({
  id: `r${++n}`,
  kind: 'APP',
  matchType: 'CONTAINS',
  label: r.pattern,
  departmentId: null,
  ...r,
});

describe('workforce classifier', () => {
  const SALES = 'dept-sales';

  it('normalizes domains to the host only', () => {
    expect(normalizeDomain('https://www.GitHub.com/org/repo?tab=1#x')).toBe('github.com');
    expect(normalizeDomain('user:pw@mail.google.com:443/inbox')).toBe('mail.google.com');
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('not a domain!')).toBeNull();
  });

  it('matches EXACT / CONTAINS / REGEX case-insensitively; website EXACT covers subdomains', () => {
    expect(ruleMatches({ kind: 'APP', pattern: 'outlook', matchType: 'EXACT' }, 'OUTLOOK')).toBe(true);
    expect(ruleMatches({ kind: 'APP', pattern: 'outlook', matchType: 'EXACT' }, 'outlook.exe')).toBe(false);
    expect(ruleMatches({ kind: 'APP', pattern: 'excel', matchType: 'CONTAINS' }, 'EXCEL.EXE')).toBe(true);
    expect(ruleMatches({ kind: 'WEBSITE', pattern: 'youtube.com', matchType: 'EXACT' }, 'm.youtube.com')).toBe(true);
    expect(ruleMatches({ kind: 'WEBSITE', pattern: 'x.com', matchType: 'EXACT' }, 'dropbox.com')).toBe(false);
    expect(ruleMatches({ kind: 'WEBSITE', pattern: '(bet365|casino)', matchType: 'REGEX' }, 'play.casino-royal.net')).toBe(true);
    expect(ruleMatches({ kind: 'APP', pattern: '([', matchType: 'REGEX' }, 'anything')).toBe(false); // invalid regex never matches
  });

  it('department rule beats global rule', () => {
    const rules = [
      rule({ kind: 'WEBSITE', pattern: 'web.whatsapp.com', matchType: 'EXACT', label: 'WhatsApp Web', category: 'NEUTRAL' }),
      rule({ kind: 'WEBSITE', pattern: 'web.whatsapp.com', matchType: 'EXACT', label: 'WhatsApp Web', category: 'PRODUCTIVE', departmentId: SALES }),
    ];
    expect(classify({ domain: 'web.whatsapp.com' }, rules, SALES).category).toBe('PRODUCTIVE');
    expect(classify({ domain: 'web.whatsapp.com' }, rules, 'dept-eng').category).toBe('NEUTRAL');
    expect(classify({ domain: 'web.whatsapp.com' }, rules, null).category).toBe('NEUTRAL');
  });

  it('department rule beats global even when the global rule is more specific (EXACT vs REGEX)', () => {
    const rules = [
      rule({ pattern: 'code', matchType: 'EXACT', category: 'PRODUCTIVE' }),
      rule({ pattern: '^co', matchType: 'REGEX', category: 'UNPRODUCTIVE', departmentId: SALES }),
    ];
    expect(classify({ app: 'code' }, rules, SALES).category).toBe('UNPRODUCTIVE');
  });

  it('EXACT > CONTAINS > REGEX within the same scope, then longer pattern', () => {
    const rules = [
      rule({ pattern: 'chrome', matchType: 'REGEX', category: 'BLOCKED' }),
      rule({ pattern: 'chrome', matchType: 'CONTAINS', category: 'UNPRODUCTIVE' }),
      rule({ pattern: 'chrome', matchType: 'EXACT', category: 'NEUTRAL' }),
    ];
    expect(classify({ app: 'chrome' }, rules, null).category).toBe('NEUTRAL');
    expect(classify({ app: 'chrome.exe' }, rules, null).category).toBe('UNPRODUCTIVE');
    expect(pickRule([rule({ pattern: 'google.com', matchType: 'EXACT', category: 'NEUTRAL' }), rule({ pattern: 'docs.google.com', matchType: 'EXACT', category: 'PRODUCTIVE' })], null)!.pattern).toBe('docs.google.com');
  });

  it('uses the domain when present (WEBSITE rules), else the app; unmatched -> UNCATEGORIZED', () => {
    const rules = [
      rule({ pattern: 'chrome', category: 'NEUTRAL', label: 'Chrome' }),
      rule({ kind: 'WEBSITE', pattern: 'github.com', matchType: 'EXACT', category: 'PRODUCTIVE', label: 'GitHub' }),
    ];
    expect(classify({ app: 'chrome', domain: 'https://github.com/x' }, rules, null)).toMatchObject({ category: 'PRODUCTIVE', label: 'GitHub', kind: 'WEBSITE' });
    expect(classify({ app: 'chrome' }, rules, null)).toMatchObject({ category: 'NEUTRAL', label: 'Chrome', kind: 'APP' });
    expect(classify({ app: 'chrome', domain: 'unknown-site.io' }, rules, null)).toMatchObject({ category: 'UNCATEGORIZED', label: 'unknown-site.io', kind: 'WEBSITE' });
    expect(classify({ app: 'mystery.exe' }, rules, null)).toMatchObject({ category: 'UNCATEGORIZED', label: 'mystery.exe' });
  });

  it('flags meeting apps by the "Meeting:" label prefix', () => {
    const rules = [rule({ pattern: 'teams', category: 'PRODUCTIVE', label: 'Meeting: Teams' })];
    expect(classify({ app: 'ms-teams.exe' }, rules, null).meeting).toBe(true);
  });

  it('seeded catalog classifies common apps as documented', () => {
    const seeded: RuleLike[] = DEFAULT_APP_RULES.map((r, i) => ({ ...r, id: `s${i}`, departmentId: r.departmentCode ? SALES : null }));
    const c = (input: { app?: string; domain?: string }, dept: string | null = null) => classify(input, seeded, dept);
    expect(c({ app: 'Code' }).label).toBe('VS Code');
    expect(c({ app: 'Code' }).category).toBe('PRODUCTIVE');
    expect(c({ app: 'Teams' })).toMatchObject({ meeting: true, label: 'Meeting: Teams' });
    expect(c({ app: 'chrome' }).category).toBe('NEUTRAL');
    expect(c({ app: 'chrome', domain: 'www.youtube.com' }).category).toBe('UNPRODUCTIVE');
    expect(c({ app: 'chrome', domain: 'thepiratebay.org' }).category).toBe('BLOCKED');
    expect(c({ app: 'chrome', domain: 'www.bet365.com' }).category).toBe('BLOCKED');
    expect(c({ app: 'chrome', domain: 'acme.lightning.force.com' }).label).toBe('Salesforce');
    expect(c({ app: 'chrome', domain: 'docs.google.com' }).label).toBe('Google Docs');
    expect(c({ domain: 'web.whatsapp.com' }).category).toBe('NEUTRAL');
    expect(c({ domain: 'web.whatsapp.com' }, SALES).category).toBe('PRODUCTIVE');
    expect(c({ app: 'uTorrent.exe' }).category).toBe('BLOCKED');
    expect(DEFAULT_APP_RULES.length).toBeGreaterThanOrEqual(60);
  });
});
