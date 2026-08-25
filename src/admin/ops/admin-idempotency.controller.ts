import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { AdminIdempotencyService } from './admin-idempotency.service';

/**
 * 幂等记录只读查询。需 player:read。
 *  - GET /admin/idempotency?userId=&bizId=  查单条
 *  - GET /admin/idempotency?userId=          扫该玩家全部
 */
@Controller('admin/idempotency')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AdminIdempotencyController {
  constructor(private readonly service: AdminIdempotencyService) {}

  @Get()
  @RequirePermissions('player:read')
  query(@Query('userId') userId?: string, @Query('bizId') bizId?: string) {
    if (!userId) throw new BadRequestException('缺少 userId');
    if (bizId) return this.service.getOne(userId, bizId);
    return this.service.scanByUser(userId);
  }
}
