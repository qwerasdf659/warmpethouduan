import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { AdminTradeService } from './admin-trade.service';
import { QueryTradeOffersDto } from './dto/gameplay-query.dto';

/** 双向易货后台只读查询。无写操作，故不落审计。 */
@Controller('admin/trade')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AdminTradeController {
  constructor(private readonly svc: AdminTradeService) {}

  @Get('offers')
  @RequirePermissions('trade:read')
  offers(@Query() q: QueryTradeOffersDto) {
    return this.svc.offerList(q);
  }
}
