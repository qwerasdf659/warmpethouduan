import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt-auth.guard';
import { PlayerStatusGuard } from '../auth/player-status.guard';
import { AddressService } from './address.service';
import { CouponService } from './coupon.service';
import { ExchangeService } from './exchange.service';
import {
  CouponCodeDto,
  CreateAddressDto,
  OrderQueryDto,
  RedeemDto,
  UpdateAddressDto,
} from './dto/exchange.dto';

/** 兑换中心。 */
@Controller('exchange')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class ExchangeController {
  constructor(
    private readonly exchange: ExchangeService,
    private readonly coupon: CouponService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.exchange.list(user.userId);
  }

  @Get('orders')
  orders(@CurrentUser() user: AuthUser, @Query() q: OrderQueryDto) {
    return this.exchange.myOrders(user.userId, q);
  }

  @Post('redeem')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  redeem(@CurrentUser() user: AuthUser, @Body() dto: RedeemDto) {
    return this.exchange.redeem(
      user.userId,
      dto.exchangeKey,
      dto.bizId,
      dto.addressId,
    );
  }

  /** 我持有的满减券（按券种聚合）。 */
  @Get('coupons')
  coupons(@CurrentUser() user: AuthUser) {
    return this.coupon.myCoupons(user.userId);
  }

  /**
   * 出示核销码：**销毁一张券**换一枚 15 分钟有效的一次性码。
   *
   * 券在这一刻就离手了，出示后没去消费会浪费一张——这一点必须在前端明确提示，
   * 否则会变成客诉。理由见 `CouponService` 的类注释。
   */
  @Post('coupons/code')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  couponCode(@CurrentUser() user: AuthUser, @Body() dto: CouponCodeDto) {
    return this.coupon.issueCode(user.userId, dto.bizId, dto.assetCode);
  }
}

// 收货地址只为实物兑换存在（下单要求 addressId），归入 exchange/ 而非另起顶级前缀。
@Controller('exchange/address')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class AddressController {
  constructor(private readonly address: AddressService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.address.list(user.userId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAddressDto) {
    return this.address.create(user.userId, dto);
  }

  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.address.update(user.userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.address.remove(user.userId, id);
  }
}
