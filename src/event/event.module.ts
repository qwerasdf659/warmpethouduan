import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { LedgerModule } from '../ledger/ledger.module';
import { GameEvent } from '../entities/game-event.entity';
import { EventProgress } from '../entities/event-progress.entity';
import { EventController } from './event.controller';
import { EventService } from './event.service';
import { EventProgressService } from './event-progress.service';
import { EventLifecycleService } from './event-lifecycle.service';

/**
 * 限时活动玩家端（P12）。
 *
 * 后台 CRUD（AdminEventController / AdminEventService）注册在 `AdminModule`，
 * 因为它依赖后台专属守卫（AdminJwtAuthGuard / RolesGuard）与审计拦截器。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([GameEvent, EventProgress]),
    AuthModule,
    EconomyModule,
    LedgerModule,
  ],
  controllers: [EventController],
  providers: [EventService, EventProgressService, EventLifecycleService],
  exports: [EventService, EventProgressService],
})
export class EventModule {}
