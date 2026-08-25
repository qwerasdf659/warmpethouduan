import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BoostModule } from '../boost/boost.module';
import { EconomyModule } from '../economy/economy.module';
import { PetModule } from '../pet/pet.module';
import { RaceRecord } from '../entities/race-record.entity';
import { RaceController } from './race.controller';
import { RaceService } from './race.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RaceRecord]),
    AuthModule,
    // 赛跑的看广告增值接口需要核销 AdTokenService 签发的一次性凭证
    BoostModule,
    EconomyModule,
    PetModule,
  ],
  controllers: [RaceController],
  providers: [RaceService],
  exports: [RaceService],
})
export class RaceModule {}
