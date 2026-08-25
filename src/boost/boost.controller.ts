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
import {
  AdTokenDto,
  AdVerifyDto,
  SpeedupDto,
  StaminaRecoverDto,
} from './dto/boost.dto';
import { AdTokenService } from './ad-token.service';
import { BoostService } from './boost.service';

/** 激励视频广告奖励 + 增值场景的一次性凭证签发。 */
@Controller('ad')
@UseGuards(JwtAuthGuard)
export class AdController {
  constructor(
    private readonly boost: BoostService,
    private readonly adToken: AdTokenService,
  ) {}

  @Post('verify')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  verify(@CurrentUser() user: AuthUser, @Body() dto: AdVerifyDto) {
    return this.boost.verifyAd(user.userId, dto.bizId);
  }

  /**
   * 领取一次性广告凭证（nonce）。播完激励视频后，把 nonce 作为 `adToken`
   * 传给对应的增值接口（如 `/race/reward/double`、`/race/revive`）核销。
   * 不幂等：每次调用签发一枚新凭证，受该 scene 的每日上限约束。
   */
  @Post('token')
  token(@CurrentUser() user: AuthUser, @Body() dto: AdTokenDto) {
    return this.adToken.issue(user.userId, dto.scene);
  }
}

/** 加速（清冷却）。 */
@Controller('boost')
@UseGuards(JwtAuthGuard)
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
@Controller('stamina')
@UseGuards(JwtAuthGuard)
export class StaminaController {
  constructor(private readonly boost: BoostService) {}

  @Post('recover')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  recover(@CurrentUser() user: AuthUser, @Body() dto: StaminaRecoverDto) {
    return this.boost.recoverStamina(user.userId, dto.bizId, dto.petId);
  }
}
