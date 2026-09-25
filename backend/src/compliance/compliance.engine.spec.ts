import {
  BUILT_IN_RULES,
  EngineDevice,
  EnginePatch,
  EnginePolicy,
  EngineRule,
  EngineSecurity,
  EngineSoftware,
  evaluate,
} from './compliance.engine';

const NOW = new Date('2026-09-25T12:00:00.000Z');
const DAY = 86_400_000;

const rules = (): EngineRule[] => BUILT_IN_RULES.map((r) => ({ ...r, enabled: true, platforms: [] }));

const policy = (over: Partial<EnginePolicy> = {}): EnginePolicy => ({
  companyDataOnlyManaged: true,
  usbStorageBlocked: true,
  blockUnauthorizedSoftware: true,
  requireAntivirus: true,
  requireEdr: true,
  requireFirewall: true,
  requireDiskEncryption: true,
  requireSecureBoot: false,
  maxAvSignatureAgeDays: 3,
  autoUpdateEnabled: true,
  patchDeadlineDays: 14,
  screenLockEnabled: true,
  screenLockTimeoutSec: 300,
  requirePasswordOnWake: true,
  ...over,
});

const device = (over: Partial<EngineDevice> = {}): EngineDevice => ({
  platform: 'WINDOWS',
  isCompanyOwned: true,
  lastSeenAt: new Date(NOW.getTime() - 60_000),
  ...over,
});

const security = (over: Partial<EngineSecurity> = {}): EngineSecurity => ({
  antivirusState: 'ENABLED',
  antivirusProduct: 'Microsoft Defender',
  antivirusSignatureAt: new Date(NOW.getTime() - DAY),
  edrState: 'ENABLED',
  edrProduct: 'CrowdStrike Falcon',
  firewallState: 'ENABLED',
  diskEncryptionState: 'ENABLED',
  encryptionMethod: 'BitLocker',
  secureBootState: 'ENABLED',
  screenLockEnabled: true,
  screenLockTimeoutSec: 300,
  passwordOnWake: true,
  autoUpdateEnabled: true,
  usbStorageEnabled: false,
  ...over,
});

function run(opts: {
  device?: Partial<EngineDevice>;
  security?: Partial<EngineSecurity> | null;
  software?: EngineSoftware[];
  patches?: EnginePatch[];
  policy?: Partial<EnginePolicy>;
  rules?: EngineRule[];
} = {}) {
  return evaluate(
    device(opts.device),
    opts.security === null ? null : security(opts.security ?? {}),
    opts.software ?? [],
    opts.patches ?? [],
    policy(opts.policy),
    opts.rules ?? rules(),
    NOW,
  );
}

const finding = (r: ReturnType<typeof run>, key: string) => r.findings.find((f) => f.ruleKey === key);
const failed = (r: ReturnType<typeof run>) => r.findings.filter((f) => !f.passed).map((f) => f.ruleKey).sort();

