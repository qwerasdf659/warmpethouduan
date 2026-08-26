import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { ItemsModule } from '../items/items.module';
import { RedeemOrder } from '../entities/redeem-order.entity';
import { UserAddress } from '../entities/user-address.entity';
import { AddressService } from './address.service';
import { ExchangeService } from './exchange.service';
import { AddressController, ExchangeController } from './exchange.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([RedeemOrder, UserAddress]),
    AuthModule,
    EconomyModule,
    // 虚拟礼包即时到账走 ItemsService.grant
    ItemsModule,
  ],
  controllers: [ExchangeController, AddressController],
  providers: [ExchangeService, AddressService],
  exports: [ExchangeService, AddressService],
})
export class ExchangeModule {}
