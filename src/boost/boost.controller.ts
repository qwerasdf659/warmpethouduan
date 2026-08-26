import {
  Body,
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt-auth.guard';
import { PlayerStatusGuard } from '../auth/player-status.guard';
import {
  AdTokenDto,
  AdVerifyDto,
  SpeedupDto,
  StaminaRecoverDto,
} from './dto/boost.dto';
import { AdTokenService } from './ad-token.service';
import { BoostService } from './boost.service';

/**
 * 激励视频广告奖励 + 增值场景的一次性凭证签发。
 *
 * 本模块统一挂在 `boost/` 下（曾经散成 `/ad`、`/boost`、`/stamina` 三个顶级前缀，
 * 同一个 BoostService 却要在三处找入口）。一个模块一个前缀，与 pet/race/home 一致。
 */
@Controller('boost/ad')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class AdController {
  constructor(
    private readonly boost: BoostService,
    private readonly adToken: AdTokenService,
  ) {}

  /**
   * 广告奖励发放。需先 `POST /boost/ad/token`（scene=ad_reward）领凭证，
   * 播完广告后带 `adToken` 来核销 —— 与赛跑增值接口同一套风控。
   */
  @Post('verify')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  verify(@CurrentUser() user: AuthUser, @Body() dto: AdVerifyDto) {
    return this.boost.verifyAd(user.userId, dto.bizId, dto.adToken);
  }

  /**
   * 领取一次性广告凭证（nonce）。播完激励视频后，把 nonce 作为 `adToken`
   * 传给对应的接口核销（`/boost/ad/verify`、`/race/reward/double`、`/race/revive`）。
   * 不幂等：每次调用签发一枚新凭证，受该 scene 的每日上限约束。
   */
  @Post('token')
  token(@CurrentUser() user: AuthUser, @Body() dto: AdTokenDto) {
    return this.adToken.issue(user.userId, dto.scene);
  }
}

/** 加速（清冷却）。 */
@Controller('boost')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class BoostController {
  constructor(private readonly boost: BoostService) {}

  @Post('speedup')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  speedup(@CurrentUser() user: AuthUser, @Body() dto: SpeedupDto) {
    return this.boost.speedup(user.userId, dto.bizId, dto.petId);
  }
}

/** 体力恢复。 */
@Controller('boost/stamina')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class StaminaController {
  constructor(private readonly boost: BoostService) {}

  @Post('recover')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  recover(@CurrentUser() user: AuthUser, @Body() dto: StaminaRecoverDto) {
    return this.boost.recoverStamina(user.userId, dto.bizId, dto.petId);
  }
}
