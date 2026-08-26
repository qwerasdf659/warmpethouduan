import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { GachaDraw } from '../entities/gacha-draw.entity';
import { GachaState } from '../entities/gacha-state.entity';
import { ItemsModule } from '../items/items.module';
import { GachaController } from './gacha.controller';
import { GachaService } from './gacha.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([GachaDraw, GachaState]),
    AuthModule,
    EconomyModule,
    ItemsModule,
  ],
  controllers: [GachaController],
  providers: [GachaService],
  exports: [GachaService],
})
export class GachaModule {}
