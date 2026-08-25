import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { AdminStatsService } from './admin-stats.service';

@Controller('admin/stats')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AdminStatsController {
  constructor(private readonly stats: AdminStatsService) {}

  @Get('overview')
  @RequirePermissions('stats:read')
  overview() {
    return this.stats.overview();
  }

  @Get('trend')
  @RequirePermissions('stats:read')
  trend(@Query('days') days?: string) {
    return this.stats.trend(days ? parseInt(days, 10) : 7);
  }
}
