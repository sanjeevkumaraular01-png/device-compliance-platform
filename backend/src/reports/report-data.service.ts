import { Injectable } from '@nestjs/common';
import { ComplianceState, OsPlatform, Prisma, ReportType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { deviceScope } from '../common/scope';
import type { AuthUser } from '../common/types';
import { ReportDataset } from './renderers/renderers';

export interface ReportParameters {
  from?: string;
  to?: string;
  departmentId?: string;
  platform?: OsPlatform;
  complianceState?: ComplianceState;
}

const MAX_ROWS = 100_000;

const TITLES: Record<ReportType, string> = {
  COMPLIANCE: 'Device Compliance Report',
  DEVICE: 'Device Inventory Report',
  SOFTWARE: 'Software Inventory Report',
  SECURITY: 'Endpoint Security Report',
  AUDIT: 'Audit Log Report',
  USB: 'USB Activity Report',
  PATCH: 'Patch & Vulnerability Report',
};

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '0%');

/** Builds report datasets (columns + rows + summary) per report type. */
@Injectable()
export class ReportDataService {
  constructor(private readonly prisma: PrismaService) {}

  title(type: ReportType) {
    return TITLES[type];
  }

  private range(p: ReportParameters, defaultDays: number) {
    const to = p.to ? new Date(p.to) : new Date();
    const from = p.from ? new Date(p.from) : new Date(to.getTime() - defaultDays * 86_400_000);
    return { from, to };
  }

  private deviceWhere(p: ReportParameters, user?: AuthUser): Prisma.DeviceWhereInput {
    return {
      AND: [
        deviceScope(user),
        { status: { not: 'RETIRED' } },
        ...(p.departmentId ? [{ departmentId: p.departmentId }] : []),
        ...(p.platform ? [{ platform: p.platform }] : []),
        ...(p.complianceState ? [{ complianceState: p.complianceState }] : []),
      ],
    };
  }

  async build(type: ReportType, p: ReportParameters, user?: AuthUser): Promise<ReportDataset> {
    const base = { title: TITLES[type], generatedAt: new Date(), parameters: p as Record<string, unknown> };
    switch (type) {
      case 'COMPLIANCE':
        return { ...base, ...(await this.compliance(p, user)) };
      case 'DEVICE':
        return { ...base, ...(await this.devices(p, user)) };
      case 'SOFTWARE':
        return { ...base, ...(await this.software(p, user)) };
      case 'SECURITY':
        return { ...base, ...(await this.security(p, user)) };
      case 'AUDIT':
        return { ...base, ...(await this.audit(p)) };
      case 'USB':
        return { ...base, ...(await this.usb(p, user)) };
      case 'PATCH':
        return { ...base, ...(await this.patches(p, user)) };
    }
  }

