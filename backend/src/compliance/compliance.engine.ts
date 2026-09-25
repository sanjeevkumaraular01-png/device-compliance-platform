/**
 * Pure compliance rule engine (docs/API.md "Built-in rules").
 * No I/O: callers load the device, security status, software, patches, effective
 * policy and rule configuration, then call `evaluate()`.
 */

export type Severity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type State = 'COMPLIANT' | 'NON_COMPLIANT' | 'UNKNOWN';
type Protection = 'ENABLED' | 'DISABLED' | 'NOT_INSTALLED' | 'OUTDATED' | 'UNKNOWN';

export interface ComplianceFinding {
  ruleKey: string;
  name: string;
  severity: Severity;
  passed: boolean;
  markNonCompliant: boolean;
  weight: number;
  detail: string;
  remediation: string;
}

export interface EngineDevice {
  platform: 'WINDOWS' | 'LINUX' | 'MACOS' | string;
  isCompanyOwned: boolean;
  lastSeenAt: Date | string | null;
}

export interface EngineSecurity {
  antivirusState: Protection | string;
  antivirusProduct?: string | null;
  antivirusSignatureAt?: Date | string | null;
  edrState: Protection | string;
  edrProduct?: string | null;
  firewallState: Protection | string;
  diskEncryptionState: Protection | string;
  encryptionMethod?: string | null;
  secureBootState: Protection | string;
  screenLockEnabled?: boolean | null;
  screenLockTimeoutSec?: number | null;
  passwordOnWake?: boolean | null;
  autoUpdateEnabled?: boolean | null;
  usbStorageEnabled?: boolean | null;
}

export interface EngineSoftware {
  name: string;
  version?: string | null;
  status: 'APPROVED' | 'UNAUTHORIZED' | 'BLACKLISTED' | 'UNKNOWN' | string;
  removedAt?: Date | string | null;
}

export interface EnginePatch {
  patchId: string;
  state: 'INSTALLED' | 'MISSING' | 'PENDING_INSTALL' | 'FAILED' | string;
  severity: 'CRITICAL' | 'IMPORTANT' | 'MODERATE' | 'LOW' | 'UNSPECIFIED' | string;
  releasedAt?: Date | string | null;
  detectedAt?: Date | string | null;
}

export interface EnginePolicy {
  companyDataOnlyManaged: boolean;
  usbStorageBlocked: boolean;
  blockUnauthorizedSoftware?: boolean;
  requireAntivirus: boolean;
  requireEdr: boolean;
  requireFirewall: boolean;
  requireDiskEncryption: boolean;
  requireSecureBoot: boolean;
  maxAvSignatureAgeDays: number;
  autoUpdateEnabled: boolean;
  patchDeadlineDays: number;
  screenLockEnabled: boolean;
  screenLockTimeoutSec: number;
  requirePasswordOnWake: boolean;
}

export interface EngineRule {
  key: string;
  name: string;
  severity: Severity | string;
  weight: number;
  markNonCompliant: boolean;
  enabled: boolean;
  platforms?: string[] | null;
}

export interface EvaluationResult {
  score: number;
  state: State;
  riskLevel: Severity;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  findings: ComplianceFinding[];
}

export const AGENT_OFFLINE_DAYS = 7;
const DAY_MS = 86_400_000;

const SEVERITY_RANK: Record<Severity, number> = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

/** Remediation guidance per rule. */
export const RULE_REMEDIATION: Record<string, string> = {
  USB_STORAGE_ENABLED: 'Block USB mass storage via device policy (agent enforces automatically) or whitelist approved devices.',
  DISK_ENCRYPTION_DISABLED: 'Enable full-disk encryption (BitLocker / FileVault / LUKS) and escrow the recovery key.',
  ANTIVIRUS_MISSING: 'Install and enable the corporate antivirus (e.g. Microsoft Defender) and ensure real-time protection is on.',
  ANTIVIRUS_OUTDATED: 'Update antivirus signatures and verify the device can reach the update service.',
  EDR_MISSING: 'Install the corporate EDR sensor (CrowdStrike Falcon / SentinelOne) and verify it is running.',
  FIREWALL_DISABLED: 'Enable the host firewall for all network profiles.',
  UNAUTHORIZED_SOFTWARE: 'Uninstall unauthorized or blacklisted software, or request approval via the software catalog.',
  SCREEN_LOCK_DISABLED: 'Enable automatic screen lock within the policy timeout and require a password on wake.',
  AUTO_UPDATE_DISABLED: 'Enable automatic OS updates.',
  CRITICAL_PATCHES_MISSING: 'Install missing critical security patches (deploy from the Patches page) and reboot if required.',
  SECURE_BOOT_DISABLED: 'Enable Secure Boot in the UEFI firmware settings.',
  AGENT_OFFLINE: 'Power on the device and ensure the SecureEndpoint agent service is running and can reach the server.',
  NOT_COMPANY_DEVICE: 'Access to company data is restricted to company-owned managed devices. Replace with a managed device.',
};

