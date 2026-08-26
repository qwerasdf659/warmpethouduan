import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { AdminAuditInterceptor } from '../audit/admin-audit.interceptor';
import { Audit } from '../decorators/audit.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { AdminPromoService } from './admin-promo.service';
import {
  CreatePromoBatchDto,
  QueryPromoCodeDto,
  QueryPromoRedemptionDto,
  TogglePromoDto,
} from './dto/promo-admin.dto';

/**
 * 后台兑换码：生码/查码/作废（promo:write）与列表/核销记录（promo:read）。
 *
 * 生码走独立权限而不是复用 `wallet:write`：兑换码等于**预先签发的积分**，
 * 谁能印码就等于谁能凭空造积分，这个口子该单独授权、单独审计。
 */
@Controller('admin/promo')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminPromoController {
  constructor(private readonly service: AdminPromoService) {}

  @Get('batches')
  @RequirePermissions('promo:read')
  listBatches() {
    return this.service.listBatches();
  }

  @Get('codes')
  @RequirePermissions('promo:read')
  listCodes(@Query() q: QueryPromoCodeDto) {
    return this.service.listCodes(q);
  }

  @Get('redemptions')
  @RequirePermissions('promo:read')
  listRedemptions(@Query() q: QueryPromoRedemptionDto) {
    return this.service.listRedemptions(q);
  }

  @Post('batches')
  @RequirePermissions('promo:write')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  @Audit('生成兑换码批次', 'promo')
  createBatch(@Body() dto: CreatePromoBatchDto) {
    return this.service.createBatch(dto);
  }

  @Post('codes/:id/toggle')
  @RequirePermissions('promo:write')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  @Audit('停用/启用兑换码', 'promo')
  toggleCode(@Param('id') id: string, @Body() dto: TogglePromoDto) {
    return this.service.toggleCode(id, dto.enabled);
  }

  @Post('batches/:batch/toggle')
  @RequirePermissions('promo:write')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  @Audit('停用/启用兑换码批次', 'promo')
  toggleBatch(@Param('batch') batch: string, @Body() dto: TogglePromoDto) {
    return this.service.toggleBatch(batch, dto.enabled);
  }
}