  private async compliance(p: ReportParameters, user?: AuthUser) {
    const devices = await this.prisma.device.findMany({
      where: this.deviceWhere(p, user),
      include: {
        department: { select: { name: true } },
        assignedUser: { select: { displayName: true } },
        complianceResults: { orderBy: { evaluatedAt: 'desc' }, take: 1 },
      },
      orderBy: [{ complianceScore: 'asc' }, { deviceName: 'asc' }],
      take: MAX_ROWS,
    });
    const rows = devices.map((d) => {
      const r = d.complianceResults[0];
      const failing = ((r?.findings as { passed: boolean; ruleKey: string }[] | undefined) ?? []).filter((f) => !f.passed).map((f) => f.ruleKey);
      return {
        deviceName: d.deviceName,
        serialNumber: d.serialNumber,
        platform: d.platform,
        department: d.department?.name ?? '',
        assignedUser: d.assignedUser?.displayName ?? '',
        state: d.complianceState,
        score: d.complianceScore,
        riskLevel: d.riskLevel,
        failingRules: failing,
        lastEvaluatedAt: d.lastEvaluatedAt,
      };
    });
    const total = rows.length;
    const compliant = rows.filter((r) => r.state === 'COMPLIANT').length;
    const non = rows.filter((r) => r.state === 'NON_COMPLIANT').length;
    const avg = total ? Math.round(rows.reduce((s, r) => s + r.score, 0) / total) : 0;
    return {
      subtitle: 'Current compliance posture of managed devices against their effective policy.',
      columns: [
        { key: 'deviceName', header: 'Device', width: 1.4 },
        { key: 'serialNumber', header: 'Serial', width: 1.1 },
        { key: 'platform', header: 'Platform', width: 0.8 },
        { key: 'department', header: 'Department', width: 1 },
        { key: 'assignedUser', header: 'User', width: 1.1 },
        { key: 'state', header: 'State', width: 1 },
        { key: 'score', header: 'Score', width: 0.5 },
        { key: 'riskLevel', header: 'Risk', width: 0.7 },
        { key: 'failingRules', header: 'Failing rules', width: 2.5 },
        { key: 'lastEvaluatedAt', header: 'Evaluated', width: 1.2 },
      ],
      rows,
      summary: [
        { label: 'Devices', value: total },
        { label: 'Compliant', value: compliant },
        { label: 'Non-compliant', value: non },
        { label: 'Compliance rate', value: pct(compliant, total) },
        { label: 'Average score', value: avg },
        { label: 'Critical risk', value: rows.filter((r) => r.riskLevel === 'CRITICAL').length },
        { label: 'High risk', value: rows.filter((r) => r.riskLevel === 'HIGH').length },
        { label: 'Unknown', value: rows.filter((r) => r.state === 'UNKNOWN').length },
      ],
    };
  }

  private async devices(p: ReportParameters, user?: AuthUser) {
    const devices = await this.prisma.device.findMany({
      where: this.deviceWhere(p, user),
      include: { department: { select: { name: true } }, assignedUser: { select: { displayName: true, email: true } } },
      orderBy: { deviceName: 'asc' },
      take: MAX_ROWS,
    });
    const rows = devices.map((d) => ({
      assetId: d.assetId,
      deviceName: d.deviceName,
      serialNumber: d.serialNumber,
      deviceType: d.deviceType,
      platform: d.platform,
      os: [d.osName, d.osVersion].filter(Boolean).join(' '),
      model: [d.manufacturer, d.model].filter(Boolean).join(' '),
      ramGb: d.ramMb ? Math.round(d.ramMb / 1024) : null,
      storageGb: d.storageGb,
      department: d.department?.name ?? '',
      assignedUser: d.assignedUser?.email ?? '',
      status: d.status,
      warrantyStatus: d.warrantyStatus,
      warrantyExpiresAt: d.warrantyExpiresAt ? d.warrantyExpiresAt.toISOString().substring(0, 10) : '',
      lastSeenAt: d.lastSeenAt,
    }));
    return {
      subtitle: 'Hardware and assignment inventory of managed devices.',
      columns: [
        { key: 'assetId', header: 'Asset ID', width: 0.9 },
        { key: 'deviceName', header: 'Device', width: 1.3 },
        { key: 'serialNumber', header: 'Serial', width: 1 },
        { key: 'deviceType', header: 'Type', width: 0.8 },
        { key: 'platform', header: 'Platform', width: 0.7 },
        { key: 'os', header: 'OS', width: 1.3 },
        { key: 'model', header: 'Model', width: 1.6 },
        { key: 'ramGb', header: 'RAM GB', width: 0.5 },
        { key: 'storageGb', header: 'Disk GB', width: 0.5 },
        { key: 'department', header: 'Department', width: 0.9 },
        { key: 'assignedUser', header: 'User', width: 1.4 },
        { key: 'status', header: 'Status', width: 0.7 },
        { key: 'warrantyStatus', header: 'Warranty', width: 0.7 },
        { key: 'warrantyExpiresAt', header: 'Warranty ends', width: 0.8 },
        { key: 'lastSeenAt', header: 'Last seen', width: 1.1 },
      ],
      rows,
      summary: [
        { label: 'Devices', value: rows.length },
        { label: 'Windows', value: rows.filter((r) => r.platform === 'WINDOWS').length },
        { label: 'macOS', value: rows.filter((r) => r.platform === 'MACOS').length },
        { label: 'Linux', value: rows.filter((r) => r.platform === 'LINUX').length },
        { label: 'Warranty expired', value: rows.filter((r) => r.warrantyStatus === 'EXPIRED').length },
        { label: 'Warranty expiring', value: rows.filter((r) => r.warrantyStatus === 'EXPIRING').length },
        { label: 'Unassigned', value: rows.filter((r) => !r.assignedUser).length },
        { label: 'Pending', value: rows.filter((r) => r.status === 'PENDING').length },
      ],
    };
  }

