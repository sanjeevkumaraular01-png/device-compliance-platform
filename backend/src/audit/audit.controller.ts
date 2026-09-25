import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermissions } from '../common/decorators';
import { AuditService } from './audit.service';
import { AuditExportQueryDto, AuditQueryDto, LoginHistoryQueryDto } from './audit.dto';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
@RequirePermissions('audit:read')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() q: AuditQueryDto) {
    return this.audit.list(q);
  }

  @Get('verify')
  verify() {
    return this.audit.verify();
  }

  @Get('login-history')
  loginHistory(@Query() q: LoginHistoryQueryDto) {
    return this.audit.loginHistory(q);
  }

  @Get('export')
  async export(@Query() q: AuditExportQueryDto, @Res() res: Response) {
    const csv = await this.audit.exportCsv(q);
    const name = `audit-log-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(csv);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.audit.get(id);
  }
}