describe('compliance engine', () => {
  it('fully compliant device scores 100, COMPLIANT, risk NONE', () => {
    const r = run();
    expect(r.score).toBe(100);
    expect(r.state).toBe('COMPLIANT');
    expect(r.riskLevel).toBe('NONE');
    expect(failed(r)).toEqual([]);
    expect(r.findings).toHaveLength(13);
    expect(r.criticalCount + r.highCount + r.mediumCount + r.lowCount).toBe(0);
  });

  it('every finding carries the contract fields', () => {
    for (const f of run().findings) {
      expect(f).toEqual(
        expect.objectContaining({
          ruleKey: expect.any(String),
          name: expect.any(String),
          severity: expect.any(String),
          passed: expect.any(Boolean),
          markNonCompliant: expect.any(Boolean),
          weight: expect.any(Number),
          detail: expect.any(String),
          remediation: expect.any(String),
        }),
      );
    }
  });

  describe('USB_STORAGE_ENABLED', () => {
    it('fails when policy blocks USB and storage enabled', () => {
      const r = run({ security: { usbStorageEnabled: true } });
      expect(failed(r)).toEqual(['USB_STORAGE_ENABLED']);
      expect(r.score).toBe(85);
      expect(r.state).toBe('NON_COMPLIANT');
      expect(r.riskLevel).toBe('HIGH');
    });
    it('fails when USB state is unknown (!= false)', () => {
      expect(failed(run({ security: { usbStorageEnabled: null } }))).toEqual(['USB_STORAGE_ENABLED']);
    });
    it('passes when policy allows USB storage', () => {
      expect(failed(run({ security: { usbStorageEnabled: true }, policy: { usbStorageBlocked: false } }))).toEqual([]);
    });
  });

  describe('DISK_ENCRYPTION_DISABLED', () => {
    it('fails (CRITICAL, 25) when encryption not ENABLED', () => {
      const r = run({ security: { diskEncryptionState: 'DISABLED' } });
      expect(failed(r)).toEqual(['DISK_ENCRYPTION_DISABLED']);
      expect(r.score).toBe(75);
      expect(r.riskLevel).toBe('CRITICAL');
      expect(r.criticalCount).toBe(1);
      expect(r.state).toBe('NON_COMPLIANT');
    });
    it('passes when policy does not require it', () => {
      expect(failed(run({ security: { diskEncryptionState: 'DISABLED' }, policy: { requireDiskEncryption: false } }))).toEqual([]);
    });
  });

  describe('ANTIVIRUS_MISSING', () => {
    it('fails when antivirus NOT_INSTALLED', () => {
      const r = run({ security: { antivirusState: 'NOT_INSTALLED', antivirusSignatureAt: null } });
      expect(failed(r)).toEqual(['ANTIVIRUS_MISSING']);
      expect(r.score).toBe(75);
    });
    it('passes when not required', () => {
      expect(failed(run({ security: { antivirusState: 'DISABLED', antivirusSignatureAt: null }, policy: { requireAntivirus: false } }))).toEqual([]);
    });
  });

  describe('ANTIVIRUS_OUTDATED', () => {
    it('fails when signatures older than maxAvSignatureAgeDays but stays COMPLIANT (not marking)', () => {
      const r = run({ security: { antivirusSignatureAt: new Date(NOW.getTime() - 5 * DAY) } });
      expect(failed(r)).toEqual(['ANTIVIRUS_OUTDATED']);
      expect(r.score).toBe(95);
      expect(r.state).toBe('COMPLIANT');
      expect(r.riskLevel).toBe('MEDIUM');
      expect(r.mediumCount).toBe(1);
    });
    it('passes at exactly the maximum age', () => {
      expect(failed(run({ security: { antivirusSignatureAt: new Date(NOW.getTime() - 3 * DAY) } }))).toEqual([]);
    });
    it('passes when no signature date is reported', () => {
      expect(finding(run({ security: { antivirusSignatureAt: null } }), 'ANTIVIRUS_OUTDATED')?.passed).toBe(true);
    });
  });

  describe('EDR_MISSING', () => {
    it('fails when EDR not enabled', () => {
      const r = run({ security: { edrState: 'NOT_INSTALLED' } });
      expect(failed(r)).toEqual(['EDR_MISSING']);
      expect(r.score).toBe(85);
      expect(r.riskLevel).toBe('HIGH');
    });
    it('passes when policy does not require EDR', () => {
      expect(failed(run({ security: { edrState: 'NOT_INSTALLED' }, policy: { requireEdr: false } }))).toEqual([]);
    });
  });

  describe('FIREWALL_DISABLED', () => {
    it('fails when firewall disabled', () => {
      const r = run({ security: { firewallState: 'DISABLED' } });
      expect(failed(r)).toEqual(['FIREWALL_DISABLED']);
      expect(r.score).toBe(90);
      expect(r.state).toBe('NON_COMPLIANT');
    });
    it('passes when not required', () => {
      expect(failed(run({ security: { firewallState: 'DISABLED' }, policy: { requireFirewall: false } }))).toEqual([]);
    });
  });

  describe('UNAUTHORIZED_SOFTWARE', () => {
    it('fails for UNAUTHORIZED or BLACKLISTED items', () => {
      const r = run({ software: [{ name: 'uTorrent', status: 'BLACKLISTED' }, { name: 'Chrome', status: 'APPROVED' }] });
      expect(failed(r)).toEqual(['UNAUTHORIZED_SOFTWARE']);
      expect(r.score).toBe(85);
      expect(finding(r, 'UNAUTHORIZED_SOFTWARE')?.detail).toContain('uTorrent');
    });
    it('ignores removed items and UNKNOWN status', () => {
      const r = run({
        software: [
          { name: 'AnyDesk', status: 'BLACKLISTED', removedAt: new Date() },
          { name: 'Postman', status: 'UNKNOWN' },
        ],
      });
      expect(failed(r)).toEqual([]);
    });
  });

  describe('SCREEN_LOCK_DISABLED', () => {
    it('fails when screen lock disabled', () => {
      const r = run({ security: { screenLockEnabled: false } });
      expect(failed(r)).toEqual(['SCREEN_LOCK_DISABLED']);
      expect(r.score).toBe(90);
      expect(r.state).toBe('NON_COMPLIANT');
    });
    it('fails when timeout exceeds policy', () => {
      expect(failed(run({ security: { screenLockTimeoutSec: 900 } }))).toEqual(['SCREEN_LOCK_DISABLED']);
    });
    it('fails when password on wake required but missing', () => {
      expect(failed(run({ security: { passwordOnWake: false } }))).toEqual(['SCREEN_LOCK_DISABLED']);
    });
    it('passes when password on wake not required by policy', () => {
      expect(failed(run({ security: { passwordOnWake: false }, policy: { requirePasswordOnWake: false } }))).toEqual([]);
    });
    it('passes when policy does not enforce screen lock', () => {
      expect(failed(run({ security: { screenLockEnabled: false }, policy: { screenLockEnabled: false } }))).toEqual([]);
    });
  });

  describe('AUTO_UPDATE_DISABLED', () => {
    it('fails only when explicitly false', () => {
      const r = run({ security: { autoUpdateEnabled: false } });
      expect(failed(r)).toEqual(['AUTO_UPDATE_DISABLED']);
      expect(r.state).toBe('COMPLIANT');
      expect(r.score).toBe(95);
      expect(failed(run({ security: { autoUpdateEnabled: null } }))).toEqual([]);
    });
    it('passes when policy does not require auto update', () => {
      expect(failed(run({ security: { autoUpdateEnabled: false }, policy: { autoUpdateEnabled: false } }))).toEqual([]);
    });
  });

  describe('CRITICAL_PATCHES_MISSING', () => {
    const patch = (over: Partial<EnginePatch>): EnginePatch => ({
      patchId: 'KB5065000',
      state: 'MISSING',
      severity: 'CRITICAL',
      releasedAt: new Date(NOW.getTime() - 30 * DAY),
      ...over,
    });
    it('fails for a missing critical patch older than the deadline', () => {
      const r = run({ patches: [patch({})] });
      expect(failed(r)).toEqual(['CRITICAL_PATCHES_MISSING']);
      expect(r.score).toBe(90);
      expect(r.state).toBe('NON_COMPLIANT');
    });
    it('passes when within the deadline', () => {
      expect(failed(run({ patches: [patch({ releasedAt: new Date(NOW.getTime() - 5 * DAY) })] }))).toEqual([]);
    });
    it('ignores non-critical and installed patches', () => {
      expect(failed(run({ patches: [patch({ severity: 'IMPORTANT' }), patch({ state: 'INSTALLED' })] }))).toEqual([]);
    });
    it('falls back to detectedAt when releasedAt is absent', () => {
      expect(failed(run({ patches: [patch({ releasedAt: null, detectedAt: new Date(NOW.getTime() - 20 * DAY) })] }))).toEqual([
        'CRITICAL_PATCHES_MISSING',
      ]);
    });
  });

  describe('SECURE_BOOT_DISABLED', () => {
    it('fails only when policy requires Secure Boot', () => {
      expect(failed(run({ security: { secureBootState: 'DISABLED' } }))).toEqual([]);
      const r = run({ security: { secureBootState: 'DISABLED' }, policy: { requireSecureBoot: true } });
      expect(failed(r)).toEqual(['SECURE_BOOT_DISABLED']);
      expect(r.state).toBe('COMPLIANT');
      expect(r.score).toBe(95);
    });
  });

  describe('AGENT_OFFLINE', () => {
    it('fails when last seen more than 7 days ago (LOW, non-marking)', () => {
      const r = run({ device: { lastSeenAt: new Date(NOW.getTime() - 8 * DAY) } });
      expect(failed(r)).toEqual(['AGENT_OFFLINE']);
      expect(r.riskLevel).toBe('LOW');
      expect(r.lowCount).toBe(1);
      expect(r.state).toBe('COMPLIANT');
      expect(r.score).toBe(95);
    });
    it('fails when never seen', () => {
      expect(failed(run({ device: { lastSeenAt: null } }))).toEqual(['AGENT_OFFLINE']);
    });
  });

  describe('NOT_COMPANY_DEVICE', () => {
    it('fails for personal devices when company data is restricted', () => {
      const r = run({ device: { isCompanyOwned: false } });
      expect(failed(r)).toEqual(['NOT_COMPANY_DEVICE']);
      expect(r.score).toBe(70);
      expect(r.riskLevel).toBe('CRITICAL');
      expect(r.state).toBe('NON_COMPLIANT');
    });
    it('passes when policy allows personal devices', () => {
      expect(failed(run({ device: { isCompanyOwned: false }, policy: { companyDataOnlyManaged: false } }))).toEqual([]);
    });
  });

  describe('scoring, state and risk', () => {
    it('sums weights of failed rules and clamps at 0', () => {
      const r = run({
        device: { isCompanyOwned: false },
        security: { diskEncryptionState: 'DISABLED', antivirusState: 'DISABLED', edrState: 'NOT_INSTALLED', usbStorageEnabled: true },
      });
      // 30 + 25 + 25 + 15 + 15 = 110 -> 0
      expect(r.score).toBe(0);
      expect(r.riskLevel).toBe('CRITICAL');
      expect(r.criticalCount).toBe(3);
      expect(r.highCount).toBe(2);
    });

    it('computes combined deductions', () => {
      const r = run({ security: { firewallState: 'DISABLED', autoUpdateEnabled: false } });
      expect(r.score).toBe(85);
      expect(r.riskLevel).toBe('HIGH');
      expect(r.state).toBe('NON_COMPLIANT');
    });

    it('is UNKNOWN when no security data has been received (and skips security rules)', () => {
      const r = run({ security: null });
      expect(r.state).toBe('UNKNOWN');
      expect(r.findings.map((f) => f.ruleKey).sort()).toEqual(['AGENT_OFFLINE', 'CRITICAL_PATCHES_MISSING', 'NOT_COMPANY_DEVICE', 'UNAUTHORIZED_SOFTWARE']);
      expect(r.score).toBe(100);
    });

    it('NON_COMPLIANT beats UNKNOWN when a marking rule fails without security data', () => {
      const r = run({ security: null, device: { isCompanyOwned: false } });
      expect(r.state).toBe('NON_COMPLIANT');
    });

    it('respects rule configuration: disabled rules, weights, severity, markNonCompliant, platforms', () => {
      const custom = rules().map((r) => {
        if (r.key === 'FIREWALL_DISABLED') return { ...r, weight: 40, severity: 'CRITICAL', markNonCompliant: false };
        if (r.key === 'EDR_MISSING') return { ...r, enabled: false };
        if (r.key === 'DISK_ENCRYPTION_DISABLED') return { ...r, platforms: ['LINUX'] };
        return r;
      });
      const r = run({ rules: custom, security: { firewallState: 'DISABLED', edrState: 'NOT_INSTALLED', diskEncryptionState: 'DISABLED' } });
      expect(failed(r)).toEqual(['FIREWALL_DISABLED']);
      expect(r.score).toBe(60);
      expect(r.riskLevel).toBe('CRITICAL');
      expect(r.state).toBe('COMPLIANT');
      expect(r.findings.find((f) => f.ruleKey === 'EDR_MISSING')).toBeUndefined();
      expect(r.findings.find((f) => f.ruleKey === 'DISK_ENCRYPTION_DISABLED')).toBeUndefined();
    });

    it('ignores unknown rule keys', () => {
      const r = run({ rules: [...rules(), { key: 'CUSTOM_X', name: 'x', severity: 'HIGH', weight: 50, markNonCompliant: true, enabled: true }] });
      expect(r.findings.find((f) => f.ruleKey === 'CUSTOM_X')).toBeUndefined();
      expect(r.score).toBe(100);
    });

    it('seeds all 13 built-in rules with contract severities and weights', () => {
      const table: Record<string, [string, number, boolean]> = {
        USB_STORAGE_ENABLED: ['HIGH', 15, true],
        DISK_ENCRYPTION_DISABLED: ['CRITICAL', 25, true],
        ANTIVIRUS_MISSING: ['CRITICAL', 25, true],
        ANTIVIRUS_OUTDATED: ['MEDIUM', 5, false],
        EDR_MISSING: ['HIGH', 15, true],
        FIREWALL_DISABLED: ['HIGH', 10, true],
        UNAUTHORIZED_SOFTWARE: ['HIGH', 15, true],
        SCREEN_LOCK_DISABLED: ['MEDIUM', 10, true],
        AUTO_UPDATE_DISABLED: ['MEDIUM', 5, false],
        CRITICAL_PATCHES_MISSING: ['HIGH', 10, true],
        SECURE_BOOT_DISABLED: ['MEDIUM', 5, false],
        AGENT_OFFLINE: ['LOW', 5, false],
        NOT_COMPANY_DEVICE: ['CRITICAL', 30, true],
      };
      expect(BUILT_IN_RULES).toHaveLength(13);
      for (const r of BUILT_IN_RULES) expect([r.severity, r.weight, r.markNonCompliant]).toEqual(table[r.key]);
    });
  });
});