  private async software(p: ReportParameters, user?: AuthUser) {
    const items = await this.prisma.softwareInventory.findMany({
      where: { removedAt: null, device: this.deviceWhere(p, user) },
      include: { device: { select: { deviceName: true, platform: true } } },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      take: MAX_ROWS,
    });
    const rows = items.map((s) => ({
      name: s.name,
      version: s.version,
      publisher: s.publisher ?? '',
      status: s.status,
      device: s.device.deviceName,
      platform: s.device.platform,
      installDate: s.installDate ? s.installDate.toISOString().substring(0, 10) : '',
      source: s.source ?? '',
      firstSeenAt: s.firstSeenAt,
    }));
    const distinct = new Set(rows.map((r) => r.name)).size;
    return {
      subtitle: 'Installed software across managed devices with classification status.',
      columns: [
        { key: 'name', header: 'Software', width: 2 },
        { key: 'version', header: 'Version', width: 0.9 },
        { key: 'publisher', header: 'Publisher', width: 1.4 },
        { key: 'status', header: 'Status', width: 1 },
        { key: 'device', header: 'Device', width: 1.3 },
        { key: 'platform', header: 'Platform', width: 0.7 },
        { key: 'installDate', header: 'Installed', width: 0.8 },
        { key: 'source', header: 'Source', width: 0.7 },
        { key: 'firstSeenAt', header: 'First seen', width: 1.1 },
      ],
      rows,
      summary: [
        { label: 'Installations', value: rows.length },
        { label: 'Distinct titles', value: distinct },
        { label: 'Approved', value: rows.filter((r) => r.status === 'APPROVED').length },
        { label: 'Unauthorized', value: rows.filter((r) => r.status === 'UNAUTHORIZED').length },
        { label: 'Blacklisted', value: rows.filter((r) => r.status === 'BLACKLISTED').length },
        { label: 'Unknown', value: rows.filter((r) => r.status === 'UNKNOWN').length },
        { label: 'Devices affected', value: new Set(items.filter((i) => i.status === 'UNAUTHORIZED' || i.status === 'BLACKLISTED').map((i) => i.deviceId)).size },
      ],
    };
  }

