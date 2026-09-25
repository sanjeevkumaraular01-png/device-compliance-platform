import { CatalogRule, classifySoftware, compareVersions, isOsBundled, matchesName } from './software.classifier';

const wl: CatalogRule[] = [
  { id: 'w-chrome', name: 'Google Chrome', publisher: 'Google', matchType: 'CONTAINS' },
  { id: 'w-git', name: 'Git', matchType: 'EXACT' },
  { id: 'w-np', name: 'Notepad++', matchType: 'CONTAINS', platform: 'WINDOWS' },
  { id: 'w-zoom', name: 'Zoom', matchType: 'CONTAINS', minVersion: '6.0.0' },
];
const bl: CatalogRule[] = [
  { id: 'b-tv', name: 'TeamViewer', matchType: 'CONTAINS' },
  { id: 'b-crack', name: '\\b(keygen|crack(ed)?)\\b', matchType: 'REGEX' },
  { id: 'b-chrome-ext', name: 'Google Chrome Evil Edition', matchType: 'EXACT' },
];

const classify = (item: Parameters<typeof classifySoftware>[0], block = true, platform = 'WINDOWS') =>
  classifySoftware(item, wl, bl, { platform, blockUnauthorized: block });

describe('software classifier', () => {
  it('blacklist match wins -> BLACKLISTED (even over whitelist)', () => {
    expect(classify({ name: 'TeamViewer 15' })).toEqual({ status: 'BLACKLISTED', matchedRuleId: 'b-tv' });
    expect(classify({ name: 'Google Chrome Evil Edition', publisher: 'Google' })).toEqual({ status: 'BLACKLISTED', matchedRuleId: 'b-chrome-ext' });
  });

  it('REGEX blacklist rules are case-insensitive', () => {
    expect(classify({ name: 'WinRAR 7.13 KeyGen' }).status).toBe('BLACKLISTED');
    expect(classify({ name: 'Photoshop Cracked' }).status).toBe('BLACKLISTED');
    expect(classify({ name: 'Crackle streaming' }).status).toBe('UNAUTHORIZED');
  });

  it('whitelist match -> APPROVED with matched rule id', () => {
    expect(classify({ name: 'Google Chrome', publisher: 'Google LLC' })).toEqual({ status: 'APPROVED', matchedRuleId: 'w-chrome' });
  });

  it('whitelist publisher constraint must match', () => {
    expect(classify({ name: 'Google Chrome', publisher: 'Totally Legit Ltd' }).status).toBe('UNAUTHORIZED');
    expect(classify({ name: 'Google Chrome' }).status).toBe('UNAUTHORIZED');
  });

  it('EXACT is exact but case-insensitive', () => {
    expect(classify({ name: 'git' }).status).toBe('APPROVED');
    expect(classify({ name: 'GitHub Desktop' }).status).toBe('UNAUTHORIZED');
  });

  it('platform-scoped rules only apply to that platform', () => {
    expect(classify({ name: 'Notepad++ (64-bit x64)' }, true, 'WINDOWS').status).toBe('APPROVED');
    expect(classify({ name: 'Notepad++ (64-bit x64)' }, true, 'LINUX').status).toBe('UNAUTHORIZED');
  });

  it('minVersion excludes older versions', () => {
    expect(classify({ name: 'Zoom Workplace', version: '6.5.12' }).status).toBe('APPROVED');
    expect(classify({ name: 'Zoom Workplace', version: '5.17.1' }).status).toBe('UNAUTHORIZED');
  });

  it('unmatched -> UNAUTHORIZED when policy blocks, else UNKNOWN', () => {
    expect(classify({ name: 'Postman' }, true)).toEqual({ status: 'UNAUTHORIZED', matchedRuleId: null });
    expect(classify({ name: 'Postman' }, false)).toEqual({ status: 'UNKNOWN', matchedRuleId: null });
  });

  it('OS-bundled components (Microsoft/Apple/Canonical + source system) are APPROVED', () => {
    expect(classify({ name: 'Microsoft Visual C++ 2015 Redistributable', publisher: 'Microsoft Corporation', source: 'system' }).status).toBe('APPROVED');
    expect(classify({ name: 'Safari', publisher: 'Apple', source: 'system' }, true, 'MACOS').status).toBe('APPROVED');
    expect(classify({ name: 'openssl', publisher: 'Canonical Ltd.', source: 'system' }, true, 'LINUX').status).toBe('APPROVED');
    expect(classify({ name: 'Some MS tool', publisher: 'Microsoft Corporation', source: 'msi' }).status).toBe('UNAUTHORIZED');
    expect(isOsBundled({ name: 'x', publisher: 'Random Vendor', source: 'system' })).toBe(false);
  });

  it('blacklist still applies to OS publishers', () => {
    expect(classify({ name: 'TeamViewer', publisher: 'Microsoft Corporation', source: 'system' }).status).toBe('BLACKLISTED');
  });

  it('invalid regex patterns never match (and never throw)', () => {
    expect(matchesName('anything', '([unclosed', 'REGEX')).toBe(false);
  });

  it('compareVersions orders dotted versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('2.0', '2.0.0')).toBe(0);
    expect(compareVersions('3.1', '3.2')).toBe(-1);
  });
});
