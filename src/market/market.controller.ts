import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { AuthUser } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlayerStatusGuard } from '../auth/player-status.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { MarketService } from './market.service';
import type { Subject } from '../trading/trading.types';
import {
  BidDto,
  BizIdDto,
  BrowseListingsDto,
  CreateListingDto,
  GiftDto,
  RecycleDto,
  SubjectDto,
} from './dto/market.dto';

/**
 * 交易市场玩家端接口。
 *
 * 所有写接口都挂 `@Idempotent()`：交易是最不能重复执行的一类操作，而弱网下的
 * 客户端重试是常态。Redis 层的请求级去重挡住秒级重复，`asset_txn.biz_id`
 * 兜住持久幂等 —— 两层缺一不可（Redis 可丢，而丢掉的那次重试会真的再成交一笔）。
 */
@Controller('market')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class MarketController {
  constructor(private readonly market: MarketService) {}

  /** 市场浏览（在售挂单，按价格升序）。 */
  @Get('listings')
  browse(@Query() q: BrowseListingsDto) {
    return this.market.browse({
      assetCode: q.assetCode,
      mode: q.mode,
      page: q.page ?? 1,
      pageSize: q.pageSize ?? 20,
    });
  }

  /** 我的挂单（含已结束）。 */
  @Get('my-listings')
  myListings(@CurrentUser() user: AuthUser, @Query() q: BrowseListingsDto) {
    return this.market.myListings(user.userId, {
      page: q.page ?? 1,
      pageSize: q.pageSize ?? 20,
    });
  }

  /** 3a 系统回收。 */
  @Post('recycle')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  recycle(@CurrentUser() user: AuthUser, @Body() dto: RecycleDto) {
    return this.market.recycle(user.userId, subjectOf(dto), dto.bizId);
  }

  /** 3b 定向赠送。 */
  @Post('gift')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  gift(@CurrentUser() user: AuthUser, @Body() dto: GiftDto) {
    return this.market.gift(
      user.userId,
      dto.toUserId,
      subjectOf(dto),
      dto.bizId,
    );
  }

  /** 3c/3d 挂单。 */
  @Post('listings')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  list(@CurrentUser() user: AuthUser, @Body() dto: CreateListingDto) {
    return this.market.list(
      user.userId,
      subjectOf(dto),
      dto.price,
      dto.mode,
      dto.bizId,
    );
  }

  /** 撤单。 */
  @Post('listings/:id/cancel')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: BizIdDto,
  ) {
    return this.market.cancel(id, user.userId, dto.bizId);
  }

  /**
   * 3c 一价买入。
   *
   * 请求体仍要带 `bizId`（`@Idempotent()` 的 Redis 请求级去重按它算），
   * 但**不传给服务层**：成交的持久幂等键由挂单 id 决定，理由见
   * `MarketService.buyNow` 的注释。
   */
  @Post('listings/:id/buy')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  buy(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() _dto: BizIdDto,
  ) {
    return this.market.buyNow(id, user.userId);
  }

  /** 3d 出价。 */
  @Post('listings/:id/bid')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  bid(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: BidDto,
  ) {
    return this.market.bid(id, user.userId, dto.price, dto.bizId);
  }
}

/**
 * DTO → 服务层标的。
 *
 * 在这里做互斥校验而不是靠 class-validator：`ValidateIf` 能保证「没传 instanceId
 * 时 assetCode/qty 必填」，但表达不了「两者不能同时传」。而同时传两个是个真实的
 * 客户端 bug 形态（复用了同一份表单状态），静默取其一会让玩家卖掉不想卖的东西。
 */
function subjectOf(dto: SubjectDto): Subject {
  const hasInstance = !!dto.instanceId;
  const hasStack = !!dto.assetCode;
  if (hasInstance && hasStack) {
    throw new BadRequestException(
      'instanceId 与 assetCode 只能传一个：唯一物品按实例交易，可堆叠资产按件数交易',
    );
  }
  if (hasInstance) return { instanceId: dto.instanceId as string };
  if (hasStack) {
    return { assetCode: dto.assetCode as string, qty: dto.qty ?? 1 };
  }
  throw new BadRequestException('缺少交易标的');
}
