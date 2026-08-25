import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { AdminAuditService } from './admin-audit.service';
import { QueryAuditDto } from './dto/query-audit.dto';

/** 审计日志查询（只读）。需 audit:read 权限。 */
@Controller('admin/audit-logs')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  @RequirePermissions('audit:read')
  list(@Query() q: QueryAuditDto) {
    return this.audit.query({
      page: q.page,
      pageSize: q.pageSize,
      adminUserId: q.adminUserId,
      success: q.success === undefined ? undefined : q.success === 'true',
    });
  }
}
