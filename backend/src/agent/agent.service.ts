import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DeviceStatus, Prisma, SoftwareInventory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AlertsService } from '../alerts/alerts.service';
import { ComplianceService } from '../compliance/compliance.service';
import { PoliciesService } from '../policies/policies.service';
import { SoftwareService } from '../software/software.service';
import { CommandsService } from '../devices/commands.service';
import { CaService, IssuedCertificate } from '../enrollment/ca.service';
import { MetricsService } from '../metrics/metrics.service';
import { randomToken, safeEqual, sha256Hex } from '../common/crypto.service';
import { toJsonSafe } from '../common/utils/canonical-json';
import { generateAssetId } from '../devices/devices.service';
import type { AgentDevice } from '../common/types';
import {
  AgentReportDto,
  CommandResultDto,
  EnrollDto,
  HardwareInfoDto,
  HeartbeatDto,
  RenewCertificateDto,
  SoftwareEventsDto,
  UsbEventsDto,
} from './agent.dto';

const MAX_ITEM_AUDITS = 50;

const trimOrNull = (s: string | undefined | null, n: number) => (s == null || s === '' ? null : String(s).substring(0, n));

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly alerts: AlertsService,
    private readonly compliance: ComplianceService,
    private readonly policies: PoliciesService,
    private readonly software: SoftwareService,
    private readonly commands: CommandsService,
    private readonly ca: CaService,
    private readonly metrics: MetricsService,
  ) {}

  private hardwareData(h: HardwareInfoDto): Prisma.DeviceUncheckedUpdateInput {
    return {
      hostname: trimOrNull(h.hostname, 255),
      ...(h.manufacturer ? { manufacturer: trimOrNull(h.manufacturer, 120) } : {}),
      ...(h.model ? { model: trimOrNull(h.model, 200) } : {}),
      ...(h.deviceType ? { deviceType: h.deviceType } : {}),
      platform: h.platform,
      ...(h.osName ? { osName: trimOrNull(h.osName, 120) } : {}),
      ...(h.osVersion ? { osVersion: trimOrNull(h.osVersion, 120) } : {}),
      ...(h.osBuild ? { osBuild: trimOrNull(h.osBuild, 120) } : {}),
      ...(h.cpu ? { cpu: trimOrNull(h.cpu, 200) } : {}),
      ...(h.ramMb != null ? { ramMb: h.ramMb } : {}),
      ...(h.storageGb != null ? { storageGb: h.storageGb } : {}),
      ...(h.ipAddress ? { ipAddress: trimOrNull(h.ipAddress, 64) } : {}),
      ...(h.macAddresses ? { macAddresses: h.macAddresses.map((m) => m.toLowerCase()) } : {}),
    };
  }

  /** Map an OS login (DOMAIN\\user, user@domain, user) to a console user by email local part. */
  private async matchUser(loggedInUser?: string) {
    if (!loggedInUser) return null;
    const local = loggedInUser.split('\\').pop()!.split('@')[0].trim().toLowerCase();
    if (!local || ['root', 'administrator', 'admin', 'system'].includes(local)) return null;
    const users = await this.prisma.user.findMany({
      where: { email: { startsWith: `${local}@`, mode: 'insensitive' }, isActive: true },
      select: { id: true, departmentId: true },
      take: 2,
    });
    return users.length === 1 ? users[0] : null;
  }

  // ── Enrollment ──
  async enroll(dto: EnrollDto, ip: string | null) {
    if (!dto.enrollmentToken.startsWith('sem_enr_')) throw new UnauthorizedException('Invalid enrollment token');
    const hash = sha256Hex(dto.enrollmentToken);
    const token = await this.prisma.enrollmentToken.findUnique({ where: { tokenHash: hash } });
    if (!token || !safeEqual(token.tokenHash, hash)) throw new UnauthorizedException('Invalid enrollment token');
    if (token.revokedAt) throw new UnauthorizedException('Enrollment token has been revoked');
    if (token.expiresAt < new Date()) throw new UnauthorizedException('Enrollment token has expired');
    if (token.platform && token.platform !== dto.hardware.platform) {
      throw new UnprocessableEntityException(`Enrollment token is restricted to ${token.platform}`);
    }
    const claimed = await this.prisma.enrollmentToken.updateMany({
      where: { id: token.id, usedCount: { lt: token.maxUses } },
      data: { usedCount: { increment: 1 } },
    });
    if (claimed.count !== 1) throw new UnprocessableEntityException('Enrollment token has reached its maximum number of uses');

    const h = dto.hardware;
    const serial = h.serialNumber.trim();
    const existing = await this.prisma.device.findUnique({ where: { serialNumber: serial } });
    const agentToken = randomToken('sem_agt_', 48);
    const now = new Date();
    const approvedStates: DeviceStatus[] = ['ACTIVE', 'INACTIVE', 'QUARANTINED'];
    const status: DeviceStatus =
      existing && approvedStates.includes(existing.status)
        ? existing.status === 'INACTIVE'
          ? 'ACTIVE'
          : existing.status
        : token.autoApprove
          ? 'ACTIVE'
          : 'PENDING';
    const matchedUser = !existing?.assignedUserId ? await this.matchUser(h.loggedInUser) : null;

    const common = {
      ...this.hardwareData(h),
      agentVersion: dto.agentVersion,
      agentTokenHash: sha256Hex(agentToken),
      lastSeenAt: now,
      status,
      ...(status === 'ACTIVE' || status === 'QUARANTINED' ? { enrolledAt: existing?.enrolledAt ?? now } : {}),
    } satisfies Prisma.DeviceUncheckedUpdateInput;

    let device;
    if (existing) {
      device = await this.prisma.device.update({
        where: { id: existing.id },
        data: {
          ...common,
          ...(h.deviceName ? { deviceName: h.deviceName.substring(0, 200) } : {}),
          departmentId: existing.departmentId ?? token.departmentId ?? matchedUser?.departmentId ?? null,
          policyId: existing.policyId ?? token.policyId,
          ...(matchedUser ? { assignedUserId: matchedUser.id } : {}),
        },
      });
    } else {
      device = await this.prisma.device.create({
        data: {
          ...(common as Prisma.DeviceUncheckedCreateInput),
          deviceName: (h.deviceName || h.hostname).substring(0, 200),
          serialNumber: serial,
          assetId: generateAssetId(),
          platform: h.platform,
          departmentId: token.departmentId ?? matchedUser?.departmentId ?? null,
          policyId: token.policyId,
          assignedUserId: matchedUser?.id ?? null,
          macAddresses: h.macAddresses?.map((m) => m.toLowerCase()) ?? [],
          tags: [],
        },
      });
    }
    if (matchedUser) {
      await this.prisma.deviceAssignment.create({
        data: { deviceId: device.id, userId: matchedUser.id, notes: `Auto-assigned from logged-in user ${h.loggedInUser}` },
      });
    }

    // Device certificate (optional; RSA CSRs only)
    let cert: IssuedCertificate | null = null;
    if (dto.csrPem) {
      if (!/-----BEGIN (NEW )?CERTIFICATE REQUEST-----/.test(dto.csrPem)) throw new BadRequestException('csrPem is not a PEM certificate request');
      try {
        cert = this.ca.signCsr(dto.csrPem, device.id);
      } catch (e) {
        if ((e as Error).message.includes('signature verification')) throw e;
        this.logger.warn(`Could not sign CSR for device ${device.id} (${(e as Error).message}); continuing without certificate`);
      }
    }
    if (cert) await this.storeCertificate(device.id, cert, now);

    await this.audit.log({
      category: 'DEVICE_CHANGE',
      action: existing ? 'device.reenroll' : 'device.enroll',
      actorType: 'DEVICE',
      actorId: device.id,
      actorName: device.deviceName,
      resourceType: 'Device',
      resourceId: device.id,
      deviceId: device.id,
      ipAddress: ip,
      after: {
        serialNumber: serial,
        platform: h.platform,
        status,
        enrollmentTokenId: token.id,
        certificateIssued: !!cert,
        agentVersion: dto.agentVersion,
      },
    });

    if (status !== 'PENDING') {
      await this.compliance.evaluateDevice(device.id).catch((e) => this.logger.warn(`initial evaluation failed: ${e.message}`));
    }
    const policy = await this.policies.buildAgentPolicy(device);
    return {
      deviceId: device.id,
      agentToken,
      status,
      certificatePem: cert?.pem ?? null,
      caCertificatePem: this.ca.caCertificatePem,
      policy,
      checkinIntervalSec: policy.checkinIntervalSec,
    };
  }

  private async loadDevice(id: string) {
    const d = await this.prisma.device.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Device not found');
    return d;
  }

  // ── Heartbeat ──
  /** Replace the device's active certificate: revoke the old one(s), store the new one. */
  private async storeCertificate(deviceId: string, cert: IssuedCertificate, now: Date): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.deviceCertificate.updateMany({ where: { deviceId, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.deviceCertificate.create({
        data: {
          deviceId,
          serialNumber: cert.serialNumber,
          fingerprint: cert.fingerprint,
          subject: cert.subject,
          pem: cert.pem,
          issuedAt: cert.issuedAt,
          expiresAt: cert.expiresAt,
        },
      }),
    ]);
  }

  /**
   * Certificate renewal for an already-authenticated agent (agent token proves identity).
   * The agent calls this when its certificate is within 30 days of expiry.
   */
  async renewCertificate(agent: AgentDevice, dto: RenewCertificateDto, ip: string | null) {
    if (!/-----BEGIN (NEW )?CERTIFICATE REQUEST-----/.test(dto.csrPem)) throw new BadRequestException('csrPem is not a PEM certificate request');
    let cert: IssuedCertificate;
    try {
      cert = this.ca.signCsr(dto.csrPem, agent.id);
    } catch (e) {
      throw new BadRequestException(`Could not sign certificate request: ${(e as Error).message}`);
    }
    const now = new Date();
    await this.storeCertificate(agent.id, cert, now);
    await this.audit.log({
      category: 'DEVICE_CHANGE',
      action: 'device.certificate.renew',
      actorType: 'DEVICE',
      actorId: agent.id,
      actorName: agent.deviceName,
      resourceType: 'DeviceCertificate',
      resourceId: cert.serialNumber,
      deviceId: agent.id,
      ipAddress: ip,
      after: { fingerprint: cert.fingerprint, expiresAt: cert.expiresAt },
    });
    return { certificatePem: cert.pem, caCertificatePem: this.ca.caCertificatePem, expiresAt: cert.expiresAt };
  }

  async heartbeat(agent: AgentDevice, dto: HeartbeatDto) {
    this.metrics.agentCheckins.inc();
    const d = await this.loadDevice(agent.id);
    const now = new Date();
    const data: Prisma.DeviceUpdateInput = { lastSeenAt: now, agentVersion: dto.agentVersion };
    if (d.status === 'INACTIVE') data.status = 'ACTIVE';
    const updated = await this.prisma.device.update({ where: { id: d.id }, data });
    if (d.status === 'INACTIVE') {
      await this.audit.log({ category: 'DEVICE_CHANGE', action: 'device.online', resourceType: 'Device', resourceId: d.id, deviceId: d.id, before: { status: 'INACTIVE' }, after: { status: 'ACTIVE' } });
    }
    let commands: { id: string; type: string; payload: unknown; expiresAt: string }[] = [];
    if (updated.status !== 'PENDING') {
      const pending = await this.prisma.deviceCommand.findMany({
        where: { deviceId: d.id, status: 'PENDING', expiresAt: { gt: now } },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      if (pending.length) {
        await this.prisma.deviceCommand.updateMany({
          where: { id: { in: pending.map((c) => c.id) }, status: 'PENDING' },
          data: { status: 'SENT', sentAt: now },
        });
      }
      commands = pending.map((c) => ({ id: c.id, type: c.type, payload: c.payload ?? {}, expiresAt: c.expiresAt.toISOString() }));
    }
    const policy = await this.policies.buildAgentPolicy(updated);
    return { policy, policyVersion: policy.version, commands, serverTime: now.toISOString() };
  }

  async policy(agent: AgentDevice) {
    const d = await this.loadDevice(agent.id);
    return this.policies.buildAgentPolicy(d);
  }

  // ── Full state report ──
  async report(agent: AgentDevice, dto: AgentReportDto) {
    this.metrics.agentReports.inc();
    const device = await this.loadDevice(agent.id);
    const now = new Date();
    if (dto.hardware.serialNumber && dto.hardware.serialNumber.trim() !== device.serialNumber) {
      this.logger.warn(`Device ${device.id} reported serial ${dto.hardware.serialNumber} but is enrolled as ${device.serialNumber}`);
    }
    const { policy } = await this.policies.resolveForDevice(device);

    // 1. hardware / inventory fields
    await this.prisma.device.update({
      where: { id: device.id },
      data: {
        ...this.hardwareData(dto.hardware),
        ...(dto.hardware.deviceName ? { deviceName: dto.hardware.deviceName.substring(0, 200) } : {}),
        lastSeenAt: now,
        ...(device.status === 'INACTIVE' ? { status: 'ACTIVE' } : {}),
      },
    });

    // 2. security status
    const s = dto.security;
    const collectedAt = new Date(dto.collectedAt);
    const securityData = {
      antivirusState: s.antivirusState,
      antivirusProduct: trimOrNull(s.antivirusProduct, 200),
      antivirusSignatureAt: s.antivirusSignatureAt ? new Date(s.antivirusSignatureAt) : null,
      edrState: s.edrState,
      edrProduct: trimOrNull(s.edrProduct, 200),
      firewallState: s.firewallState,
      diskEncryptionState: s.diskEncryptionState,
      encryptionMethod: trimOrNull(s.encryptionMethod, 64),
      bitlockerState: s.bitlockerState ?? 'UNKNOWN',
      secureBootState: s.secureBootState,
      tpmPresent: s.tpmPresent ?? null,
      screenLockEnabled: s.screenLockEnabled ?? null,
      screenLockTimeoutSec: s.screenLockTimeoutSec ?? null,
      passwordOnWake: s.passwordOnWake ?? null,
      screenSaverEnabled: s.screenSaverEnabled ?? null,
      autoUpdateEnabled: s.autoUpdateEnabled ?? null,
      usbStorageEnabled: s.usbStorageEnabled ?? null,
      pendingRebootRequired: s.pendingRebootRequired ?? null,
      lastBootAt: s.lastBootAt ? new Date(s.lastBootAt) : null,
      raw: toJsonSafe<Prisma.InputJsonValue>(s.raw ?? {}),
      collectedAt,
    };
    const prevSecurity = await this.prisma.securityStatus.findUnique({ where: { deviceId: device.id } });
    await this.prisma.securityStatus.upsert({
      where: { deviceId: device.id },
      create: { deviceId: device.id, ...securityData },
      update: securityData,
    });
    const watched = ['antivirusState', 'edrState', 'firewallState', 'diskEncryptionState', 'secureBootState', 'usbStorageEnabled', 'screenLockEnabled'] as const;
    if (prevSecurity) {
      const changed = watched.filter((k) => prevSecurity[k] !== securityData[k]);
      if (changed.length) {
        await this.audit.log({
          category: 'SECURITY',
          action: 'device.security.change',
          resourceType: 'Device',
          resourceId: device.id,
          deviceId: device.id,
          before: Object.fromEntries(changed.map((k) => [k, prevSecurity[k]])),
          after: Object.fromEntries(changed.map((k) => [k, securityData[k]])),
        });
      }
    }

    // 3. software inventory reconciliation
    await this.reconcileSoftware(device.id, device.deviceName, device.platform, policy.blockUnauthorizedSoftware, policy.autoUninstallBlacklisted, dto, now);

    // 4. patches
    await this.upsertPatches(device.id, dto, now);

    // 5. compliance
    const result = await this.compliance.evaluateDevice(device.id);
    return {
      complianceState: result.state,
      complianceScore: result.score,
      riskLevel: result.riskLevel,
      findings: result.findings,
    };
  }

  private async reconcileSoftware(
    deviceId: string,
    deviceName: string,
    platform: AgentDevice['platform'],
    blockUnauthorized: boolean,
    policyAutoUninstall: boolean,
    dto: AgentReportDto,
    now: Date,
  ) {
    const existing = await this.prisma.softwareInventory.findMany({ where: { deviceId } });
    const key = (name: string, version: string) => `${name.trim().toLowerCase()}\u0000${version.trim()}`;
    const byKey = new Map<string, SoftwareInventory>(existing.map((e) => [key(e.name, e.version), e]));
    const hadInventory = existing.some((e) => !e.removedAt) || existing.length > 0;
    const { blacklist } = await this.software.catalog();

    const reported = new Map<string, (typeof dto.software)[number]>();
    for (const item of dto.software) reported.set(key(item.name, item.version ?? ''), item);

    const toCreate: Prisma.SoftwareInventoryCreateManyInput[] = [];
    const installed: { name: string; version: string; status: string }[] = [];
    const newlyBlacklisted: { name: string; version: string; matchedRuleId: string | null }[] = [];
    const seenIds: string[] = [];
    const updates: Prisma.PrismaPromise<unknown>[] = [];

    for (const [k, item] of reported) {
      const version = (item.version ?? '').substring(0, 128);
      const c = await this.software.classify(
        { name: item.name, version, publisher: item.publisher, source: item.source },
        platform,
        blockUnauthorized,
      );
      const row = byKey.get(k);
      if (!row) {
        toCreate.push({
          deviceId,
          name: item.name.substring(0, 255),
          version,
          publisher: trimOrNull(item.publisher, 255),
          installDate: item.installDate ? new Date(item.installDate) : null,
          installLocation: trimOrNull(item.installLocation, 1024),
          sizeMb: item.sizeMb != null ? Math.round(item.sizeMb) : null,
          source: trimOrNull(item.source, 32),
          status: c.status,
          matchedRuleId: c.matchedRuleId,
          firstSeenAt: now,
          lastSeenAt: now,
        });
        installed.push({ name: item.name, version, status: c.status });
        if (c.status === 'BLACKLISTED') newlyBlacklisted.push({ name: item.name, version, matchedRuleId: c.matchedRuleId });
        continue;
      }
      seenIds.push(row.id);
      const reinstalled = !!row.removedAt;
      if (reinstalled) installed.push({ name: row.name, version, status: c.status });
      if ((reinstalled || row.status !== 'BLACKLISTED') && c.status === 'BLACKLISTED') {
        newlyBlacklisted.push({ name: row.name, version, matchedRuleId: c.matchedRuleId });
      }
      if (
        reinstalled ||
        row.status !== c.status ||
        row.matchedRuleId !== c.matchedRuleId ||
        (item.publisher && row.publisher !== item.publisher)
      ) {
        updates.push(
          this.prisma.softwareInventory.update({
            where: { id: row.id },
            data: {
              status: c.status,
              matchedRuleId: c.matchedRuleId,
              removedAt: null,
              lastSeenAt: now,
              ...(item.publisher ? { publisher: item.publisher.substring(0, 255) } : {}),
              ...(reinstalled ? { firstSeenAt: now } : {}),
            },
          }),
        );
      }
    }
    const removed = existing.filter((e) => !e.removedAt && !reported.has(key(e.name, e.version)));

    if (toCreate.length) await this.prisma.softwareInventory.createMany({ data: toCreate, skipDuplicates: true });
    if (updates.length) await this.prisma.$transaction(updates);
    if (seenIds.length) await this.prisma.softwareInventory.updateMany({ where: { id: { in: seenIds } }, data: { lastSeenAt: now } });
    if (removed.length) {
      await this.prisma.softwareInventory.updateMany({ where: { id: { in: removed.map((r) => r.id) } }, data: { removedAt: now } });
    }

    // Audit trail
    if (!hadInventory) {
      if (toCreate.length) {
        await this.audit.log({
          category: 'SOFTWARE',
          action: 'software.inventory.initial',
          resourceType: 'Device',
          resourceId: deviceId,
          deviceId,
          after: {
            items: toCreate.length,
            unauthorized: toCreate.filter((t) => t.status === 'UNAUTHORIZED').length,
            blacklisted: toCreate.filter((t) => t.status === 'BLACKLISTED').length,
          },
        });
      }
    } else {
      const events = [
        ...installed.map((i) => ({ action: 'software.installed', ...i })),
        ...removed.map((r) => ({ action: 'software.removed', name: r.name, version: r.version, status: r.status })),
      ];
      for (const e of events.slice(0, MAX_ITEM_AUDITS)) {
        await this.audit.log({
          category: 'SOFTWARE',
          action: e.action,
          resourceType: 'SoftwareInventory',
          resourceId: e.name.substring(0, 128),
          deviceId,
          after: { name: e.name, version: e.version, status: e.status },
        });
      }
      if (events.length > MAX_ITEM_AUDITS) {
        await this.audit.log({
          category: 'SOFTWARE',
          action: 'software.inventory.bulk_change',
          resourceType: 'Device',
          resourceId: deviceId,
          deviceId,
          after: { installed: installed.length, removed: removed.length, notItemized: events.length - MAX_ITEM_AUDITS },
        });
      }
    }

    // Alerts / enforcement for blacklisted software
    for (const b of newlyBlacklisted) {
      const rule = blacklist.find((r) => r.id === b.matchedRuleId);
      await this.alerts.raise({
        deviceId,
        category: 'SOFTWARE',
        severity: rule?.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
        title: `Blacklisted software detected: ${b.name}`,
        message: `${b.name}${b.version ? ` ${b.version}` : ''} was found on ${deviceName}.${rule ? ` Reason: ${rule.reason}` : ''}`,
        dedupeKey: `software:${deviceId}:${b.name.toLowerCase()}`,
        metadata: { name: b.name, version: b.version, ruleId: b.matchedRuleId },
      });
      if (policyAutoUninstall || rule?.autoUninstall) {
        await this.commands.create(deviceId, 'UNINSTALL_SOFTWARE', { name: b.name, ...(b.version ? { version: b.version } : {}) }, { audit: true });
      }
    }
    for (const r of removed.filter((x) => x.status === 'BLACKLISTED')) {
      const stillPresent = [...reported.values()].some((i) => i.name.toLowerCase() === r.name.toLowerCase());
      if (!stillPresent) await this.alerts.autoResolve(`software:${deviceId}:${r.name.toLowerCase()}`, 'software removed');
    }
  }

  private async upsertPatches(deviceId: string, dto: AgentReportDto, now: Date) {
    const seen = new Set<string>();
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const p of dto.patches) {
      if (seen.has(p.patchId)) continue;
      seen.add(p.patchId);
      const data = {
        title: p.title.substring(0, 500),
        category: p.category ?? 'OS',
        severity: p.severity ?? 'UNSPECIFIED',
        state: p.state,
        product: trimOrNull(p.product, 200),
        cveIds: (p.cveIds ?? []).map((c) => c.toUpperCase()),
        cvssScore: p.cvssScore ?? null,
        releasedAt: p.releasedAt ? new Date(p.releasedAt) : null,
        installedAt: p.installedAt ? new Date(p.installedAt) : p.state === 'INSTALLED' ? now : null,
      };
      ops.push(
        this.prisma.patchStatus.upsert({
          where: { deviceId_patchId: { deviceId, patchId: p.patchId } },
          create: { deviceId, patchId: p.patchId, ...data, detectedAt: now },
          update: { ...data, ...(p.state !== 'FAILED' ? { lastError: null } : {}) },
        }),
      );
    }
    for (let i = 0; i < ops.length; i += 200) await this.prisma.$transaction(ops.slice(i, i + 200));
  }

  // ── USB events ──
  async usbEvents(agent: AgentDevice, dto: UsbEventsDto) {
    const device = await this.loadDevice(agent.id);
    let accepted = 0;
    for (const e of dto.events) {
      const vendorId = e.vendorId?.toLowerCase().replace(/^0x/, '') || null;
      const productId = e.productId?.toLowerCase().replace(/^0x/, '') || null;
      const occurredAt = new Date(e.occurredAt);
      let usbDeviceId: string | null = null;
      if (vendorId && productId) {
        const usb = await this.prisma.usbDevice.upsert({
          where: { vendorId_productId_serialNumber: { vendorId, productId, serialNumber: e.serialNumber ?? '' } },
          create: {
            vendorId,
            productId,
            serialNumber: e.serialNumber ?? '',
            productName: trimOrNull(e.label, 200),
            deviceClass: e.deviceClass,
            firstSeenAt: occurredAt,
            lastSeenAt: occurredAt,
          },
          update: { lastSeenAt: occurredAt },
        });
        usbDeviceId = usb.id;
      }
      await this.prisma.usbEvent.create({
        data: {
          deviceId: device.id,
          usbDeviceId,
          eventType: e.eventType,
          deviceClass: e.deviceClass,
          vendorId,
          productId,
          serialNumber: trimOrNull(e.serialNumber, 128),
          label: trimOrNull(e.label, 255),
          userName: trimOrNull(e.userName, 255),
          filePath: trimOrNull(e.filePath, 2048),
          bytes: e.bytes != null ? BigInt(Math.round(e.bytes)) : null,
          policyReason: trimOrNull(e.policyReason, 500),
          occurredAt,
        },
      });
      accepted++;
      if (e.eventType === 'BLOCKED') {
        this.metrics.usbBlocked.inc();
        const hourBucket = occurredAt.toISOString().substring(0, 13);
        const usbKey = e.serialNumber || (vendorId && productId ? `${vendorId}:${productId}` : 'unknown');
        await this.alerts.raise({
          deviceId: device.id,
          category: 'USB',
          severity: 'MEDIUM',
          title: `USB device blocked on ${device.deviceName}`,
          message: `${e.label || e.deviceClass} (${vendorId ?? '?'}:${productId ?? '?'}${e.serialNumber ? `, S/N ${e.serialNumber}` : ''}) was blocked${e.userName ? ` for user ${e.userName}` : ''}.${e.policyReason ? ` ${e.policyReason}` : ''}`,
          dedupeKey: `usb:${device.id}:${usbKey}:${hourBucket}`,
          metadata: { vendorId, productId, serialNumber: e.serialNumber, deviceClass: e.deviceClass },
        });
        await this.audit.log({
          category: 'USB',
          action: 'usb.blocked',
          resourceType: 'UsbDevice',
          resourceId: usbDeviceId,
          deviceId: device.id,
          success: false,
          after: { vendorId, productId, serialNumber: e.serialNumber, label: e.label, userName: e.userName, occurredAt: e.occurredAt },
        });
      } else if (e.eventType === 'ALLOWED' || e.eventType === 'FILE_WRITE') {
        await this.audit.log({
          category: 'USB',
          action: e.eventType === 'ALLOWED' ? 'usb.allowed' : 'usb.file_write',
          resourceType: 'UsbDevice',
          resourceId: usbDeviceId,
          deviceId: device.id,
          after: { vendorId, productId, serialNumber: e.serialNumber, filePath: e.filePath, bytes: e.bytes, userName: e.userName },
        });
      }
    }
    await this.prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    return { accepted };
  }

  // ── Software events ──
  async softwareEvents(agent: AgentDevice, dto: SoftwareEventsDto) {
    const device = await this.loadDevice(agent.id);
    let accepted = 0;
    for (const e of dto.events) {
      accepted++;
      await this.audit.log({
        category: 'SOFTWARE',
        action: `software.event.${e.action.toLowerCase()}`,
        resourceType: 'Software',
        resourceId: e.name.substring(0, 128),
        deviceId: device.id,
        success: e.action !== 'BLOCKED',
        after: { name: e.name, version: e.version, publisher: e.publisher, userName: e.userName, occurredAt: e.occurredAt },
      });
      if (e.action === 'BLOCKED') {
        await this.alerts.raise({
          deviceId: device.id,
          category: 'SOFTWARE',
          severity: 'MEDIUM',
          title: `Software execution/installation blocked: ${e.name}`,
          message: `${e.name}${e.version ? ` ${e.version}` : ''} was blocked on ${device.deviceName}${e.userName ? ` for ${e.userName}` : ''}.`,
          dedupeKey: `software-blocked:${device.id}:${e.name.toLowerCase()}`,
          metadata: { name: e.name, version: e.version },
        });
      }
    }
    return { accepted };
  }

  // ── Command results ──
  async commandResult(agent: AgentDevice, commandId: string, dto: CommandResultDto) {
    const cmd = await this.prisma.deviceCommand.findUnique({ where: { id: commandId } });
    if (!cmd || cmd.deviceId !== agent.id) throw new NotFoundException('Command not found');
    if (cmd.status === 'SUCCEEDED' || cmd.status === 'FAILED' || cmd.status === 'CANCELLED') return;
    const result = toJsonSafe<Prisma.InputJsonValue>({
      output: dto.output?.substring(0, 65536) ?? null,
      error: dto.error ?? null,
      data: dto.data ?? null,
    });
    await this.prisma.deviceCommand.update({
      where: { id: cmd.id },
      data: { status: dto.status, result, completedAt: new Date(), sentAt: cmd.sentAt ?? new Date() },
    });
    if (cmd.type === 'INSTALL_PATCHES' && dto.status === 'FAILED') {
      await this.prisma.patchStatus.updateMany({
        where: { deviceId: agent.id, state: 'PENDING_INSTALL' },
        data: { state: 'FAILED', lastError: dto.error?.substring(0, 1000) ?? 'Installation failed' },
      });
    }
    await this.audit.log({
      category: 'DEVICE_CHANGE',
      action: 'device.command.result',
      resourceType: 'DeviceCommand',
      resourceId: cmd.id,
      deviceId: agent.id,
      success: dto.status === 'SUCCEEDED',
      after: { type: cmd.type, status: dto.status, error: dto.error },
    });
  }
}
