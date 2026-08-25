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
  constructor(private readonly service: AdminExchangeService) {}

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
}
