import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { OsPlatform, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppConfigService } from '../config/app-config.service';
import { CryptoService, sha256Hex } from '../common/crypto.service';
import { ComplianceService } from '../compliance/compliance.service';
import { paginated, skipTake, orderBy, PaginationQueryDto } from '../common/dto/pagination.dto';
import { DEVICE_INCLUDE, serializeDevice } from '../devices/devices.service';
import type { AuthUser } from '../common/types';
import { CreateEnrollmentTokenDto, EnrollmentListQueryDto } from './enrollment.dto';

const TOKEN_PREFIX = 'sem_enr_';

@Injectable()
export class EnrollmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly crypto: CryptoService,
    private readonly compliance: ComplianceService,
  ) {}

  private status(t: { revokedAt: Date | null; expiresAt: Date; usedCount: number; maxUses: number }) {
    if (t.revokedAt) return 'REVOKED';
    if (t.expiresAt < new Date()) return 'EXPIRED';
    if (t.usedCount >= t.maxUses) return 'EXHAUSTED';
    return 'ACTIVE';
  }

  private serialize<T extends { tokenHash: string; revokedAt: Date | null; expiresAt: Date; usedCount: number; maxUses: number }>(t: T) {
    const { tokenHash: _h, ...rest } = t;
    return { ...rest, status: this.status(t) };
  }

  async listTokens(q: EnrollmentListQueryDto) {
    const where: Prisma.EnrollmentTokenWhereInput = q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {};
    const [rows, total] = await Promise.all([
      this.prisma.enrollmentToken.findMany({
        where,
        orderBy: orderBy(q, ['createdAt', 'name', 'expiresAt', 'usedCount'], 'createdAt'),
        ...skipTake(q),
      }),
      this.prisma.enrollmentToken.count({ where }),
    ]);
    return paginated(rows.map((r) => this.serialize(r)), q.page, q.pageSize, total);
  }

  async createToken(dto: CreateEnrollmentTokenDto, actor: AuthUser) {
    if (dto.departmentId && !(await this.prisma.department.findUnique({ where: { id: dto.departmentId } }))) {
      throw new BadRequestException('departmentId does not exist');
    }
    if (dto.policyId && !(await this.prisma.devicePolicy.findUnique({ where: { id: dto.policyId } }))) {
      throw new BadRequestException('policyId does not exist');
    }
    const token = this.crypto.randomToken(TOKEN_PREFIX, 32);
    const row = await this.prisma.enrollmentToken.create({
      data: {
        name: dto.name,
        tokenHash: sha256Hex(token),
        tokenPrefix: token.substring(0, TOKEN_PREFIX.length + 6),
        platform: dto.platform,
        departmentId: dto.departmentId,
        policyId: dto.policyId,
        maxUses: dto.maxUses ?? 100,
        autoApprove: dto.autoApprove ?? true,
        expiresAt: new Date(Date.now() + (dto.expiresInDays ?? 30) * 86_400_000),
        createdById: actor.id,
      },
    });
    const out = this.serialize(row);
    await this.audit.log({ category: 'DEVICE_CHANGE', action: 'enrollment_token.create', resourceType: 'EnrollmentToken', resourceId: row.id, after: out });
    return { ...out, token };
  }

  async revokeToken(id: string) {
    const t = await this.prisma.enrollmentToken.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Enrollment token not found');
    const row = await this.prisma.enrollmentToken.update({ where: { id }, data: { revokedAt: t.revokedAt ?? new Date() } });
    await this.audit.log({ category: 'DEVICE_CHANGE', action: 'enrollment_token.revoke', resourceType: 'EnrollmentToken', resourceId: id });
    return this.serialize(row);
  }

  async installCommand(tokenId: string, platform: OsPlatform, rawToken?: string) {
    const t = await this.prisma.enrollmentToken.findUnique({ where: { id: tokenId } });
    if (!t) throw new NotFoundException('Enrollment token not found');
    if (t.platform && t.platform !== platform) {
      throw new UnprocessableEntityException(`This token is restricted to ${t.platform}`);
    }
    if (rawToken && sha256Hex(rawToken) !== t.tokenHash) throw new BadRequestException('token does not match tokenId');
    const token = rawToken ?? '<ENROLLMENT_TOKEN>';
    const server = this.config.apiPublicUrl;
    const base = this.config.agentDownloadBaseUrl;
    switch (platform) {
      case 'WINDOWS': {
        const downloadUrl = `${base}/sem-agent-windows-amd64.msi`;
        const command =
          `$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; ` +
          `$msi=Join-Path $env:TEMP 'sem-agent.msi'; Invoke-WebRequest -UseBasicParsing -Uri '${downloadUrl}' -OutFile $msi; ` +
          `Start-Process msiexec.exe -Wait -ArgumentList @('/i',$msi,'/qn','SERVER_URL=${server}','ENROLLMENT_TOKEN=${token}')`;
        return { platform, command, downloadUrl, shell: 'powershell' };
      }
      case 'MACOS': {
        const downloadUrl = `${base}/sem-agent-darwin-universal.pkg`;
        const command =
          `curl -fsSL '${base}/install.sh' | sudo SEM_SERVER_URL='${server}' SEM_ENROLLMENT_TOKEN='${token}' /bin/zsh -s -- --platform macos`;
        return { platform, command, downloadUrl, shell: 'zsh' };
      }
      case 'LINUX':
      default: {
        const downloadUrl = `${base}/sem-agent-linux-amd64.tar.gz`;
        const command =
          `curl -fsSL '${base}/install.sh' | sudo SEM_SERVER_URL='${server}' SEM_ENROLLMENT_TOKEN='${token}' bash -s -- --platform linux`;
        return { platform, command, downloadUrl, shell: 'bash' };
      }
    }
  }

  async pending(q: PaginationQueryDto) {
    const where: Prisma.DeviceWhereInput = { status: 'PENDING' };
    if (q.search) {
      where.OR = [
        { deviceName: { contains: q.search, mode: 'insensitive' } },
        { serialNumber: { contains: q.search, mode: 'insensitive' } },
        { hostname: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.device.findMany({ where, include: DEVICE_INCLUDE, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.prisma.device.count({ where }),
    ]);
    return paginated(rows.map(serializeDevice), q.page, q.pageSize, total);
  }

  async approve(id: string) {
    const d = await this.prisma.device.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Device not found');
    if (d.status !== 'PENDING') throw new UnprocessableEntityException('Device is not pending approval');
    await this.prisma.device.update({ where: { id }, data: { status: 'ACTIVE', enrolledAt: d.enrolledAt ?? new Date() } });
    await this.audit.log({ category: 'DEVICE_CHANGE', action: 'device.enrollment.approve', resourceType: 'Device', resourceId: id, deviceId: id, before: { status: 'PENDING' }, after: { status: 'ACTIVE' } });
    await this.compliance.evaluateDevice(id);
    const out = await this.prisma.device.findUniqueOrThrow({ where: { id }, include: DEVICE_INCLUDE });
    return serializeDevice(out);
  }

  async reject(id: string, reason?: string) {
    const d = await this.prisma.device.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Device not found');
    if (d.status !== 'PENDING') throw new UnprocessableEntityException('Device is not pending approval');
    await this.prisma.$transaction([
      this.prisma.device.update({ where: { id }, data: { status: 'RETIRED', agentTokenHash: null } }),
      this.prisma.deviceCertificate.updateMany({ where: { deviceId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log({ category: 'DEVICE_CHANGE', action: 'device.enrollment.reject', resourceType: 'Device', resourceId: id, deviceId: id, before: { status: 'PENDING' }, after: { status: 'RETIRED', reason } });
    const out = await this.prisma.device.findUniqueOrThrow({ where: { id }, include: DEVICE_INCLUDE });
    return serializeDevice(out);
  }
}
