import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AgentAuth, CurrentDevice, Public, SkipIpRestriction } from '../common/decorators';
import { clientIp } from '../common/request-context';
import type { AgentDevice } from '../common/types';
import { AgentReportDto, CommandResultDto, EnrollDto, HeartbeatDto, RenewCertificateDto, SoftwareEventsDto, UsbEventsDto } from './agent.dto';
import { AgentService } from './agent.service';
import { WorkforceIngestService } from '../workforce/ingest.service';
import { MAX_SCREENSHOT_BYTES, ScreenshotsService, UploadedImage } from '../workforce/screenshots.service';
import { AgentActivityDto, AgentScreenshotDto } from '../workforce/workforce.dto';

/** Endpoint agent protocol (docs/API.md "Agent protocol"). Exempt from console IP restrictions. */
@ApiTags('agent')
@Controller('agent')
export class AgentController {
  constructor(
    private readonly agent: AgentService,
    private readonly workforce: WorkforceIngestService,
    private readonly screenshots: ScreenshotsService,
  ) {}

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

  // ── Workforce (docs/WORKFORCE.md "Agent protocol additions") ──

  @Post('activity')
  @AgentAuth()
  @SkipThrottle()
  @HttpCode(200)
  activity(@CurrentDevice() device: AgentDevice, @Body() dto: AgentActivityDto) {
    return this.workforce.ingestActivity(device, dto);
  }

  @Post('screenshots')
  @AgentAuth()
  @SkipThrottle()
  @HttpCode(201)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image', 'capturedAt', 'osUser', 'blurred'],
      properties: {
        image: { type: 'string', format: 'binary', description: 'JPEG <= 2 MB' },
        capturedAt: { type: 'string', format: 'date-time' },
        osUser: { type: 'string' },
        activeApp: { type: 'string' },
        blurred: { type: 'string', enum: ['true', 'false'] },
      },
    },
  })
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_SCREENSHOT_BYTES, files: 1, fields: 20 } }))
  uploadScreenshot(@CurrentDevice() device: AgentDevice, @Body() dto: AgentScreenshotDto, @UploadedFile() file: UploadedImage | undefined) {
    return this.screenshots.upload(device, dto, file);
  }
}
