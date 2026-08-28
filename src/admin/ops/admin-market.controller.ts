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
import { AdminMarketService } from './admin-market.service';
import { QueryMarketBidsDto } from './dto/gameplay-query.dto';
import {
  ForceCancelListingDto,
  QueryListingsDto,
  QueryNetFlowDto,
} from './dto/market-admin.dto';

/**
 * 交易市场后台：挂单查询（market:read）+ 强制撤单（market:write）+ 风控清单。
 *
 * 权限与 `wallet:*` 分开是有意的：看市场行情、查纠纷挂单是日常客服工作，
 * 而人工发币是资金操作。合成一个权限就意味着「能看挂单」的人也能凭空造币。
 * 强制撤单单列 `market:write`，因为它会动到玩家已经锁定的资产。
 */
@Controller('admin/market')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminMarketController {
  constructor(private readonly service: AdminMarketService) {}

  /** 当前开关与阈值。排查「为什么挂不上单」的第一站。 */
  @Get('status')
  @RequirePermissions('market:read')
  status() {
    return this.service.status();
  }

  /** 挂单列表（含已结束的：处理纠纷最需要看的就是这些）。 */
  @Get('listings')
  @RequirePermissions('market:read')
  listListings(@Query() q: QueryListingsDto) {
    return this.service.listListings(q);
  }

  /** 竞价出价（出价即冻结买家资金，强制撤单前应先看这里）。 */
  @Get('bids')
  @RequirePermissions('market:read')
  listBids(@Query() q: QueryMarketBidsDto) {
    return this.service.listBids(q);
  }

  /** R4 单向净流出清单（洗号 / 代练的人工复核线索）。 */
  @Get('risk/net-flow')
  @RequirePermissions('market:read')
  netFlow(@Query() q: QueryNetFlowDto) {
    return this.service.netFlow(q);
  }

  /**
   * 强制撤单。退回标的 + 解冻全部活跃出价 + 落终态，与玩家撤单同一份实现。
   */
  @Post('listings/:id/force-cancel')
  @RequirePermissions('market:write')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  @Audit('强制撤单', 'market_listing')
  forceCancel(@Param('id') id: string, @Body() dto: ForceCancelListingDto) {
    return this.service.forceCancel(id, dto);
  }
}
