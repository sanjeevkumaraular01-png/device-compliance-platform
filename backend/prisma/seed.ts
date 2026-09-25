/**
 * SecureEndpoint Manager seed (idempotent).
 *
 *  - Always: roles + permission matrix, super admin, departments, policies,
 *    compliance rules, software whitelist/blacklist catalog.
 *  - SEED_DEMO_DATA=true (once, guarded by the `seed.demoVersion` setting):
 *    demo users per role, employees, ~60 devices with security/software/patch
 *    state evaluated by the real compliance engine, 30-day compliance history,
 *    USB whitelist/events/requests, alerts, channels, login history, audit trail
 *    (through the hash chain), report rows and a schedule.
 *
 * Runs with ts-node in development (`npm run seed`) and from compiled JS in
 * production (`node dist/prisma/seed.js`).
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  AlertCategory,
  AlertSeverity,
  AuditCategory,
  DeviceStatus,
  DeviceType,
  OsPlatform,
  PatchCategory,
  PatchSeverity,
  PatchState,
  Prisma,
  PrismaClient,
  RoleKey,
  UsbDeviceClass,

} from '@prisma/client';
import { ROLE_DEFINITIONS, defaultPermissionsFor } from '../src/common/permissions';
import { hashPassword } from '../src/auth/password.util';
import { BUILT_IN_RULES, EngineSecurity, evaluate, EvaluationResult } from '../src/compliance/compliance.engine';
import { classifySoftware } from '../src/software/software.classifier';
import { appendAuditLog, AuditEntryInput } from '../src/audit/audit-chain';
import { CryptoCore } from '../src/common/crypto.service';
import { renderCsv, renderPdf, ReportDataset } from '../src/reports/renderers/renderers';

const rootClient = new PrismaClient();
// Rebound to a transaction client while the demo seed runs, so a failed demo seed rolls back completely.
let prisma: PrismaClient = rootClient;
const DEMO_VERSION = 1;
const DAY = 86_400_000;
const NOW = new Date();

const env = (k: string, d = '') => (process.env[k] ?? d).trim();
const bool = (k: string, d: boolean) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k] === 'true');

// ── deterministic PRNG (mulberry32) ──
let rngState = 20260925;
function rand(): number {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const chance = (p: number) => rand() < p;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const daysAgo = (d: number) => ago(d * DAY);
const hex = (n: number) => Array.from({ length: n }, () => '0123456789ABCDEF'[int(0, 15)]).join('');
function weighted<T>(items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of items) {
    if ((r -= w) <= 0) return v;
  }
  return items[items.length - 1][0];
}

// ─────────────────────────────── Catalog data ───────────────────────────────

const DEPARTMENTS = [
  { name: 'Engineering', code: 'ENG', description: 'Product engineering and platform teams' },
  { name: 'Finance', code: 'FIN', description: 'Finance, accounting and payroll' },
  { name: 'Human Resources', code: 'HR', description: 'People operations and recruiting' },
  { name: 'Sales', code: 'SALES', description: 'Sales and account management' },
  { name: 'Operations', code: 'OPS', description: 'Business operations and facilities' },
  { name: 'Legal', code: 'LEGAL', description: 'Legal and compliance counsel' },
  { name: 'IT', code: 'IT', description: 'Corporate IT and security' },
];

type WL = {
  name: string; publisher?: string; matchType?: 'EXACT' | 'CONTAINS' | 'REGEX'; category: string; platform?: OsPlatform;
  licenseType?: string; licenseCount?: number; costPerSeat?: number; licenseExpiresInDays?: number; vendorUrl?: string; licenseKey?: string;
};
const WHITELIST: WL[] = [
  { name: 'Microsoft 365', publisher: 'Microsoft', category: 'Productivity', licenseType: 'SUBSCRIPTION', licenseCount: 60, costPerSeat: 22, licenseExpiresInDays: 240, vendorUrl: 'https://www.microsoft.com/microsoft-365', licenseKey: 'M365-E3-TENANT-4F2A-9C1B' },
  { name: 'Microsoft Office', publisher: 'Microsoft', category: 'Productivity' },
  { name: 'Microsoft Word', publisher: 'Microsoft', category: 'Productivity', platform: 'MACOS' },
  { name: 'Microsoft Edge', publisher: 'Microsoft', category: 'Browser', licenseType: 'FREE' },
  { name: 'Microsoft Teams', publisher: 'Microsoft', category: 'Collaboration' },
  { name: 'Microsoft OneDrive', publisher: 'Microsoft', category: 'Storage' },
  { name: 'Google Chrome', publisher: 'Google', category: 'Browser', licenseType: 'FREE' },
  { name: 'Mozilla Firefox', publisher: 'Mozilla', category: 'Browser', licenseType: 'FREE' },
  { name: 'Firefox', matchType: 'EXACT', category: 'Browser', platform: 'LINUX', licenseType: 'FREE' },
  { name: 'Slack', publisher: 'Slack Technologies', category: 'Collaboration', licenseType: 'SUBSCRIPTION', licenseCount: 50, costPerSeat: 8.75, licenseExpiresInDays: 150, vendorUrl: 'https://slack.com' },
  { name: 'Zoom', category: 'Collaboration', licenseType: 'SUBSCRIPTION', licenseCount: 30, costPerSeat: 13.33, licenseExpiresInDays: 90, vendorUrl: 'https://zoom.us' },
  { name: 'Visual Studio Code', publisher: 'Microsoft', category: 'Development', licenseType: 'FREE' },
  { name: 'code', matchType: 'EXACT', category: 'Development', platform: 'LINUX', licenseType: 'FREE' },
  { name: '7-Zip', category: 'Utilities', licenseType: 'FREE' },
  { name: 'Adobe Acrobat Reader', publisher: 'Adobe', category: 'Productivity', licenseType: 'FREE' },
  { name: 'CrowdStrike Falcon', publisher: 'CrowdStrike', category: 'Security', licenseType: 'PER_SEAT', licenseCount: 100, costPerSeat: 8.99, licenseExpiresInDays: 300 },
  { name: 'SentinelOne', category: 'Security', licenseType: 'PER_SEAT', licenseCount: 40, costPerSeat: 6.5, licenseExpiresInDays: 200 },
  { name: 'Git', matchType: 'EXACT', category: 'Development', licenseType: 'FREE' },
  { name: 'Docker Desktop', publisher: 'Docker', category: 'Development', licenseType: 'SUBSCRIPTION', licenseCount: 15, costPerSeat: 9, licenseExpiresInDays: -12, vendorUrl: 'https://www.docker.com' },
  { name: 'docker-ce', matchType: 'EXACT', category: 'Development', platform: 'LINUX', licenseType: 'FREE' },
  { name: 'Python', category: 'Development', licenseType: 'FREE' },
  { name: 'Node.js', category: 'Development', licenseType: 'FREE' },
  { name: '1Password', publisher: 'AgileBits', category: 'Security', licenseType: 'PER_SEAT', licenseCount: 25, costPerSeat: 7.99, licenseExpiresInDays: 45 },
  { name: 'Notepad++', category: 'Utilities', platform: 'WINDOWS', licenseType: 'FREE' },
  { name: 'VLC media player', category: 'Media', licenseType: 'FREE' },
  { name: 'Cisco Secure Client', publisher: 'Cisco', category: 'Networking', licenseType: 'SITE' },
  { name: 'Microsoft Defender', publisher: 'Microsoft', category: 'Security' },
  { name: 'ClamAV', matchType: 'EXACT', category: 'Security', platform: 'LINUX', licenseType: 'FREE' },
  { name: 'openssh-client', matchType: 'EXACT', category: 'Utilities', platform: 'LINUX', licenseType: 'FREE' },
];

const BLACKLIST = [
  { name: 'uTorrent', matchType: 'CONTAINS', reason: 'Peer-to-peer file sharing is prohibited (data leakage, malware, piracy)', severity: 'HIGH', autoUninstall: true },
  { name: 'BitTorrent', matchType: 'CONTAINS', reason: 'Peer-to-peer file sharing is prohibited', severity: 'HIGH', autoUninstall: true },
  { name: 'TeamViewer', matchType: 'CONTAINS', reason: 'Unapproved remote access tool - use the corporate remote support solution', severity: 'HIGH', autoUninstall: false },
  { name: 'AnyDesk', matchType: 'CONTAINS', reason: 'Unapproved remote access tool frequently abused by attackers', severity: 'CRITICAL', autoUninstall: true },
  { name: 'CCleaner', matchType: 'CONTAINS', reason: 'Tampers with system configuration and security logs', severity: 'MEDIUM', autoUninstall: false },
  { name: 'Tor Browser', matchType: 'CONTAINS', reason: 'Anonymising network bypasses web filtering and DLP', severity: 'HIGH', autoUninstall: false },
  { name: 'Cheat Engine', matchType: 'CONTAINS', reason: 'Memory editing tool bundled with adware', severity: 'HIGH', autoUninstall: true },
  { name: '\\b(keygen|crack(ed)?|warez|kms[\\s-]?activator)\\b', matchType: 'REGEX', reason: 'Software cracks, key generators and activators (e.g. WinRAR crack/keygen) are illegal and commonly carry malware', severity: 'CRITICAL', autoUninstall: true },
  { name: 'Mimikatz', matchType: 'CONTAINS', reason: 'Credential dumping tool', severity: 'CRITICAL', autoUninstall: true },
  { name: 'Ammyy Admin', matchType: 'CONTAINS', reason: 'Unapproved remote administration tool', severity: 'HIGH', autoUninstall: false },
] as const;

// ─────────────────────────────── Base seed ───────────────────────────────

async function seedBase() {
  for (const r of ROLE_DEFINITIONS) {
    await prisma.role.upsert({
      where: { key: r.key },
      create: { key: r.key, name: r.name, description: r.description, permissions: defaultPermissionsFor(r.key), isSystem: true },
      // Keep permission edits made by a Super Admin, except SUPER_ADMIN which always has everything.
      update: { name: r.name, description: r.description, ...(r.key === 'SUPER_ADMIN' ? { permissions: defaultPermissionsFor(r.key) } : {}) },
    });
  }
  const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.key, r])) as unknown as Record<RoleKey, { id: string }>;

  const adminEmail = env('SEED_ADMIN_EMAIL', 'admin@secureendpoint.local').toLowerCase();
  const adminPassword = env('SEED_ADMIN_PASSWORD', 'ChangeMe!Secure2026');
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  const admin = existingAdmin
    ? await prisma.user.update({ where: { id: existingAdmin.id }, data: { roleId: roles.SUPER_ADMIN.id, isActive: true } })
    : await prisma.user.create({
        data: {
          email: adminEmail,
          displayName: 'System Administrator',
          roleId: roles.SUPER_ADMIN.id,
          jobTitle: 'Platform Administrator',
          passwordHash: await hashPassword(adminPassword),
          passwordChangedAt: NOW,
        },
      });

  const depts: Record<string, { id: string }> = {};
  for (const d of DEPARTMENTS) {
    depts[d.name] = await prisma.department.upsert({ where: { code: d.code }, create: d, update: { name: d.name, description: d.description } });
  }
  if (!admin.departmentId) await prisma.user.update({ where: { id: admin.id }, data: { departmentId: depts.IT.id } });

  const baseline = await prisma.devicePolicy.upsert({
    where: { name: 'Corporate Baseline' },
    create: {
      name: 'Corporate Baseline',
      description: 'Default security baseline applied to every managed device',
      isDefault: true,
      priority: 100,
      createdById: admin.id,
    },
    update: {},
  });
  // Exactly one default policy
  if (!(await prisma.devicePolicy.findFirst({ where: { isDefault: true, id: { not: baseline.id } } })) && !baseline.isDefault) {
    await prisma.devicePolicy.update({ where: { id: baseline.id }, data: { isDefault: true } });
  }
  const engPolicy = await prisma.devicePolicy.upsert({
    where: { name: 'Engineering Workstations' },
    create: {
      name: 'Engineering Workstations',
      description: 'Developer workstations: flexible tooling, strict encryption and EDR',
      priority: 50,
      blockUnauthorizedSoftware: false,
      screenLockTimeoutSec: 600,
      patchDeadlineDays: 14,
      maxAvSignatureAgeDays: 3,
      inventoryIntervalSec: 1800,
      createdById: admin.id,
    },
    update: {},
  });
  const finPolicy = await prisma.devicePolicy.upsert({
    where: { name: 'Finance High Security' },
    create: {
      name: 'Finance High Security',
      description: 'Regulated finance devices (SOX/PCI): read-only USB, Secure Boot, fast patching',
      priority: 10,
      usbReadOnly: true,
      requireSecureBoot: true,
      autoUninstallBlacklisted: true,
      maxAvSignatureAgeDays: 2,
      patchDeadlineDays: 7,
      screenLockTimeoutSec: 180,
      checkinIntervalSec: 180,
      createdById: admin.id,
    },
    update: {},
  });
  await prisma.department.update({ where: { id: depts.Engineering.id }, data: { policyId: engPolicy.id } });
  await prisma.department.update({ where: { id: depts.Finance.id }, data: { policyId: finPolicy.id } });

  for (const r of BUILT_IN_RULES) {
    await prisma.complianceRule.upsert({
      where: { key: r.key },
      create: { ...r, enabled: true, platforms: [] },
      update: { name: r.name, description: r.description },
    });
  }

  const crypto = process.env.ENCRYPTION_KEY ? new CryptoCore(process.env.ENCRYPTION_KEY) : null;
  for (const w of WHITELIST) {
    const data = {
      name: w.name,
      publisher: w.publisher ?? null,
      matchType: w.matchType ?? 'CONTAINS',
      category: w.category,
      platform: w.platform ?? null,
      licenseType: w.licenseType ?? null,
      licenseCount: w.licenseCount ?? null,
      costPerSeat: w.costPerSeat != null ? new Prisma.Decimal(w.costPerSeat) : null,
      licenseExpiresAt: w.licenseExpiresInDays != null ? new Date(NOW.getTime() + w.licenseExpiresInDays * DAY) : null,
      vendorUrl: w.vendorUrl ?? null,
      licenseKeyEnc: w.licenseKey && crypto ? crypto.encrypt(w.licenseKey) : null,
      approvedById: admin.id,
    };
    const existing = await prisma.softwareWhitelist.findFirst({ where: { name: w.name, platform: w.platform ?? null } });
    if (!existing) await prisma.softwareWhitelist.create({ data });
  }
  for (const b of BLACKLIST) {
    const existing = await prisma.softwareBlacklist.findFirst({ where: { name: b.name, platform: null } });
    if (!existing) {
      await prisma.softwareBlacklist.create({
        data: { name: b.name, matchType: b.matchType, reason: b.reason, severity: b.severity, autoUninstall: b.autoUninstall, createdById: admin.id },
      });
    }
  }

  return { admin, roles, depts, policies: { baseline, engPolicy, finPolicy } };
}

// ─────────────────────────────── Demo data ───────────────────────────────

const FIRST = ['Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Mason', 'Isabella', 'Lucas', 'Mia', 'Aiden', 'Priya', 'Arjun', 'Chen', 'Mei', 'Fatima', 'Omar', 'Sofia', 'Mateo', 'Hannah', 'Jonas', 'Chloe', 'Daniel', 'Grace', 'Samuel', 'Aisha', 'Kenji', 'Elena', 'Marcus', 'Nora', 'Ravi'];
const LAST = ['Johnson', 'Smith', 'Patel', 'Garcia', 'Nguyen', 'Kim', 'Müller', 'Rossi', 'Brown', 'Williams', 'Khan', 'Silva', 'Andersson', 'Tanaka', 'Novak', 'Dubois', 'Walker', 'Lopez', 'Singh', 'Cohen', 'Martin', 'Okafor', 'Hughes', 'Fischer'];
const JOB: Record<string, string[]> = {
  Engineering: ['Software Engineer', 'Senior Software Engineer', 'DevOps Engineer', 'QA Engineer', 'Staff Engineer'],
  Finance: ['Accountant', 'Financial Analyst', 'Payroll Specialist', 'Controller'],
  'Human Resources': ['HR Business Partner', 'Recruiter', 'People Ops Specialist'],
  Sales: ['Account Executive', 'Sales Engineer', 'SDR', 'Sales Manager'],
  Operations: ['Operations Analyst', 'Facilities Coordinator', 'Procurement Specialist'],
  Legal: ['Corporate Counsel', 'Paralegal', 'Compliance Analyst'],
  IT: ['Systems Administrator', 'Service Desk Analyst', 'Network Engineer'],
};

type HwModel = { manufacturer: string; model: string; cpu: string; ram: number[]; storage: number[]; type: DeviceType };
const HW: Record<OsPlatform, HwModel[]> = {
  WINDOWS: [
    { manufacturer: 'Dell Inc.', model: 'Latitude 7440', cpu: 'Intel Core i7-1365U', ram: [16384, 32768], storage: [512, 1024], type: 'LAPTOP' },
    { manufacturer: 'Lenovo', model: 'ThinkPad X1 Carbon Gen 11', cpu: 'Intel Core i7-1355U', ram: [16384, 32768], storage: [512, 1024], type: 'LAPTOP' },
    { manufacturer: 'HP', model: 'EliteBook 840 G10', cpu: 'Intel Core i5-1345U', ram: [16384], storage: [512], type: 'LAPTOP' },
    { manufacturer: 'Dell Inc.', model: 'OptiPlex 7010 Tower', cpu: 'Intel Core i7-13700', ram: [32768], storage: [1024], type: 'DESKTOP' },
    { manufacturer: 'Lenovo', model: 'ThinkPad T14s Gen 4', cpu: 'AMD Ryzen 7 PRO 7840U', ram: [32768], storage: [1024], type: 'LAPTOP' },
    { manufacturer: 'Microsoft Corporation', model: 'Surface Laptop 6', cpu: 'Intel Core Ultra 7 165H', ram: [16384, 32768], storage: [512], type: 'LAPTOP' },
  ],
  MACOS: [
    { manufacturer: 'Apple Inc.', model: 'MacBook Pro 14" (M3, 2023)', cpu: 'Apple M3 Pro', ram: [18432, 36864], storage: [512, 1024], type: 'LAPTOP' },
    { manufacturer: 'Apple Inc.', model: 'MacBook Air 13" (M3, 2024)', cpu: 'Apple M3', ram: [16384], storage: [512], type: 'LAPTOP' },
    { manufacturer: 'Apple Inc.', model: 'MacBook Pro 16" (M3 Max, 2023)', cpu: 'Apple M3 Max', ram: [49152], storage: [1024, 2048], type: 'LAPTOP' },
  ],
  LINUX: [
    { manufacturer: 'Dell Inc.', model: 'Precision 3660 Tower', cpu: 'Intel Core i9-13900', ram: [65536], storage: [2048], type: 'WORKSTATION' },
    { manufacturer: 'Lenovo', model: 'ThinkStation P360 Ultra', cpu: 'Intel Core i7-12700', ram: [32768, 65536], storage: [1024], type: 'WORKSTATION' },
    { manufacturer: 'System76', model: 'Lemur Pro', cpu: 'Intel Core i7-1355U', ram: [40960], storage: [1024], type: 'LAPTOP' },
    { manufacturer: 'Dell Inc.', model: 'PowerEdge R660', cpu: 'Intel Xeon Silver 4410Y', ram: [131072], storage: [3840], type: 'SERVER' },
  ],
};
const OS: Record<OsPlatform, { name: string; version: string; build: string }[]> = {
  WINDOWS: [
    { name: 'Windows 11 Enterprise', version: '24H2', build: '26100.4946' },
    { name: 'Windows 11 Enterprise', version: '23H2', build: '22631.5909' },
    { name: 'Windows 11 Pro', version: '24H2', build: '26100.4946' },
  ],
  MACOS: [
    { name: 'macOS Sequoia', version: '15.6.1', build: '24G90' },
    { name: 'macOS Tahoe', version: '26.0', build: '25A354' },
  ],
  LINUX: [
    { name: 'Ubuntu 24.04.3 LTS', version: '24.04', build: '6.8.0-79-generic' },
    { name: 'Ubuntu 22.04.5 LTS', version: '22.04', build: '6.8.0-65-generic' },
    { name: 'Red Hat Enterprise Linux 9.6', version: '9.6', build: '5.14.0-570.el9' },
  ],
};

type Sw = { name: string; version: string; publisher?: string; source?: string };
const BASE_SW: Record<OsPlatform, Sw[]> = {
  WINDOWS: [
    { name: 'Microsoft 365 Apps for enterprise - en-us', version: '16.0.19127.20154', publisher: 'Microsoft Corporation', source: 'msi' },
    { name: 'Microsoft Edge', version: '140.0.3485.81', publisher: 'Microsoft Corporation', source: 'msi' },
    { name: 'Microsoft Teams', version: '25227.203.3830.9127', publisher: 'Microsoft Corporation', source: 'msi' },
    { name: 'Microsoft OneDrive', version: '25.149.0803.0003', publisher: 'Microsoft Corporation', source: 'msi' },
    { name: 'Google Chrome', version: '140.0.7339.186', publisher: 'Google LLC', source: 'msi' },
    { name: 'Zoom Workplace (64-bit)', version: '6.5.12.21374', publisher: 'Zoom Video Communications, Inc.', source: 'msi' },
    { name: 'Slack', version: '4.46.99', publisher: 'Slack Technologies Inc.', source: 'msi' },
    { name: '7-Zip 24.09 (x64)', version: '24.09', publisher: 'Igor Pavlov', source: 'msi' },
    { name: 'Adobe Acrobat Reader (64-bit)', version: '25.001.20693', publisher: 'Adobe', source: 'msi' },
    { name: 'CrowdStrike Falcon Sensor', version: '7.26.19811.0', publisher: 'CrowdStrike, Inc.', source: 'msi' },
    { name: 'Cisco Secure Client - AnyConnect VPN', version: '5.1.10.233', publisher: 'Cisco Systems, Inc.', source: 'msi' },
    { name: 'Microsoft Visual C++ 2015-2022 Redistributable (x64)', version: '14.44.35211.0', publisher: 'Microsoft Corporation', source: 'system' },
    { name: 'Microsoft Update Health Tools', version: '5.72.0.0', publisher: 'Microsoft Corporation', source: 'system' },
    { name: 'Windows PC Health Check', version: '3.7.2204.15001', publisher: 'Microsoft Corporation', source: 'system' },
  ],
  MACOS: [
    { name: 'Safari', version: '26.0', publisher: 'Apple', source: 'system' },
    { name: 'Google Chrome', version: '140.0.7339.186', publisher: 'Google LLC', source: 'app-bundle' },
    { name: 'Slack', version: '4.46.99', publisher: 'Slack Technologies Inc.', source: 'app-bundle' },
    { name: 'zoom.us', version: '6.5.12', publisher: 'Zoom Video Communications, Inc.', source: 'app-bundle' },
    { name: 'Microsoft Teams', version: '25227.203', publisher: 'Microsoft Corporation', source: 'app-bundle' },
    { name: 'Microsoft Word', version: '16.101', publisher: 'Microsoft Corporation', source: 'app-bundle' },
    { name: 'Microsoft Office', version: '16.101', publisher: 'Microsoft Corporation', source: 'pkg' },
    { name: '1Password', version: '8.11.10', publisher: 'AgileBits Inc.', source: 'app-bundle' },
    { name: 'SentinelOne Extensions', version: '25.1.2.6', publisher: 'SentinelOne', source: 'pkg' },
    { name: 'Xcode Command Line Tools', version: '26.0', publisher: 'Apple', source: 'system' },
  ],
  LINUX: [
    { name: 'openssh-client', version: '1:9.6p1-3ubuntu13.13', publisher: 'Canonical Ltd.', source: 'dpkg' },
    { name: 'openssl', version: '3.0.13-0ubuntu3.5', publisher: 'Canonical Ltd.', source: 'system' },
    { name: 'systemd', version: '255.4-1ubuntu8.10', publisher: 'Canonical Ltd.', source: 'system' },
    { name: 'Firefox', version: '143.0', publisher: 'Mozilla', source: 'snap' },
    { name: 'git', version: '1:2.43.0-1ubuntu7.3', publisher: 'Canonical Ltd.', source: 'dpkg' },
    { name: 'ClamAV', version: '1.4.3', publisher: 'Cisco Talos', source: 'dpkg' },
    { name: 'SentinelOne Agent', version: '25.1.3.3', publisher: 'SentinelOne', source: 'dpkg' },
    { name: 'python3', version: '3.12.3-0ubuntu2', publisher: 'Canonical Ltd.', source: 'system' },
  ],
};
const DEV_SW: Record<OsPlatform, Sw[]> = {
  WINDOWS: [
    { name: 'Microsoft Visual Studio Code (User)', version: '1.104.1', publisher: 'Microsoft Corporation', source: 'msi' },
    { name: 'Git', version: '2.51.0', publisher: 'The Git Development Community', source: 'msi' },
    { name: 'Docker Desktop', version: '4.46.0', publisher: 'Docker Inc.', source: 'msi' },
    { name: 'Python 3.12.10 (64-bit)', version: '3.12.10', publisher: 'Python Software Foundation', source: 'msi' },
    { name: 'Node.js', version: '22.19.0', publisher: 'Node.js Foundation', source: 'msi' },
    { name: 'Notepad++ (64-bit x64)', version: '8.8.5', publisher: 'Notepad++ Team', source: 'msi' },
  ],
  MACOS: [
    { name: 'Visual Studio Code', version: '1.104.1', publisher: 'Microsoft Corporation', source: 'app-bundle' },
    { name: 'Docker Desktop', version: '4.46.0', publisher: 'Docker Inc.', source: 'app-bundle' },
    { name: 'Python', version: '3.13.7', publisher: 'Python Software Foundation', source: 'brew' },
    { name: 'Node.js', version: '22.19.0', publisher: 'Node.js Foundation', source: 'brew' },
  ],
  LINUX: [
    { name: 'code', version: '1.104.1-1758154125', publisher: 'Microsoft Corporation', source: 'dpkg' },
    { name: 'docker-ce', version: '5:28.4.0-1~ubuntu.24.04~noble', publisher: 'Docker Inc.', source: 'dpkg' },
    { name: 'Node.js', version: '22.19.0', publisher: 'NodeSource', source: 'dpkg' },
  ],
};
const EXTRA_UNAPPROVED: Sw[] = [
  { name: 'Postman', version: '11.64.0', publisher: 'Postman, Inc.', source: 'msi' },
  { name: 'Spotify', version: '1.2.72.438', publisher: 'Spotify AB', source: 'msi' },
  { name: 'WhatsApp', version: '2.2536.4', publisher: 'WhatsApp Inc.', source: 'msi' },
];
const BLACKLISTED_SW: Record<OsPlatform, Sw[]> = {
  WINDOWS: [
    { name: 'uTorrent Web', version: '1.4.0.5474', publisher: 'BitTorrent Inc.', source: 'registry' },
    { name: 'AnyDesk', version: '9.5.10', publisher: 'AnyDesk Software GmbH', source: 'registry' },
    { name: 'CCleaner', version: '6.38', publisher: 'Piriform Software Ltd', source: 'registry' },
    { name: 'TeamViewer', version: '15.69.4', publisher: 'TeamViewer Germany GmbH', source: 'msi' },
    { name: 'WinRAR 7.13 keygen', version: '7.13', publisher: 'unknown', source: 'registry' },
  ],
  MACOS: [
    { name: 'Tor Browser', version: '14.5.7', publisher: 'The Tor Project', source: 'app-bundle' },
    { name: 'AnyDesk', version: '9.0.6', publisher: 'AnyDesk Software GmbH', source: 'app-bundle' },
  ],
  LINUX: [{ name: 'qBittorrent', version: '4.6.3', publisher: 'qBittorrent Project', source: 'dpkg' }],
};

const _ISSUES = ['NO_ENCRYPTION', 'AV_DISABLED', 'AV_OUTDATED', 'EDR_MISSING', 'FIREWALL_OFF', 'SCREEN_LOCK', 'USB_ENABLED', 'AUTO_UPDATE_OFF', 'UNAUTHORIZED_SW', 'CRITICAL_PATCH', 'SECURE_BOOT_OFF'] as const;
type Issue = (typeof _ISSUES)[number];
const ISSUE_RULE: Record<Issue, string> = {
  NO_ENCRYPTION: 'DISK_ENCRYPTION_DISABLED',
  AV_DISABLED: 'ANTIVIRUS_MISSING',
  AV_OUTDATED: 'ANTIVIRUS_OUTDATED',
  EDR_MISSING: 'EDR_MISSING',
  FIREWALL_OFF: 'FIREWALL_DISABLED',
  SCREEN_LOCK: 'SCREEN_LOCK_DISABLED',
  USB_ENABLED: 'USB_STORAGE_ENABLED',
  AUTO_UPDATE_OFF: 'AUTO_UPDATE_DISABLED',
  UNAUTHORIZED_SW: 'UNAUTHORIZED_SOFTWARE',
  CRITICAL_PATCH: 'CRITICAL_PATCHES_MISSING',
  SECURE_BOOT_OFF: 'SECURE_BOOT_DISABLED',
};
const BLOCKING: [Issue, number][] = [
  ['UNAUTHORIZED_SW', 6], ['USB_ENABLED', 3], ['NO_ENCRYPTION', 3], ['CRITICAL_PATCH', 3], ['AV_DISABLED', 2], ['EDR_MISSING', 2], ['FIREWALL_OFF', 2], ['SCREEN_LOCK', 2],
];

function baseSecurity(platform: OsPlatform, at: Date): EngineSecurity & Record<string, unknown> {
  const common = {
    antivirusState: 'ENABLED',
    antivirusSignatureAt: new Date(at.getTime() - int(2, 20) * 3_600_000),
    edrState: 'ENABLED',
    firewallState: 'ENABLED',
    diskEncryptionState: 'ENABLED',
    secureBootState: 'ENABLED',
    screenLockEnabled: true,
    screenLockTimeoutSec: pick([120, 180, 180]),
    passwordOnWake: true,
    screenSaverEnabled: true,
    autoUpdateEnabled: true,
    usbStorageEnabled: false,
    pendingRebootRequired: chance(0.15),
  };
  if (platform === 'WINDOWS') {
    return { ...common, antivirusProduct: 'Microsoft Defender Antivirus', edrProduct: 'CrowdStrike Falcon', encryptionMethod: 'BitLocker', bitlockerState: 'ENABLED', tpmPresent: true };
  }
  if (platform === 'MACOS') {
    return { ...common, antivirusProduct: 'Microsoft Defender for Endpoint', edrProduct: 'SentinelOne', encryptionMethod: 'FileVault', bitlockerState: 'UNKNOWN', tpmPresent: true };
  }
  return { ...common, antivirusProduct: 'ClamAV', edrProduct: 'SentinelOne', encryptionMethod: 'LUKS', bitlockerState: 'UNKNOWN', tpmPresent: true };
}

function applyIssues(sec: Record<string, unknown>, issues: Set<Issue>, at: Date) {
  const s = { ...sec };
  if (issues.has('NO_ENCRYPTION')) { s.diskEncryptionState = 'DISABLED'; s.bitlockerState = s.encryptionMethod === 'BitLocker' ? 'DISABLED' : s.bitlockerState; }
  if (issues.has('AV_DISABLED')) s.antivirusState = 'DISABLED';
  if (issues.has('AV_OUTDATED')) s.antivirusSignatureAt = new Date(at.getTime() - int(8, 15) * DAY);
  if (issues.has('EDR_MISSING')) { s.edrState = 'NOT_INSTALLED'; s.edrProduct = null; }
  if (issues.has('FIREWALL_OFF')) s.firewallState = 'DISABLED';
  if (issues.has('SCREEN_LOCK')) { s.screenLockTimeoutSec = 1800; s.passwordOnWake = chance(0.5); }
  if (issues.has('USB_ENABLED')) s.usbStorageEnabled = true;
  if (issues.has('AUTO_UPDATE_OFF')) s.autoUpdateEnabled = false;
  if (issues.has('SECURE_BOOT_OFF')) s.secureBootState = 'DISABLED';
  return s;
}

function patchCatalog(platform: OsPlatform) {
  const mk = (i: number) => {
    const released = daysAgo(3 + i * 11);
    if (platform === 'WINDOWS') {
      return { patchId: `KB50${6500 - i * 37}`, title: `${released.toISOString().substring(0, 7)} Cumulative Update for Windows 11 (KB50${6500 - i * 37})`, category: 'SECURITY' as PatchCategory, product: 'Windows 11', released };
    }
    if (platform === 'MACOS') {
      return { patchId: `macOS-26.0.${3 - Math.min(i, 3)}-sec-${i}`, title: `macOS Security Response ${26 - Math.floor(i / 3)}.${(9 - i + 20) % 10}`, category: 'OS' as PatchCategory, product: 'macOS', released };
    }
    const pkgs = ['openssl', 'linux-image-generic', 'sudo', 'libc6', 'openssh-server', 'curl', 'glib2.0'];
    return { patchId: `${pkgs[i % pkgs.length]}@USN-${7600 - i * 23}-1`, title: `USN-${7600 - i * 23}-1: ${pkgs[i % pkgs.length]} vulnerabilities`, category: 'SECURITY' as PatchCategory, product: pkgs[i % pkgs.length], released };
  };
  return Array.from({ length: 7 }, (_, i) => mk(i));
}

function cve(i: number) {
  return `CVE-2026-${(21000 + i * 137) % 99999}`;
}

async function seedDemo(ctx: Awaited<ReturnType<typeof seedBase>>) {
  const { admin, roles, depts, policies } = ctx;
  const domain = (env('SEED_ADMIN_EMAIL', 'admin@secureendpoint.local').split('@')[1] || 'secureendpoint.local').toLowerCase();
  const password = env('SEED_ADMIN_PASSWORD', 'ChangeMe!Secure2026');
  const pwHash = await hashPassword(password);
  const audits: AuditEntryInput[] = [];
  const audit = (e: AuditEntryInput) => audits.push(e);

  audit({ category: 'SYSTEM', action: 'system.seed', actorType: 'SYSTEM', actorName: 'seed', occurredAt: daysAgo(35), metadata: { demoVersion: DEMO_VERSION } });

  // ── demo users (one per role) ──
  const demoUsers: { email: string; name: string; role: RoleKey; dept: string; title: string }[] = [
    { email: `secadmin@${domain}`, name: 'Sarah Chen', role: 'SECURITY_ADMIN', dept: 'IT', title: 'Security Administrator' },
    { email: `compliance@${domain}`, name: 'Michael Okafor', role: 'COMPLIANCE_OFFICER', dept: 'Legal', title: 'Compliance Officer' },
    { email: `itadmin@${domain}`, name: 'David Novak', role: 'IT_ADMIN', dept: 'IT', title: 'IT Administrator' },
    { email: `manager@${domain}`, name: 'Laura Fischer', role: 'DEPARTMENT_MANAGER', dept: 'Engineering', title: 'Engineering Manager' },
    { email: `employee@${domain}`, name: 'James Walker', role: 'EMPLOYEE', dept: 'Engineering', title: 'Software Engineer' },
    { email: `auditor@${domain}`, name: 'Grace Tanaka', role: 'AUDITOR', dept: 'Finance', title: 'Internal Auditor' },
  ];
  const users: { id: string; email: string; displayName: string; departmentId: string | null; dept: string }[] = [];
  const byEmail: Record<string, { id: string }> = {};
  for (const u of demoUsers) {
    const row = await prisma.user.upsert({
      where: { email: u.email },
      create: { email: u.email, displayName: u.name, roleId: roles[u.role].id, departmentId: depts[u.dept].id, jobTitle: u.title, passwordHash: pwHash, passwordChangedAt: daysAgo(40) },
      update: {},
    });
    byEmail[u.email] = row;
    users.push({ ...row, dept: u.dept });
    audit({ category: 'USER_ACTION', action: 'user.create', actorType: 'USER', actorId: admin.id, actorName: admin.email, resourceType: 'User', resourceId: row.id, occurredAt: daysAgo(34), after: { email: u.email, role: u.role } });
  }
  await prisma.department.update({ where: { id: depts.Engineering.id }, data: { managerId: byEmail[`manager@${domain}`].id } });

  // ── employees ──
  const deptNames = DEPARTMENTS.map((d) => d.name);
  const deptWeights: [string, number][] = [['Engineering', 9], ['Sales', 6], ['Finance', 4], ['Operations', 3], ['Human Resources', 3], ['Legal', 2], ['IT', 3]];
  const usedNames = new Set<string>();
  for (let i = 0; i < 30; i++) {
    let first: string, last: string;
    do {
      first = pick(FIRST);
      last = pick(LAST);
    } while (usedNames.has(first + last));
    usedNames.add(first + last);
    const dept = weighted(deptWeights);
    const email = `${first}.${last}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z.]/g, '') + `@${domain}`;
    const row = await prisma.user.upsert({
      where: { email },
      create: { email, displayName: `${first} ${last}`, roleId: roles.EMPLOYEE.id, departmentId: depts[dept].id, jobTitle: pick(JOB[dept]), phone: `+1 555 01${String(i).padStart(2, '0')}` },
      update: {},
    });
    users.push({ ...row, dept });
  }
  for (const name of deptNames) {
    if (name === 'Engineering') continue;
    const mgr = users.find((u) => u.dept === name && !u.email.startsWith('employee@'));
    if (mgr) await prisma.department.update({ where: { id: depts[name].id }, data: { managerId: mgr.id } });
  }

  // ── rules / catalog for evaluation ──
  const rules = await prisma.complianceRule.findMany();
  const whitelist = await prisma.softwareWhitelist.findMany();
  const blacklist = await prisma.softwareBlacklist.findMany();
  const deptPolicy: Record<string, typeof policies.baseline> = {
    [depts.Engineering.id]: policies.engPolicy,
    [depts.Finance.id]: policies.finPolicy,
  };

  // ── devices ──
  const platforms: OsPlatform[] = [...Array(36).fill('WINDOWS'), ...Array(12).fill('MACOS'), ...Array(12).fill('LINUX')];
  const assignable = users.filter((u) => !['secadmin', 'compliance', 'auditor'].some((p) => u.email.startsWith(p + '@')));
  const alertsToCreate: Prisma.AlertCreateManyInput[] = [];
  const historyRows: Prisma.ComplianceResultCreateManyInput[] = [];
  let assetSeq = 1;
  const created: { id: string; name: string; platform: OsPlatform; departmentId: string | null; assignedUserId: string | null; status: DeviceStatus }[] = [];

  for (let i = 0; i < platforms.length; i++) {
    const platform = platforms[i];
    const hw = pick(HW[platform]);
    const os = pick(OS[platform]);
    const owner = i < 52 ? assignable[i % assignable.length] : null;
    const dept = owner ? owner.dept : pick(deptNames);
    const deptId = depts[dept].id;
    const serial = platform === 'MACOS' ? `C02${hex(7)}` : hw.manufacturer.startsWith('Dell') ? hex(7) : `PF${hex(6)}`;
    const shortName = owner ? owner.displayName.split(' ').map((p) => p[0]).join('').toUpperCase() : 'POOL';
    const deviceName =
      platform === 'WINDOWS' ? `${dept.substring(0, 3).toUpperCase()}-WIN-${shortName}${String(i).padStart(2, '0')}`
      : platform === 'MACOS' ? `${owner ? owner.displayName.split(' ')[0] : 'Shared'}s-MacBook-Pro-${i}`
      : hw.type === 'SERVER' ? `srv-build-${String(i).padStart(2, '0')}` : `ws-${dept.substring(0, 3).toLowerCase()}-${String(i).padStart(2, '0')}`;
    const purchase = daysAgo(int(90, 1400));
    const warranty = new Date(purchase.getTime() + 3 * 365 * DAY);

    // Lifecycle
    let status: DeviceStatus = 'ACTIVE';
    let lastSeen: Date | null = ago(int(0, 12) * 60_000);
    if (i === 57 || i === 58) { status = 'PENDING'; lastSeen = ago(int(1, 6) * 3_600_000); }
    else if (i === 59) { status = 'RETIRED'; lastSeen = daysAgo(60); }
    else if (i === 20 || i === 41 || i === 50) { status = 'INACTIVE'; lastSeen = daysAgo(int(9, 20)); }
    else if (i % 7 === 3) lastSeen = ago(int(1, 20) * 3_600_000);
    const isCompanyOwned = !(i === 44 || i === 53);

    const policy = deptPolicy[deptId] ?? policies.baseline;
    const data = {
      deviceName,
      hostname: deviceName.toLowerCase(),
      assetId: `AST-${String(assetSeq++).padStart(6, '0')}`,
      deviceType: hw.type,
      platform,
      manufacturer: hw.manufacturer,
      model: hw.model,
      cpu: hw.cpu,
      ramMb: pick(hw.ram),
      storageGb: pick(hw.storage),
      osName: os.name,
      osVersion: os.version,
      osBuild: os.build,
      ipAddress: `10.${20 + DEPARTMENTS.findIndex((d) => d.name === dept)}.${int(1, 20)}.${int(10, 250)}`,
      macAddresses: [Array.from({ length: 6 }, () => hex(2).toLowerCase()).join(':')],
      assignedUserId: owner?.id ?? null,
      departmentId: deptId,
      purchaseDate: purchase,
      warrantyExpiresAt: warranty,
      warrantyStatus: warranty < NOW ? 'EXPIRED' as const : warranty.getTime() - NOW.getTime() < 60 * DAY ? 'EXPIRING' as const : 'ACTIVE' as const,
      status,
      isCompanyOwned,
      agentVersion: status === 'PENDING' ? '1.0.0' : pick(['1.0.0', '1.0.1', '1.0.1']),
      lastSeenAt: lastSeen,
      enrolledAt: status === 'PENDING' ? null : daysAgo(int(35, 300)),
      tags: [platform === 'LINUX' && hw.type === 'SERVER' ? 'server' : 'endpoint', ...(i % 9 === 0 ? ['vip'] : [])],
      notes: i === 44 || i === 53 ? 'BYOD - personal device registered for email access' : null,
      createdAt: daysAgo(int(35, 300)),
    };
    const device = await prisma.device.upsert({ where: { serialNumber: serial }, create: { ...data, serialNumber: serial }, update: {} });
    created.push({ id: device.id, name: deviceName, platform, departmentId: deptId, assignedUserId: owner?.id ?? null, status });
    if (owner) {
      await prisma.deviceAssignment.create({ data: { deviceId: device.id, userId: owner.id, assignedById: admin.id, assignedAt: device.enrolledAt ?? daysAgo(30), notes: 'Initial provisioning' } });
    }
    audit({ category: 'DEVICE_CHANGE', action: 'device.enroll', actorType: 'DEVICE', actorId: device.id, actorName: deviceName, resourceType: 'Device', resourceId: device.id, deviceId: device.id, occurredAt: daysAgo(34), after: { serialNumber: serial, platform, status } });

    if (status === 'PENDING' || status === 'RETIRED') {
      if (status === 'RETIRED') {
        audit({ category: 'DEVICE_CHANGE', action: 'device.retire', actorType: 'USER', actorId: admin.id, actorName: admin.email, resourceType: 'Device', resourceId: device.id, deviceId: device.id, occurredAt: daysAgo(20), before: { status: 'ACTIVE' }, after: { status: 'RETIRED' } });
      }
      continue;
    }
    // One active device that has enrolled but not reported yet -> UNKNOWN
    const noReport = i === 55;

    // Current issues (~70% compliant)
    const current = new Set<Issue>();
    const nonCompliant = !noReport && (chance(0.15) || !isCompanyOwned);
    if (nonCompliant && isCompanyOwned) {
      const n = weighted([[1, 6], [2, 3], [3, 1]] as [number, number][]);
      while (current.size < n) current.add(weighted(BLOCKING));
    }
    // Guarantee a few software violations for the demo
    if (!noReport && [4, 17, 30].includes(i)) current.add('UNAUTHORIZED_SW');
    if (chance(0.12)) current.add('AV_OUTDATED');
    if (chance(0.1)) current.add('AUTO_UPDATE_OFF');
    if (policy.requireSecureBoot && chance(0.15)) current.add('SECURE_BOOT_OFF');
    // Past issue fixed within the window (drives an improving compliance trend)
    const past = new Set(current);
    const fixDay = int(3, 26);
    if (current.size === 0 && chance(0.3)) past.add(weighted(BLOCKING));

    // Software
    const sw: Sw[] = [...BASE_SW[platform]];
    if (dept === 'Engineering' || dept === 'IT' || platform === 'LINUX') sw.push(...DEV_SW[platform].filter(() => chance(0.8)));
    if (platform === 'WINDOWS' && policy.blockUnauthorizedSoftware === false && chance(0.5)) sw.push(pick(EXTRA_UNAPPROVED));
    const badSw = pick(BLACKLISTED_SW[platform]);
    const unapproved = pick(EXTRA_UNAPPROVED);
    const injected: Sw =
      chance(0.6) || policy.blockUnauthorizedSoftware === false ? badSw : { ...unapproved, source: platform === 'MACOS' ? 'app-bundle' : unapproved.source };
    const recentPatchMissing = chance(0.3);

    const swFor = (issues: Set<Issue>) => (issues.has('UNAUTHORIZED_SW') ? [...sw, injected] : [...sw]);
    const classify = (list: Sw[]) =>
      list.map((s) => ({ ...s, ...classifySoftware(s, whitelist, blacklist, { platform, blockUnauthorized: policy.blockUnauthorizedSoftware }) }));

    // Patches
    const catalog = patchCatalog(platform);
    const patchesFor = (issues: Set<Issue>, at: Date) =>
      catalog
        .filter((p) => p.released <= at)
        .map((p, idx) => {
          let state: PatchState = 'INSTALLED';
          let severity: PatchSeverity = idx % 3 === 0 ? 'CRITICAL' : idx % 3 === 1 ? 'IMPORTANT' : 'MODERATE';
          if (idx === 0 && recentPatchMissing) state = 'MISSING'; // recent patch not yet installed (within deadline)
          if (issues.has('CRITICAL_PATCH') && idx === 3) { state = 'MISSING'; severity = 'CRITICAL'; }
          return { ...p, state, severity, releasedAt: p.released, detectedAt: p.released, cveIds: [cve(i * 7 + idx), ...(idx % 2 === 0 ? [cve(i * 7 + idx + 1)] : [])], cvssScore: severity === 'CRITICAL' ? 9.1 + (idx % 8) / 10 : severity === 'IMPORTANT' ? 7.5 : 5.3 };
        });

    const baseSec = baseSecurity(platform, NOW);
    const evalAt = (issues: Set<Issue>, at: Date): EvaluationResult => {
      const sec = noReport ? null : (applyIssues(baseSec, issues, at) as unknown as EngineSecurity);
      return evaluate(
        { platform, isCompanyOwned, lastSeenAt: status === 'INACTIVE' ? lastSeen : at },
        sec,
        noReport ? [] : classify(swFor(issues)),
        noReport ? [] : patchesFor(issues, at),
        policy,
        rules,
        at,
      );
    };

    // 30-day daily history
    for (let d = 30; d >= 1; d--) {
      const at = new Date(daysAgo(d).setUTCHours(2, int(0, 50), int(0, 59), 0));
      if (data.createdAt > at) continue;
      const r = evalAt(d > fixDay ? past : current, at);
      historyRows.push({ deviceId: device.id, policyId: policy.id, policyVersion: policy.version, score: r.score, state: r.state, riskLevel: r.riskLevel, criticalCount: r.criticalCount, highCount: r.highCount, mediumCount: r.mediumCount, lowCount: r.lowCount, findings: r.findings as unknown as Prisma.InputJsonValue, evaluatedAt: at });
    }
    const evaluatedAt = ago(int(5, 40) * 60_000);
    const result = evalAt(current, evaluatedAt);
    historyRows.push({ deviceId: device.id, policyId: policy.id, policyVersion: policy.version, score: result.score, state: result.state, riskLevel: result.riskLevel, criticalCount: result.criticalCount, highCount: result.highCount, mediumCount: result.mediumCount, lowCount: result.lowCount, findings: result.findings as unknown as Prisma.InputJsonValue, evaluatedAt });
    await prisma.device.update({
      where: { id: device.id },
      data: { complianceState: result.state, complianceScore: result.score, riskLevel: result.riskLevel, lastEvaluatedAt: evaluatedAt },
    });
    if (noReport) continue;

    // Persist current security / software / patches
    const sec = applyIssues(baseSec, current, NOW);
    await prisma.securityStatus.upsert({
      where: { deviceId: device.id },
      create: { deviceId: device.id, ...(sec as object), lastBootAt: daysAgo(int(0, 6)), raw: { collector: 'seed' }, collectedAt: lastSeen ?? NOW } as Prisma.SecurityStatusUncheckedCreateInput,
      update: {},
    });
    const swRows = classify(swFor(current));
    await prisma.softwareInventory.createMany({
      data: swRows.map((s) => ({
        deviceId: device.id,
        name: s.name,
        version: s.version,
        publisher: s.publisher ?? null,
        source: s.source ?? null,
        status: s.status,
        matchedRuleId: s.matchedRuleId,
        installDate: daysAgo(int(10, 400)),
        sizeMb: int(5, 2500),
        firstSeenAt: s === swRows[swRows.length - 1] && current.has('UNAUTHORIZED_SW') ? daysAgo(fixDay > 10 ? 4 : 2) : daysAgo(34),
        lastSeenAt: lastSeen ?? NOW,
      })),
      skipDuplicates: true,
    });
    const removedSw = { name: 'Skype for Business', version: '16.0.4549.1000', publisher: 'Microsoft Corporation' };
    if (platform === 'WINDOWS' && chance(0.3)) {
      await prisma.softwareInventory.create({ data: { deviceId: device.id, ...removedSw, status: 'APPROVED', firstSeenAt: daysAgo(200), lastSeenAt: daysAgo(12), removedAt: daysAgo(12), source: 'msi' } });
      audit({ category: 'SOFTWARE', action: 'software.removed', actorType: 'DEVICE', actorId: device.id, actorName: deviceName, resourceType: 'SoftwareInventory', resourceId: removedSw.name, deviceId: device.id, occurredAt: daysAgo(12), after: removedSw });
    }
    for (const s of swRows.filter((x) => x.status === 'BLACKLISTED' || x.status === 'UNAUTHORIZED')) {
      audit({ category: 'SOFTWARE', action: 'software.installed', actorType: 'DEVICE', actorId: device.id, actorName: deviceName, resourceType: 'SoftwareInventory', resourceId: s.name, deviceId: device.id, occurredAt: daysAgo(fixDay > 10 ? 4 : 2), after: { name: s.name, version: s.version, status: s.status } });
      if (s.status === 'BLACKLISTED') {
        const rule = blacklist.find((b) => b.id === s.matchedRuleId);
        alertsToCreate.push({
          deviceId: device.id, category: 'SOFTWARE', severity: rule?.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH', status: 'OPEN',
          title: `Blacklisted software detected: ${s.name}`, message: `${s.name} ${s.version} was found on ${deviceName}.${rule ? ` Reason: ${rule.reason}` : ''}`,
          dedupeKey: `software:${device.id}:${s.name.toLowerCase()}`, createdAt: daysAgo(fixDay > 10 ? 4 : 2), lastOccurredAt: ago(int(1, 50) * 60_000), occurrences: int(1, 30), metadata: { name: s.name },
        });
      }
    }
    const patches = patchesFor(current, NOW);
    await prisma.patchStatus.createMany({
      data: patches.map((p) => ({
        deviceId: device.id, patchId: p.patchId, title: p.title, category: p.category, severity: p.severity, state: p.state, product: p.product,
        cveIds: p.cveIds, cvssScore: Math.round(p.cvssScore * 10) / 10, releasedAt: p.released, detectedAt: p.detectedAt,
        installedAt: p.state === 'INSTALLED' ? new Date(p.released.getTime() + int(1, 6) * DAY) : null,
      })),
      skipDuplicates: true,
    });

    // Compliance alerts for current failing findings (as the engine would raise them)
    for (const f of result.findings.filter((x) => !x.passed && (x.markNonCompliant || x.severity === 'CRITICAL'))) {
      const createdAt = daysAgo(Math.min(fixDay, int(1, 25)));
      const sev = (f.severity === 'NONE' ? 'INFO' : f.severity) as AlertSeverity;
      const st = chance(0.25) ? 'ACKNOWLEDGED' : 'OPEN';
      alertsToCreate.push({
        deviceId: device.id, category: 'COMPLIANCE', severity: sev, status: st,
        title: `${f.name} on ${deviceName}`, message: `${f.detail}. Remediation: ${f.remediation}`, ruleKey: f.ruleKey,
        dedupeKey: `compliance:${device.id}:${f.ruleKey}`, createdAt, lastOccurredAt: ago(int(5, 120) * 60_000), occurrences: int(1, 40),
        acknowledgedAt: st === 'ACKNOWLEDGED' ? new Date(createdAt.getTime() + 3_600_000) : null,
        acknowledgedById: st === 'ACKNOWLEDGED' ? byEmail[`secadmin@${domain}`].id : null, metadata: { ruleKey: f.ruleKey },
      });
      audit({ category: 'SECURITY', action: 'compliance.state_change', actorType: 'SYSTEM', actorName: 'compliance-engine', resourceType: 'Device', resourceId: device.id, deviceId: device.id, occurredAt: createdAt, before: { state: 'COMPLIANT' }, after: { state: result.state, failedRule: f.ruleKey } });
    }
    // Resolved alerts for issues fixed during the window
    for (const iss of [...past].filter((x) => !current.has(x))) {
      const createdAt = daysAgo(Math.min(29, fixDay + int(1, 4)));
      const rule = rules.find((r) => r.key === ISSUE_RULE[iss]);
      alertsToCreate.push({
        deviceId: device.id, category: 'COMPLIANCE', severity: (rule?.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH') as AlertSeverity, status: 'RESOLVED',
        title: `${rule?.name ?? iss} on ${deviceName}`, ruleKey: rule?.key ?? null,
        message: 'Issue remediated and verified by a subsequent agent report.', dedupeKey: `compliance:${device.id}:${ISSUE_RULE[iss]}`,
        createdAt, lastOccurredAt: daysAgo(fixDay), resolvedAt: daysAgo(fixDay), occurrences: int(2, 20), metadata: { seeded: true },
      });
      audit({ category: 'SECURITY', action: 'alert.auto_resolve', actorType: 'SYSTEM', actorName: 'system', resourceType: 'Alert', deviceId: device.id, occurredAt: daysAgo(fixDay), metadata: { reason: 'rule passed', issue: iss } });
    }
  }

  await prisma.complianceResult.createMany({ data: historyRows });

  // ── commands ──
  const active = created.filter((c) => c.status === 'ACTIVE');
  for (const c of active.slice(0, 12)) {
    await prisma.deviceCommand.create({ data: { deviceId: c.id, type: 'COLLECT_INVENTORY', payload: {}, status: 'SUCCEEDED', createdById: admin.id, createdAt: daysAgo(3), sentAt: daysAgo(3), completedAt: daysAgo(3), expiresAt: daysAgo(0), result: { output: 'Inventory collected' } } });
  }
  for (const c of active.slice(12, 16)) {
    await prisma.deviceCommand.create({ data: { deviceId: c.id, type: 'INSTALL_PATCHES', payload: { severity: ['CRITICAL'], reboot: 'if-required' }, status: 'PENDING', createdById: byEmail[`itadmin@${domain}`].id, expiresAt: new Date(NOW.getTime() + 2 * DAY) } });
    audit({ category: 'DEVICE_CHANGE', action: 'device.command.create', actorType: 'USER', actorId: byEmail[`itadmin@${domain}`].id, actorName: `itadmin@${domain}`, resourceType: 'DeviceCommand', deviceId: c.id, occurredAt: ago(2 * 3_600_000), after: { type: 'INSTALL_PATCHES' } });
  }

  // ── USB whitelist ──
  const usbSpecs = [
    { vendorId: '0951', productId: '1666', serialNumber: 'IK1000-CORP-0001', manufacturer: 'Kingston', productName: 'IronKey Vault Privacy 50', deviceClass: 'MASS_STORAGE' as UsbDeviceClass, whitelistScope: 'GLOBAL' as const, scopeRefId: null, readOnly: false },
    { vendorId: '0781', productId: '5581', serialNumber: '', manufacturer: 'SanDisk', productName: 'Extreme PRO USB 3.2', deviceClass: 'MASS_STORAGE' as UsbDeviceClass, whitelistScope: 'DEPARTMENT' as const, scopeRefId: depts.Engineering.id, readOnly: false },
    { vendorId: '1050', productId: '0407', serialNumber: '', manufacturer: 'Yubico', productName: 'YubiKey 5 NFC', deviceClass: 'HID' as UsbDeviceClass, whitelistScope: 'GLOBAL' as const, scopeRefId: null, readOnly: false },
    { vendorId: '046d', productId: 'c52b', serialNumber: '', manufacturer: 'Logitech', productName: 'Unifying Receiver', deviceClass: 'HID' as UsbDeviceClass, whitelistScope: 'GLOBAL' as const, scopeRefId: null, readOnly: false },
    { vendorId: '0984', productId: '1407', serialNumber: 'APR-AEGIS-7731', manufacturer: 'Apricorn', productName: 'Aegis Secure Key 3NX', deviceClass: 'MASS_STORAGE' as UsbDeviceClass, whitelistScope: 'DEPARTMENT' as const, scopeRefId: depts.Finance.id, readOnly: true },
  ];
  const usbWhite = [];
  for (const u of usbSpecs) {
    usbWhite.push(
      await prisma.usbDevice.upsert({
        where: { vendorId_productId_serialNumber: { vendorId: u.vendorId, productId: u.productId, serialNumber: u.serialNumber } },
        create: { ...u, isWhitelisted: true, approvedById: byEmail[`secadmin@${domain}`].id, approvedAt: daysAgo(33), firstSeenAt: daysAgo(33), lastSeenAt: daysAgo(1) },
        update: {},
      }),
    );
    audit({ category: 'USB', action: 'usb.whitelist.add', actorType: 'USER', actorId: byEmail[`secadmin@${domain}`].id, actorName: `secadmin@${domain}`, resourceType: 'UsbDevice', occurredAt: daysAgo(33), after: { vendorId: u.vendorId, productId: u.productId, productName: u.productName, scope: u.whitelistScope } });
  }
  const unknownUsb = [
    { vendorId: '0951', productId: '1665', serialNumber: '408D5CBF5F6B', manufacturer: 'Kingston', productName: 'DataTraveler 100 G3', deviceClass: 'MASS_STORAGE' as UsbDeviceClass },
    { vendorId: '090c', productId: '1000', serialNumber: 'AA00000000011542', manufacturer: 'Samsung', productName: 'Flash Drive FIT', deviceClass: 'MASS_STORAGE' as UsbDeviceClass },
    { vendorId: '05ac', productId: '12a8', serialNumber: '00008110-000A', manufacturer: 'Apple', productName: 'iPhone', deviceClass: 'PHONE' as UsbDeviceClass },
    { vendorId: '0bc2', productId: '231a', serialNumber: 'NACX8RLT', manufacturer: 'Seagate', productName: 'Expansion Portable HDD', deviceClass: 'MASS_STORAGE' as UsbDeviceClass },
    { vendorId: '18d1', productId: '4ee7', serialNumber: '2A081FDH2004XB', manufacturer: 'Google', productName: 'Pixel 9', deviceClass: 'PHONE' as UsbDeviceClass },
  ];
  const usbUnknown = [];
  for (const u of unknownUsb) {
    usbUnknown.push(await prisma.usbDevice.upsert({ where: { vendorId_productId_serialNumber: { vendorId: u.vendorId, productId: u.productId, serialNumber: u.serialNumber } }, create: { ...u, firstSeenAt: daysAgo(30), lastSeenAt: daysAgo(1) }, update: {} }));
  }

  // ── USB events (30 days) ──
  const usbEvents: Prisma.UsbEventCreateManyInput[] = [];
  const recentBlockedAlerts = new Map<string, Prisma.AlertCreateManyInput>();
  for (let n = 0; n < 220; n++) {
    const dev = pick(active);
    const at = ago(int(0, 30 * 24 * 60) * 60_000);
    const user = users.find((u) => u.id === dev.assignedUserId);
    const userName = user ? user.email.split('@')[0] : 'localadmin';
    const blocked = chance(0.25);
    const usb = blocked ? pick(usbUnknown) : pick(usbWhite);
    const base = { deviceId: dev.id, usbDeviceId: usb.id, deviceClass: usb.deviceClass, vendorId: usb.vendorId, productId: usb.productId, serialNumber: usb.serialNumber || null, label: usb.productName, userName, occurredAt: at, receivedAt: new Date(at.getTime() + 2000) };
    usbEvents.push({ ...base, eventType: 'CONNECTED' });
    if (blocked) {
      usbEvents.push({ ...base, eventType: 'BLOCKED', policyReason: 'USB mass storage blocked by policy; device not whitelisted', occurredAt: new Date(at.getTime() + 500) });
      audit({ category: 'USB', action: 'usb.blocked', actorType: 'DEVICE', actorId: dev.id, actorName: dev.name, resourceType: 'UsbDevice', resourceId: usb.id, deviceId: dev.id, success: false, occurredAt: at, after: { vendorId: usb.vendorId, productId: usb.productId, label: usb.productName, userName } });
      if (NOW.getTime() - at.getTime() < 7 * DAY) {
        const key = `usb:${dev.id}:${usb.serialNumber || `${usb.vendorId}:${usb.productId}`}:${at.toISOString().substring(0, 13)}`;
        if (!recentBlockedAlerts.has(key)) {
          const old = NOW.getTime() - at.getTime() > 2 * DAY;
          recentBlockedAlerts.set(key, {
            deviceId: dev.id, category: 'USB', severity: 'MEDIUM', status: old ? 'RESOLVED' : 'OPEN',
            title: `USB device blocked on ${dev.name}`, message: `${usb.productName} (${usb.vendorId}:${usb.productId}) was blocked for user ${userName}.`,
            dedupeKey: key, createdAt: at, lastOccurredAt: at, resolvedAt: old ? new Date(at.getTime() + DAY) : null, metadata: { vendorId: usb.vendorId, productId: usb.productId },
          });
        }
      }
    } else {
      usbEvents.push({ ...base, eventType: 'ALLOWED', occurredAt: new Date(at.getTime() + 500) });
      if (usb.deviceClass === 'MASS_STORAGE' && chance(0.5)) {
        usbEvents.push({ ...base, eventType: 'FILE_WRITE', filePath: `E:\\Transfer\\report-${int(100, 999)}.xlsx`, bytes: BigInt(int(20_000, 9_000_000)), occurredAt: new Date(at.getTime() + 60_000) });
      }
      usbEvents.push({ ...base, eventType: 'DISCONNECTED', occurredAt: new Date(at.getTime() + int(5, 90) * 60_000) });
    }
  }
  await prisma.usbEvent.createMany({ data: usbEvents });
  alertsToCreate.push(...recentBlockedAlerts.values());

  // ── USB access requests ──
  const empDevice = created.find((c) => c.assignedUserId === byEmail[`employee@${domain}`].id && c.status === 'ACTIVE') ?? active[0];
  const reqSpecs: { status: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | 'REVOKED'; dev: (typeof created)[number]; usb: (typeof usbUnknown)[number]; reason: string; hours: number; decidedDaysAgo?: number }[] = [
    { status: 'PENDING', dev: empDevice, usb: usbUnknown[0], reason: 'Need to copy conference presentation from customer-provided USB stick', hours: 4 },
    { status: 'PENDING', dev: active[5], usb: usbUnknown[3], reason: 'Restore archived project files from external backup drive', hours: 8 },
    { status: 'APPROVED', dev: active[9], usb: usbUnknown[1], reason: 'Firmware update for lab equipment requires USB transfer', hours: 24, decidedDaysAgo: 0.2 },
    { status: 'DENIED', dev: active[14], usb: usbUnknown[3], reason: 'Personal photos backup', hours: 2, decidedDaysAgo: 6 },
    { status: 'EXPIRED', dev: active[3], usb: usbUnknown[0], reason: 'Auditor evidence hand-over', hours: 4, decidedDaysAgo: 10 },
    { status: 'REVOKED', dev: active[7], usb: usbUnknown[1], reason: 'Trade show demo content', hours: 48, decidedDaysAgo: 3 },
  ];
  for (const r of reqSpecs) {
    const requester = users.find((u) => u.id === r.dev.assignedUserId) ?? users[0];
    const decidedAt = r.decidedDaysAgo !== undefined ? ago(r.decidedDaysAgo * DAY) : null;
    const created_ = decidedAt ? new Date(decidedAt.getTime() - 2 * 3_600_000) : ago(int(1, 5) * 3_600_000);
    const reqRow = await prisma.usbAccessRequest.create({
      data: {
        deviceId: r.dev.id, usbDeviceId: r.usb.id, vendorId: r.usb.vendorId, productId: r.usb.productId, serialNumber: r.usb.serialNumber,
        requesterId: requester.id, reason: r.reason, durationHours: r.hours, readOnly: true, status: r.status,
        approverId: decidedAt ? byEmail[`itadmin@${domain}`].id : null,
        decisionNote: r.status === 'DENIED' ? 'Personal data must not be stored on corporate devices' : r.status === 'REVOKED' ? 'Event cancelled' : decidedAt ? 'Approved for the requested window' : null,
        decidedAt, expiresAt: decidedAt && r.status !== 'DENIED' ? new Date(decidedAt.getTime() + r.hours * 3_600_000) : null, createdAt: created_,
      },
    });
    audit({ category: 'USB', action: 'usb.request.create', actorType: 'USER', actorId: requester.id, actorName: requester.email, resourceType: 'UsbAccessRequest', resourceId: reqRow.id, deviceId: r.dev.id, occurredAt: created_, after: { reason: r.reason, durationHours: r.hours } });
    if (decidedAt) {
      audit({ category: 'USB', action: `usb.request.${r.status === 'DENIED' ? 'deny' : 'approve'}`, actorType: 'USER', actorId: byEmail[`itadmin@${domain}`].id, actorName: `itadmin@${domain}`, resourceType: 'UsbAccessRequest', resourceId: reqRow.id, deviceId: r.dev.id, occurredAt: decidedAt, after: { status: r.status === 'DENIED' ? 'DENIED' : 'APPROVED' } });
    }
  }

  // ── other alerts ──
  alertsToCreate.push({
    category: 'AUTH', severity: 'HIGH', status: 'RESOLVED', title: 'Account locked after repeated failed logins',
    message: `5 failed login attempts for olivia.johnson@${domain} from 203.0.113.45; account locked for 15 minutes.`, dedupeKey: 'auth:lockout:203.0.113.45',
    createdAt: daysAgo(9), lastOccurredAt: daysAgo(9), resolvedAt: daysAgo(8), resolvedById: byEmail[`secadmin@${domain}`].id, metadata: { ip: '203.0.113.45' },
  });
  alertsToCreate.push({
    category: 'PATCH', severity: 'HIGH', status: 'OPEN', title: 'Critical patches overdue on multiple devices',
    message: 'Several devices are missing critical security updates beyond the patch deadline.', dedupeKey: 'patch:overdue:fleet', createdAt: daysAgo(2), lastOccurredAt: ago(3_600_000), metadata: {},
  });
  await prisma.alert.createMany({ data: alertsToCreate });

  // ── alert channels (disabled placeholders) ──
  const crypto = process.env.ENCRYPTION_KEY ? new CryptoCore(process.env.ENCRYPTION_KEY) : null;
  if (crypto) {
    const channels: { name: string; type: 'EMAIL' | 'SLACK' | 'TEAMS' | 'SMS' | 'WHATSAPP' | 'WEBHOOK'; config: object; minSeverity: AlertSeverity; categories: AlertCategory[] }[] = [
      { name: 'Security Operations Email', type: 'EMAIL', config: { recipients: [`secops@${domain}`, `it-alerts@${domain}`] }, minSeverity: 'HIGH', categories: [] },
      { name: 'SOC Slack #sec-alerts', type: 'SLACK', config: { webhookUrl: 'https://hooks.slack.invalid/services/PLACEHOLDER/PLACEHOLDER/PLACEHOLDER' }, minSeverity: 'HIGH', categories: ['COMPLIANCE', 'SECURITY', 'SOFTWARE'] },
      { name: 'IT Teams Channel', type: 'TEAMS', config: { webhookUrl: 'https://example.webhook.office.com/webhookb2/placeholder' }, minSeverity: 'MEDIUM', categories: ['USB', 'PATCH', 'DEVICE'] },
      { name: 'On-call SMS', type: 'SMS', config: { provider: 'twilio', to: ['+15550100100'] }, minSeverity: 'CRITICAL', categories: [] },
      { name: 'SIEM Webhook', type: 'WEBHOOK', config: { url: 'https://siem.example.com/api/ingest/sem', secret: 'change-me-webhook-secret' }, minSeverity: 'LOW', categories: [] },
    ];
    for (const c of channels) {
      await prisma.alertChannel.upsert({
        where: { name: c.name },
        create: { name: c.name, type: c.type, configEnc: crypto.encryptJson(c.config), minSeverity: c.minSeverity, categories: c.categories, enabled: false },
        update: {},
      });
    }
  }

  // ── login history ──
  const loginUsers = [admin, ...demoUsers.map((d) => ({ id: byEmail[d.email].id, email: d.email }))];
  const logins: Prisma.LoginHistoryCreateManyInput[] = [];
  for (let d = 30; d >= 0; d--) {
    for (const u of loginUsers) {
      if (!chance(0.55)) continue;
      const at = new Date(daysAgo(d).setUTCHours(int(7, 18), int(0, 59), 0, 0));
      if (at > NOW) continue;
      const ip = `10.20.${int(1, 9)}.${int(10, 200)}`;
      const ua = pick(['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15']);
      if (chance(0.08)) logins.push({ userId: u.id, email: u.email, provider: 'LOCAL', success: false, reason: 'bad_password', ipAddress: ip, userAgent: ua, occurredAt: new Date(at.getTime() - 60_000) });
      logins.push({ userId: u.id, email: u.email, provider: 'LOCAL', success: true, ipAddress: ip, userAgent: ua, occurredAt: at });
      audit({ category: 'AUTH', action: 'auth.login.success', actorType: 'USER', actorId: u.id, actorName: u.email, resourceType: 'User', resourceId: u.id, ipAddress: ip, userAgent: ua, occurredAt: at, metadata: { provider: 'LOCAL' } });
    }
  }
  for (let k = 0; k < 5; k++) {
    const at = new Date(daysAgo(9).getTime() + k * 20_000);
    logins.push({ userId: users.find((u) => u.email.startsWith('olivia'))?.id ?? null, email: `olivia.johnson@${domain}`, provider: 'LOCAL', success: false, reason: k === 4 ? 'bad_password_locked' : 'bad_password', ipAddress: '203.0.113.45', userAgent: 'python-requests/2.32', occurredAt: at });
    audit({ category: 'AUTH', action: 'auth.login.failure', actorType: 'USER', actorName: `olivia.johnson@${domain}`, resourceType: 'User', success: false, ipAddress: '203.0.113.45', userAgent: 'python-requests/2.32', occurredAt: at, metadata: { reason: 'bad_password' } });
  }
  await prisma.loginHistory.createMany({ data: logins });

  // ── policy change history ──
  audit({ category: 'POLICY_CHANGE', action: 'policy.create', actorType: 'USER', actorId: admin.id, actorName: admin.email, resourceType: 'DevicePolicy', resourceId: policies.engPolicy.id, occurredAt: daysAgo(34), after: { name: policies.engPolicy.name } });
  audit({ category: 'POLICY_CHANGE', action: 'policy.create', actorType: 'USER', actorId: admin.id, actorName: admin.email, resourceType: 'DevicePolicy', resourceId: policies.finPolicy.id, occurredAt: daysAgo(34), after: { name: policies.finPolicy.name } });
  audit({ category: 'POLICY_CHANGE', action: 'department.update', actorType: 'USER', actorId: admin.id, actorName: admin.email, resourceType: 'Department', resourceId: depts.Finance.id, occurredAt: daysAgo(33), after: { policyId: policies.finPolicy.id } });

  // ── enrollment token (raw value intentionally not recoverable) ──
  const { createHash, randomBytes } = await import('crypto');
  const raw = 'sem_enr_' + randomBytes(32).toString('base64url');
  await prisma.enrollmentToken.create({
    data: { name: 'Q3 Windows rollout (demo)', tokenHash: createHash('sha256').update(raw).digest('hex'), tokenPrefix: raw.substring(0, 14), platform: 'WINDOWS', maxUses: 200, usedCount: 36, autoApprove: true, expiresAt: new Date(NOW.getTime() + 20 * DAY), createdById: byEmail[`itadmin@${domain}`].id, createdAt: daysAgo(40) },
  });

  // ── reports (completed rows with real files) + schedule ──
  const reportsDir = path.resolve(env('REPORTS_DIR', './data/reports'));
  fs.mkdirSync(reportsDir, { recursive: true });
  const devicesNow = await prisma.device.findMany({ where: { status: { not: 'RETIRED' } }, include: { department: true }, orderBy: { complianceScore: 'asc' } });
  const ds: ReportDataset = {
    title: 'Monthly Compliance Report',
    subtitle: 'Seeded example report',
    generatedAt: daysAgo(1),
    parameters: {},
    columns: [
      { key: 'deviceName', header: 'Device', width: 1.5 }, { key: 'platform', header: 'Platform' }, { key: 'department', header: 'Department' },
      { key: 'complianceState', header: 'State' }, { key: 'complianceScore', header: 'Score', width: 0.6 }, { key: 'riskLevel', header: 'Risk', width: 0.7 },
    ],
    rows: devicesNow.map((d) => ({ deviceName: d.deviceName, platform: d.platform, department: d.department?.name ?? '', complianceState: d.complianceState, complianceScore: d.complianceScore, riskLevel: d.riskLevel })),
    summary: [
      { label: 'Devices', value: devicesNow.length },
      { label: 'Compliant', value: devicesNow.filter((d) => d.complianceState === 'COMPLIANT').length },
      { label: 'Non-compliant', value: devicesNow.filter((d) => d.complianceState === 'NON_COMPLIANT').length },
      { label: 'Unknown', value: devicesNow.filter((d) => d.complianceState === 'UNKNOWN').length },
    ],
  };
  for (const [format, ext] of [['PDF', 'pdf'], ['CSV', 'csv']] as const) {
    const report = await prisma.report.create({
      data: { name: `Monthly Compliance Report (${format})`, type: 'COMPLIANCE', format, status: 'RUNNING', parameters: {}, requestedById: byEmail[`compliance@${domain}`].id, createdAt: daysAgo(1), startedAt: daysAgo(1) },
    });
    const file = path.join(reportsDir, `${report.id}.${ext}`);
    if (format === 'PDF') await renderPdf(ds, file);
    else await renderCsv(ds, file);
    await prisma.report.update({ where: { id: report.id }, data: { status: 'COMPLETED', filePath: file, fileSize: fs.statSync(file).size, rowCount: ds.rows.length, completedAt: daysAgo(1) } });
    audit({ category: 'USER_ACTION', action: 'report.create', actorType: 'USER', actorId: byEmail[`compliance@${domain}`].id, actorName: `compliance@${domain}`, resourceType: 'Report', resourceId: report.id, occurredAt: daysAgo(1), after: { type: 'COMPLIANCE', format } });
  }
  await prisma.reportSchedule.create({
    data: { name: 'Weekly compliance summary', type: 'COMPLIANCE', format: 'PDF', cron: '0 7 * * 1', parameters: {}, recipients: [`compliance@${domain}`, `secadmin@${domain}`], enabled: true, createdById: byEmail[`compliance@${domain}`].id },
  });

  // ── audit chain (chronological) ──
  audits.sort((a, b) => (a.occurredAt?.getTime() ?? 0) - (b.occurredAt?.getTime() ?? 0));
  for (const a of audits) await appendAuditLog(prisma, a);

  await prisma.systemSetting.upsert({ where: { key: 'seed.demoVersion' }, create: { key: 'seed.demoVersion', value: DEMO_VERSION }, update: { value: DEMO_VERSION } });
  console.log(`  demo data: ${created.length} devices, ${users.length} users, ${historyRows.length} compliance results, ${usbEvents.length} USB events, ${alertsToCreate.length} alerts, ${audits.length} audit entries`);
}

async function main() {
  const started = Date.now();
  console.log('Seeding SecureEndpoint Manager...');
  const ctx = await seedBase();
  console.log('  base data: roles, admin, departments, policies, rules, software catalog');
  if (bool('SEED_DEMO_DATA', true)) {
    const marker = await prisma.systemSetting.findUnique({ where: { key: 'seed.demoVersion' } });
    if (marker) console.log('  demo data already present - skipping');
    else
      await rootClient.$transaction(
        async (tx) => {
          prisma = tx as unknown as PrismaClient;
          try {
            await seedDemo(ctx);
          } finally {
            prisma = rootClient;
          }
        },
        { maxWait: 60_000, timeout: 30 * 60_000 },
      );
  }
  const lastAudit = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' } });
  const occurredAt = new Date(Math.max(Date.now(), (lastAudit?.occurredAt.getTime() ?? 0) + 1));
  await appendAuditLog(prisma, { category: 'SYSTEM' as AuditCategory, action: 'system.seed.run', actorType: 'SYSTEM', actorName: 'seed', occurredAt, metadata: { demo: bool('SEED_DEMO_DATA', true) } });
  console.log(`Seed completed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exitCode = 1;
  })
  .finally(() => rootClient.$disconnect());
