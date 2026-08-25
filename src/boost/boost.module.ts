import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { PetModule } from '../pet/pet.module';
import {
  AdController,
  BoostController,
  StaminaController,
} from './boost.controller';
import { AdTokenService } from './ad-token.service';
import { BoostService } from './boost.service';

@Module({
  imports: [AuthModule, EconomyModule, PetModule],
  controllers: [AdController, BoostController, StaminaController],
  providers: [BoostService, AdTokenService],
  // AdTokenService 导出给玩法域（赛跑增值接口）核销凭证
  exports: [BoostService, AdTokenService],
})
export class BoostModule {}