  private async security(p: ReportParameters, user?: AuthUser) {
    const devices = await this.prisma.device.findMany({
      where: this.deviceWhere(p, user),
      include: { securityStatus: true, department: { select: { name: true } } },
      orderBy: { deviceName: 'asc' },
      take: MAX_ROWS,
    });
    const rows = devices.map((d) => {
      const s = d.securityStatus;
      return {
        deviceName: d.deviceName,
        platform: d.platform,
        department: d.department?.name ?? '',
        antivirus: s ? `${s.antivirusState}${s.antivirusProduct ? ` (${s.antivirusProduct})` : ''}` : 'UNKNOWN',
        edr: s ? `${s.edrState}${s.edrProduct ? ` (${s.edrProduct})` : ''}` : 'UNKNOWN',
        firewall: s?.firewallState ?? 'UNKNOWN',
        encryption: s ? `${s.diskEncryptionState}${s.encryptionMethod ? ` (${s.encryptionMethod})` : ''}` : 'UNKNOWN',
        secureBoot: s?.secureBootState ?? 'UNKNOWN',
        screenLock: s?.screenLockEnabled == null ? 'UNKNOWN' : s.screenLockEnabled ? `On (${s.screenLockTimeoutSec ?? '?'}s)` : 'Off',
        usbStorage: s?.usbStorageEnabled == null ? 'UNKNOWN' : s.usbStorageEnabled ? 'Enabled' : 'Blocked',
        collectedAt: s?.collectedAt ?? null,
      };
    });
    const count = (f: (s: NonNullable<(typeof devices)[number]['securityStatus']>) => boolean) =>
      devices.filter((d) => d.securityStatus && f(d.securityStatus)).length;
    return {
      subtitle: 'Endpoint protection, encryption and hardening status.',
      columns: [
        { key: 'deviceName', header: 'Device', width: 1.3 },
        { key: 'platform', header: 'Platform', width: 0.7 },
        { key: 'department', header: 'Department', width: 0.9 },
        { key: 'antivirus', header: 'Antivirus', width: 1.5 },
        { key: 'edr', header: 'EDR', width: 1.5 },
        { key: 'firewall', header: 'Firewall', width: 0.8 },
        { key: 'encryption', header: 'Encryption', width: 1.3 },
        { key: 'secureBoot', header: 'Secure Boot', width: 0.8 },
        { key: 'screenLock', header: 'Screen lock', width: 0.8 },
        { key: 'usbStorage', header: 'USB storage', width: 0.8 },
        { key: 'collectedAt', header: 'Collected', width: 1.1 },
      ],
      rows,
      summary: [
        { label: 'Devices', value: devices.length },
        { label: 'Encrypted', value: count((s) => s.diskEncryptionState === 'ENABLED') },
        { label: 'Antivirus active', value: count((s) => s.antivirusState === 'ENABLED') },
        { label: 'EDR active', value: count((s) => s.edrState === 'ENABLED') },
        { label: 'Firewall on', value: count((s) => s.firewallState === 'ENABLED') },
        { label: 'Secure Boot on', value: count((s) => s.secureBootState === 'ENABLED') },
        { label: 'USB storage enabled', value: count((s) => s.usbStorageEnabled === true) },
        { label: 'No data', value: devices.filter((d) => !d.securityStatus).length },
      ],
    };
  }

  private async audit(p: ReportParameters) {
    const { from, to } = this.range(p, 30);
    const logs = await this.prisma.auditLog.findMany({
      where: { occurredAt: { gte: from, lte: to } },
      orderBy: { id: 'asc' },
      take: MAX_ROWS,
    });
    const rows = logs.map((l) => ({
      id: l.id.toString(),
      occurredAt: l.occurredAt,
      category: l.category,
      action: l.action,
      actor: l.actorName ?? l.actorId ?? l.actorType,
      resource: [l.resourceType, l.resourceId].filter(Boolean).join(':'),
      ipAddress: l.ipAddress ?? '',
      success: l.success,
      hash: l.hash.substring(0, 16),
    }));
    return {
      subtitle: `Tamper-evident audit trail from ${from.toISOString().substring(0, 10)} to ${to.toISOString().substring(0, 10)}.`,
      columns: [
        { key: 'id', header: '#', width: 0.5 },
        { key: 'occurredAt', header: 'Time', width: 1.2 },
        { key: 'category', header: 'Category', width: 1 },
        { key: 'action', header: 'Action', width: 1.6 },
        { key: 'actor', header: 'Actor', width: 1.5 },
        { key: 'resource', header: 'Resource', width: 1.8 },
        { key: 'ipAddress', header: 'IP', width: 0.9 },
        { key: 'success', header: 'OK', width: 0.4 },
        { key: 'hash', header: 'Hash', width: 1 },
      ],
      rows,
      summary: [
        { label: 'Entries', value: rows.length },
        { label: 'Failures', value: rows.filter((r) => !r.success).length },
        { label: 'Auth events', value: rows.filter((r) => r.category === 'AUTH').length },
        { label: 'Policy changes', value: rows.filter((r) => r.category === 'POLICY_CHANGE').length },
      ],
    };
  }

