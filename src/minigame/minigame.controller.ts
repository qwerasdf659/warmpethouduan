import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { AuthUser } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlayerStatusGuard } from '../auth/player-status.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { MinigameStartDto, MinigameSettleDto } from './dto/minigame.dto';
import { MinigameService } from './minigame.service';

/**
 * 小游戏赚币玩家端接口（P11）。
 *
 * `start`/`settle` 都是写接口且弱网重试常态，挂 `@Idempotent()`：Redis 请求级去重
 * 挡秒级重复，`minigame_session.biz_id` 与结算凭证 bizKey 兜底持久幂等。
 */
@Controller('minigame')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class MinigameController {
  constructor(private readonly minigame: MinigameService) {}

  /** 小游戏目录。 */
  @Get('list')
  list() {
    return this.minigame.list();
  }

  /** 开局：领取 seed 与有效期。 */
  @Post('start')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  start(@CurrentUser() user: AuthUser, @Body() dto: MinigameStartDto) {
    return this.minigame.start(user.userId, dto.gameKey, dto.bizId);
  }

  /** 结算：提交操作序列，服务端重算分数并发币。 */
  @Post('settle')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  settle(@CurrentUser() user: AuthUser, @Body() dto: MinigameSettleDto) {
    return this.minigame.settle(user.userId, dto.sessionId, dto.actions);
  }
}
