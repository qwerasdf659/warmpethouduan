import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt-auth.guard';
import { PlayerStatusGuard } from '../auth/player-status.guard';
import { LedgerQueryDto } from './dto/ledger-query.dto';
import { EconomyService } from './economy.service';

/**
 * 玩家端钱包（只读）。发放/扣减没有独立接口——一律由各玩法接口
 *（离线领取、赛跑结算、购买、兑换…）在自己的业务语义里调 `EconomyService.apply`，
 * 避免出现「可以凭空加币」的通用写接口。
 */
@Controller('wallet')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class EconomyController {
  constructor(private readonly economy: EconomyService) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    return { wallet: await this.economy.getWallet(user.userId) };
  }

  @Get('ledger')
  listLedger(@CurrentUser() user: AuthUser, @Query() q: LedgerQueryDto) {
    return this.economy.listLedger(user.userId, {
      page: q.page,
      pageSize: q.pageSize,
      pool: q.pool,
    });
  }
}
