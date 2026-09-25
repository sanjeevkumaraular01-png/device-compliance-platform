import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AgentAuth, CurrentDevice, Public, SkipIpRestriction } from '../common/decorators';
import { clientIp } from '../common/request-context';
import type { AgentDevice } from '../common/types';
import { AgentReportDto, CommandResultDto, EnrollDto, HeartbeatDto, RenewCertificateDto, SoftwareEventsDto, UsbEventsDto } from './agent.dto';
import { AgentService } from './agent.service';

/** Endpoint agent protocol (docs/API.md "Agent protocol"). Exempt from console IP restrictions. */
@ApiTags('agent')
@Controller('agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Post('enroll')
  @Public()
  @SkipIpRestriction()
  @Throttle({ default: { limit: () => Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10) * 3, ttl: () => Number(process.env.RATE_LIMIT_TTL ?? 60) * 1000 } })
  @HttpCode(201)
  enroll(@Body() dto: EnrollDto, @Req() req: Request) {
    return this.agent.enroll(dto, clientIp(req) ?? null);
  }

  @Post('heartbeat')
  @AgentAuth()
  @SkipThrottle()
  @HttpCode(200)
  heartbeat(@CurrentDevice() device: AgentDevice, @Body() dto: HeartbeatDto) {
    return this.agent.heartbeat(device, dto);
  }

  @Post('report')
  @AgentAuth()
  @SkipThrottle()
  @HttpCode(200)
  report(@CurrentDevice() device: AgentDevice, @Body() dto: AgentReportDto) {
    return this.agent.report(device, dto);
  }

  @Post('usb-events')
  @AgentAuth()
  @SkipThrottle()
  @HttpCode(200)
  usbEvents(@CurrentDevice() device: AgentDevice, @Body() dto: UsbEventsDto) {
    return this.agent.usbEvents(device, dto);
  }

  @Post('software-events')
  @AgentAuth()
  @SkipThrottle()
  @HttpCode(200)
  softwareEvents(@CurrentDevice() device: AgentDevice, @Body() dto: SoftwareEventsDto) {
    return this.agent.softwareEvents(device, dto);
  }

  @Post('commands/:id/result')
  @AgentAuth()
  @SkipThrottle()
  @HttpCode(204)
  async commandResult(
    @CurrentDevice() device: AgentDevice,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommandResultDto,
  ) {
    await this.agent.commandResult(device, id, dto);
  }

  @Post('certificate/renew')
  @AgentAuth()
  @HttpCode(200)
  renewCertificate(@CurrentDevice() device: AgentDevice, @Body() dto: RenewCertificateDto, @Req() req: Request) {
    return this.agent.renewCertificate(device, dto, clientIp(req) ?? null);
  }

  @Get('policy')
  @AgentAuth()
  @SkipThrottle()
  policy(@CurrentDevice() device: AgentDevice) {
    return this.agent.policy(device);
  }
}
