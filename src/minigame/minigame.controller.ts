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
import {
  MinigameFlipDto,
  MinigameSettleDto,
  MinigameStartDto,
} from './dto/minigame.dto';
import { MinigameService } from './minigame.service';

/**
 * 小游戏赚币玩家端接口（P11）：记忆翻牌。
 *
 * `start`/`settle` 都是写接口且弱网重试常态，挂 `@Idempotent()`：Redis 请求级去重
 * 挡秒级重复，`minigame_session.biz_id` 与结算凭证 bizKey 兜底持久幂等。
 *
 * `flip` **刻意不挂 `@Idempotent()`**：它每次都要改对局状态，且玩家会在一局里
 * 连续翻十几次。挂上就得每次翻牌都自带 bizId，而重放一次 flip 的语义本身是
 * 「再翻一张」而不是「重复上一张」——真正需要防的重复提交由玩家锁串行化兜住。
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

  /** 翻一张牌：服务端揭示花色并推进对局。 */
  @Post('flip')
  flip(@CurrentUser() user: AuthUser, @Body() dto: MinigameFlipDto) {
    return this.minigame.flip(user.userId, dto.sessionId, dto.index);
  }

  /** 结算：按服务端记录的对局进度算分并发币。 */
  @Post('settle')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  settle(@CurrentUser() user: AuthUser, @Body() dto: MinigameSettleDto) {
    return this.minigame.settle(user.userId, dto.sessionId);
  }
}
