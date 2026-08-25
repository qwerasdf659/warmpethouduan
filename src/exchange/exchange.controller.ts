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
import { ExchangeService } from './exchange.service';
import {
  CreateAddressDto,
  OrderQueryDto,
  RedeemDto,
  UpdateAddressDto,
} from './dto/exchange.dto';

/** 兑换中心。 */
@Controller('exchange')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class ExchangeController {
  constructor(private readonly exchange: ExchangeService) {}

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
}

/** 收货地址。 */
@Controller('address')
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
