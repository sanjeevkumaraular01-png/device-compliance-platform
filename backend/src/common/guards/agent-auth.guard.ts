import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { safeEqual, sha256Hex } from '../crypto.service';
import { RequestContext } from '../request-context';
import type { AgentDevice } from '../types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Authenticates endpoint agents: `Authorization: Bearer sem_agt_...` + `X-Device-Id`. */
@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const auth: string | undefined = req.headers['authorization'];
    const deviceId = String(req.headers['x-device-id'] ?? '');
    if (!auth || !auth.startsWith('Bearer ') || !deviceId || !UUID_RE.test(deviceId)) {
      throw new UnauthorizedException('Agent credentials required');
    }
    const token = auth.substring(7).trim();
    if (!token.startsWith('sem_agt_')) throw new UnauthorizedException('Invalid agent token');

    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: {
        id: true, serialNumber: true, platform: true, deviceName: true, departmentId: true,
        assignedUserId: true, status: true, agentTokenHash: true,
      },
    });
    if (!device || !device.agentTokenHash || !safeEqual(device.agentTokenHash, sha256Hex(token))) {
      throw new UnauthorizedException('Invalid agent token');
    }
    if (device.status === 'RETIRED') throw new UnauthorizedException('Device has been retired');

    const { agentTokenHash: _omit, ...rest } = device;
    req.device = rest as AgentDevice;
    RequestContext.set({ actorType: 'DEVICE', actorId: device.id, actorName: device.deviceName });
    return true;
  }
}
