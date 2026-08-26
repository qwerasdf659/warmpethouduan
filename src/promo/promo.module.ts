import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { PromoCode } from '../entities/promo-code.entity';
import { PromoRedemption } from '../entities/promo-redemption.entity';
import { PromoController } from './promo.controller';
import { PromoService } from './promo.service';

/** 兑换码域：玩家侧核销（后台生码在 AdminModule）。 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PromoCode, PromoRedemption]),
    AuthModule,
    EconomyModule,
  ],
  controllers: [PromoController],
  providers: [PromoService],
  exports: [PromoService],
})
export class PromoModule {}
