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
import { AdminAuditInterceptor } from '../audit/admin-audit.interceptor';
import { Audit } from '../decorators/audit.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { CouponService } from '../../exchange/coupon.service';
import { CouponVerifyDto } from '../../exchange/dto/exchange.dto';
import { AdminExchangeService } from './admin-exchange.service';
import {
  CancelOrderDto,
  QueryOrdersDto,
  ShipOrderDto,
} from './dto/admin-exchange.dto';

@Controller('admin/exchange')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminExchangeController {
  constructor(
    private readonly service: AdminExchangeService,
    private readonly coupon: CouponService,
  ) {}

  @Get('orders')
  @RequirePermissions('exchange:read')
  list(@Query() q: QueryOrdersDto) {
    return this.service.list(q);
  }

  @Post('orders/:id/ship')
  @RequirePermissions('exchange:write')
  @Audit('兑换订单发货', 'redeem_order')
  ship(@Param('id') id: string, @Body() dto: ShipOrderDto) {
    return this.service.ship(id, dto);
  }

  @Post('orders/:id/cancel')
  @RequirePermissions('exchange:write')
  @Audit('兑换订单取消退款', 'redeem_order')
  cancel(@Param('id') id: string, @Body() dto: CancelOrderDto) {
    return this.service.cancel(id, dto);
  }

  /**
   * 门店核销满减券。原子读删，同一码只能成功一次。
   *
   * 落审计日志：核销是「玩家用掉了一次线下权益」，出纠纷时要能查到谁在何时核销了哪张。
   * 券本身在玩家出示码那一刻就已从账本销毁，这里不再动账。
   */
  @Post('coupons/verify')
  @RequirePermissions('exchange:write')
  @Audit('核销满减券', 'coupon')
  verifyCoupon(@Body() dto: CouponVerifyDto) {
    return this.coupon.verifyCode(dto.code);
  }
}
