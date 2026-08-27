import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { LedgerModule } from '../ledger/ledger.module';
import { MinigameSession } from '../entities/minigame-session.entity';
import { EventModule } from '../event/event.module';
import { MinigameController } from './minigame.controller';
import { MinigameService } from './minigame.service';

/**
 * 小游戏赚币域（P11）。发币直接走账本域（`RewardService`），
 * 钱包视图走 `EconomyService`。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([MinigameSession]),
    AuthModule,
    EconomyModule,
    LedgerModule,
    EventModule,
  ],
  controllers: [MinigameController],
  providers: [MinigameService],
  exports: [MinigameService],
})
export class MinigameModule {}