  private async usb(p: ReportParameters, user?: AuthUser) {
    const { from, to } = this.range(p, 30);
    const events = await this.prisma.usbEvent.findMany({
      where: { occurredAt: { gte: from, lte: to }, device: this.deviceWhere({ ...p, complianceState: undefined }, user) },
      include: { device: { select: { deviceName: true } } },
      orderBy: { occurredAt: 'desc' },
      take: MAX_ROWS,
    });
    const rows = events.map((e) => ({
      occurredAt: e.occurredAt,
      device: e.device.deviceName,
      eventType: e.eventType,
      deviceClass: e.deviceClass,
      vidPid: [e.vendorId, e.productId].filter(Boolean).join(':'),
      serialNumber: e.serialNumber ?? '',
      label: e.label ?? '',
      userName: e.userName ?? '',
      policyReason: e.policyReason ?? '',
    }));
    return {
      subtitle: `USB device activity from ${from.toISOString().substring(0, 10)} to ${to.toISOString().substring(0, 10)}.`,
      columns: [
        { key: 'occurredAt', header: 'Time', width: 1.2 },
        { key: 'device', header: 'Device', width: 1.3 },
        { key: 'eventType', header: 'Event', width: 0.8 },
        { key: 'deviceClass', header: 'Class', width: 1 },
        { key: 'vidPid', header: 'VID:PID', width: 0.8 },
        { key: 'serialNumber', header: 'USB serial', width: 1.1 },
        { key: 'label', header: 'Label', width: 1.3 },
        { key: 'userName', header: 'User', width: 1 },
        { key: 'policyReason', header: 'Reason', width: 1.6 },
      ],
      rows,
      summary: [
        { label: 'Events', value: rows.length },
        { label: 'Blocked', value: rows.filter((r) => r.eventType === 'BLOCKED').length },
        { label: 'Allowed', value: rows.filter((r) => r.eventType === 'ALLOWED').length },
        { label: 'Devices', value: new Set(events.map((e) => e.deviceId)).size },
      ],
    };
  }

  private async patches(p: ReportParameters, user?: AuthUser) {
    const items = await this.prisma.patchStatus.findMany({
      where: { state: { in: ['MISSING', 'FAILED', 'PENDING_INSTALL'] }, device: this.deviceWhere(p, user) },
      include: { device: { select: { deviceName: true, platform: true } } },
      orderBy: [{ severity: 'asc' }, { releasedAt: 'asc' }],
      take: MAX_ROWS,
    });
    const rows = items.map((x) => ({
      device: x.device.deviceName,
      platform: x.device.platform,
      patchId: x.patchId,
      title: x.title,
      severity: x.severity,
      state: x.state,
      cveIds: x.cveIds,
      cvssScore: x.cvssScore,
      releasedAt: x.releasedAt ? x.releasedAt.toISOString().substring(0, 10) : '',
      ageDays: x.releasedAt ? Math.floor((Date.now() - x.releasedAt.getTime()) / 86_400_000) : null,
    }));
    return {
      subtitle: 'Missing, failed and pending patches with associated vulnerabilities.',
      columns: [
        { key: 'device', header: 'Device', width: 1.2 },
        { key: 'platform', header: 'Platform', width: 0.7 },
        { key: 'patchId', header: 'Patch', width: 1.2 },
        { key: 'title', header: 'Title', width: 2.4 },
        { key: 'severity', header: 'Severity', width: 0.8 },
        { key: 'state', header: 'State', width: 0.9 },
        { key: 'cveIds', header: 'CVEs', width: 1.5 },
        { key: 'cvssScore', header: 'CVSS', width: 0.5 },
        { key: 'releasedAt', header: 'Released', width: 0.8 },
        { key: 'ageDays', header: 'Age (d)', width: 0.5 },
      ],
      rows,
      summary: [
        { label: 'Outstanding patches', value: rows.length },
        { label: 'Critical', value: rows.filter((r) => r.severity === 'CRITICAL').length },
        { label: 'Important', value: rows.filter((r) => r.severity === 'IMPORTANT').length },
        { label: 'Failed', value: rows.filter((r) => r.state === 'FAILED').length },
        { label: 'Devices affected', value: new Set(items.map((i) => i.deviceId)).size },
        { label: 'Distinct CVEs', value: new Set(items.flatMap((i) => i.cveIds)).size },
      ],
    };
  }
}
