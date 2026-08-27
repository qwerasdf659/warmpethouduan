import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { EventModule } from '../event/event.module';
import { Daily } from '../entities/daily.entity';
import { DailyController } from './daily.controller';
import { DailyService } from './daily.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Daily]),
    AuthModule,
    EconomyModule,
    EventModule,
  ],
  controllers: [DailyController],
  providers: [DailyService],
  exports: [DailyService],
})
export class DailyModule {}