/** Rules that need a security status report to be evaluated. */
export const SECURITY_DEPENDENT_RULES = new Set([
  'USB_STORAGE_ENABLED',
  'DISK_ENCRYPTION_DISABLED',
  'ANTIVIRUS_MISSING',
  'ANTIVIRUS_OUTDATED',
  'EDR_MISSING',
  'FIREWALL_DISABLED',
  'SCREEN_LOCK_DISABLED',
  'AUTO_UPDATE_DISABLED',
  'SECURE_BOOT_DISABLED',
]);

const toDate = (d: Date | string | null | undefined): Date | null => (d ? new Date(d) : null);
const days = (ms: number) => Math.floor(ms / DAY_MS);

type Check = { failed: boolean; detail: string } | null; // null = not applicable

function checkRule(
  key: string,
  device: EngineDevice,
  security: EngineSecurity | null,
  software: EngineSoftware[],
  patches: EnginePatch[],
  policy: EnginePolicy,
  now: Date,
): Check {
  if (SECURITY_DEPENDENT_RULES.has(key) && !security) return null;
  const s = security as EngineSecurity;
  switch (key) {
    case 'USB_STORAGE_ENABLED': {
      if (!policy.usbStorageBlocked) return { failed: false, detail: 'Policy allows USB storage' };
      const failed = s.usbStorageEnabled !== false;
      return {
        failed,
        detail: failed
          ? s.usbStorageEnabled === true
            ? 'USB mass storage is enabled but policy requires it to be blocked'
            : 'USB mass storage state unknown; policy requires it to be blocked'
          : 'USB mass storage is blocked',
      };
    }
    case 'DISK_ENCRYPTION_DISABLED': {
      if (!policy.requireDiskEncryption) return { failed: false, detail: 'Policy does not require disk encryption' };
      const failed = s.diskEncryptionState !== 'ENABLED';
      return {
        failed,
        detail: failed
          ? `Disk encryption is ${s.diskEncryptionState}`
          : `Disk encrypted${s.encryptionMethod ? ` (${s.encryptionMethod})` : ''}`,
      };
    }
    case 'ANTIVIRUS_MISSING': {
      if (!policy.requireAntivirus) return { failed: false, detail: 'Policy does not require antivirus' };
      const failed = s.antivirusState !== 'ENABLED';
      return {
        failed,
        detail: failed
          ? `Antivirus is ${s.antivirusState}${s.antivirusProduct ? ` (${s.antivirusProduct})` : ''}`
          : `Antivirus active${s.antivirusProduct ? ` (${s.antivirusProduct})` : ''}`,
      };
    }
    case 'ANTIVIRUS_OUTDATED': {
      const sigAt = toDate(s.antivirusSignatureAt);
      const maxDays = policy.maxAvSignatureAgeDays;
      if (s.antivirusState === 'OUTDATED') {
        return { failed: true, detail: 'Antivirus reports outdated signatures' };
      }
      if (!sigAt) return { failed: false, detail: 'No signature date reported' };
      const age = now.getTime() - sigAt.getTime();
      const failed = age > maxDays * DAY_MS;
      return {
        failed,
        detail: failed
          ? `Antivirus signatures are ${days(age)} days old (max ${maxDays})`
          : `Antivirus signatures are current (${days(Math.max(0, age))} days old)`,
      };
    }
    case 'EDR_MISSING': {
      if (!policy.requireEdr) return { failed: false, detail: 'Policy does not require EDR' };
      const failed = s.edrState !== 'ENABLED';
      return {
        failed,
        detail: failed
          ? `EDR is ${s.edrState}${s.edrProduct ? ` (${s.edrProduct})` : ''}`
          : `EDR active${s.edrProduct ? ` (${s.edrProduct})` : ''}`,
      };
    }
    case 'FIREWALL_DISABLED': {
      if (!policy.requireFirewall) return { failed: false, detail: 'Policy does not require firewall' };
      const failed = s.firewallState !== 'ENABLED';
      return { failed, detail: failed ? `Firewall is ${s.firewallState}` : 'Firewall enabled' };
    }
    case 'UNAUTHORIZED_SOFTWARE': {
      const bad = software.filter(
        (x) => !x.removedAt && (x.status === 'UNAUTHORIZED' || x.status === 'BLACKLISTED'),
      );
      if (!bad.length) return { failed: false, detail: 'No unauthorized software installed' };
      const blacklisted = bad.filter((x) => x.status === 'BLACKLISTED').length;
      const names = bad.slice(0, 5).map((x) => x.name).join(', ');
      return {
        failed: true,
        detail: `${bad.length} unauthorized item(s) (${blacklisted} blacklisted): ${names}${bad.length > 5 ? ', …' : ''}`,
      };
    }
    case 'SCREEN_LOCK_DISABLED': {
      if (!policy.screenLockEnabled) return { failed: false, detail: 'Policy does not enforce screen lock' };
      const problems: string[] = [];
      if (!s.screenLockEnabled) problems.push('screen lock disabled');
      if (s.screenLockTimeoutSec != null && s.screenLockTimeoutSec > policy.screenLockTimeoutSec) {
        problems.push(`timeout ${s.screenLockTimeoutSec}s exceeds ${policy.screenLockTimeoutSec}s`);
      }
      if (policy.requirePasswordOnWake && !s.passwordOnWake) problems.push('password on wake not required');
      return problems.length
        ? { failed: true, detail: `Screen lock non-compliant: ${problems.join('; ')}` }
        : { failed: false, detail: `Screen lock after ${s.screenLockTimeoutSec ?? '?'}s with password` };
    }
    case 'AUTO_UPDATE_DISABLED': {
      if (!policy.autoUpdateEnabled) return { failed: false, detail: 'Policy does not require automatic updates' };
      const failed = s.autoUpdateEnabled === false;
      return { failed, detail: failed ? 'Automatic updates are disabled' : 'Automatic updates enabled' };
    }
    case 'CRITICAL_PATCHES_MISSING': {
      const cutoff = now.getTime() - policy.patchDeadlineDays * DAY_MS;
      const overdue = patches.filter((p) => {
        if (p.state !== 'MISSING' || p.severity !== 'CRITICAL') return false;
        const since = toDate(p.releasedAt) ?? toDate(p.detectedAt);
        return since !== null && since.getTime() < cutoff;
      });
      if (!overdue.length) return { failed: false, detail: 'No overdue critical patches' };
      return {
        failed: true,
        detail: `${overdue.length} critical patch(es) missing beyond ${policy.patchDeadlineDays}-day deadline: ${overdue
          .slice(0, 5)
          .map((p) => p.patchId)
          .join(', ')}`,
      };
    }
    case 'SECURE_BOOT_DISABLED': {
      if (!policy.requireSecureBoot) return { failed: false, detail: 'Policy does not require Secure Boot' };
      const failed = s.secureBootState !== 'ENABLED';
      return { failed, detail: failed ? `Secure Boot is ${s.secureBootState}` : 'Secure Boot enabled' };
    }
    case 'AGENT_OFFLINE': {
      const seen = toDate(device.lastSeenAt);
      if (!seen) return { failed: true, detail: 'Agent has never checked in' };
      const age = now.getTime() - seen.getTime();
      const failed = age > AGENT_OFFLINE_DAYS * DAY_MS;
      return {
        failed,
        detail: failed ? `Agent last seen ${days(age)} days ago` : 'Agent checked in within the last 7 days',
      };
    }
    case 'NOT_COMPANY_DEVICE': {
      if (!policy.companyDataOnlyManaged) return { failed: false, detail: 'Policy allows personal devices' };
      return device.isCompanyOwned
        ? { failed: false, detail: 'Company-owned device' }
        : { failed: true, detail: 'Personal (non-company) device accessing company data' };
    }
    default:
      return null; // unknown rule keys are ignored
  }
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * Evaluate a device against the effective policy and rule configuration.
 * Score = max(0, 100 − Σ weight of failed rules).
 * State = NON_COMPLIANT if any failed rule has markNonCompliant, UNKNOWN if no
 * security data received yet, else COMPLIANT. Risk = highest failed severity.
 */
export function evaluate(
  device: EngineDevice,
  security: EngineSecurity | null,
  software: EngineSoftware[],
  patches: EnginePatch[],
  policy: EnginePolicy,
  rules: EngineRule[],
  now: Date = new Date(),
): EvaluationResult {
  const findings: ComplianceFinding[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.platforms && rule.platforms.length && !rule.platforms.includes(device.platform)) continue;
    const check = checkRule(rule.key, device, security, software, patches, policy, now);
    if (!check) continue;
    findings.push({
      ruleKey: rule.key,
      name: rule.name,
      severity: rule.severity as Severity,
      passed: !check.failed,
      markNonCompliant: rule.markNonCompliant,
      weight: rule.weight,
      detail: check.detail,
      remediation: RULE_REMEDIATION[rule.key] ?? '',
    });
  }

  const failed = findings.filter((f) => !f.passed);
  const penalty = failed.reduce((sum, f) => sum + Math.max(0, f.weight), 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const riskLevel = failed.reduce<Severity>((acc, f) => maxSeverity(acc, f.severity), 'NONE');

  let state: State;
  if (failed.some((f) => f.markNonCompliant)) state = 'NON_COMPLIANT';
  else if (!security) state = 'UNKNOWN';
  else state = 'COMPLIANT';

  return {
    score,
    state,
    riskLevel,
    criticalCount: failed.filter((f) => f.severity === 'CRITICAL').length,
    highCount: failed.filter((f) => f.severity === 'HIGH').length,
    mediumCount: failed.filter((f) => f.severity === 'MEDIUM').length,
    lowCount: failed.filter((f) => f.severity === 'LOW').length,
    findings,
  };
}

/** Built-in rule definitions (seeded). */
export const BUILT_IN_RULES: {
  key: string;
  name: string;
  description: string;
  severity: Severity;
  weight: number;
  markNonCompliant: boolean;
}[] = [
  { key: 'USB_STORAGE_ENABLED', name: 'USB storage enabled', description: 'USB mass storage must be blocked when required by policy', severity: 'HIGH', weight: 15, markNonCompliant: true },
  { key: 'DISK_ENCRYPTION_DISABLED', name: 'Disk encryption disabled', description: 'System disk must be fully encrypted', severity: 'CRITICAL', weight: 25, markNonCompliant: true },
  { key: 'ANTIVIRUS_MISSING', name: 'Antivirus missing or disabled', description: 'Antivirus must be installed and enabled', severity: 'CRITICAL', weight: 25, markNonCompliant: true },
  { key: 'ANTIVIRUS_OUTDATED', name: 'Antivirus signatures outdated', description: 'Signatures must be newer than the policy maximum age', severity: 'MEDIUM', weight: 5, markNonCompliant: false },
  { key: 'EDR_MISSING', name: 'EDR missing or disabled', description: 'An EDR sensor must be installed and running', severity: 'HIGH', weight: 15, markNonCompliant: true },
  { key: 'FIREWALL_DISABLED', name: 'Firewall disabled', description: 'Host firewall must be enabled', severity: 'HIGH', weight: 10, markNonCompliant: true },
  { key: 'UNAUTHORIZED_SOFTWARE', name: 'Unauthorized software installed', description: 'Only approved software may be installed', severity: 'HIGH', weight: 15, markNonCompliant: true },
  { key: 'SCREEN_LOCK_DISABLED', name: 'Screen lock non-compliant', description: 'Screen must lock within the policy timeout and require a password', severity: 'MEDIUM', weight: 10, markNonCompliant: true },
  { key: 'AUTO_UPDATE_DISABLED', name: 'Automatic updates disabled', description: 'OS automatic updates must be enabled', severity: 'MEDIUM', weight: 5, markNonCompliant: false },
  { key: 'CRITICAL_PATCHES_MISSING', name: 'Critical patches missing', description: 'Critical patches must be installed within the patch deadline', severity: 'HIGH', weight: 10, markNonCompliant: true },
  { key: 'SECURE_BOOT_DISABLED', name: 'Secure Boot disabled', description: 'UEFI Secure Boot must be enabled when required', severity: 'MEDIUM', weight: 5, markNonCompliant: false },
  { key: 'AGENT_OFFLINE', name: 'Agent offline', description: 'Agent has not checked in for more than 7 days', severity: 'LOW', weight: 5, markNonCompliant: false },
  { key: 'NOT_COMPANY_DEVICE', name: 'Not a company device', description: 'Company data may only be accessed from company-owned devices', severity: 'CRITICAL', weight: 30, markNonCompliant: true },
];
