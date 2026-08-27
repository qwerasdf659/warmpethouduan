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
import { ClinicService } from './clinic.service';
import { DiagnoseDto, UnlockDto } from './dto/clinic.dto';

/**
 * 兽医经营玩家端接口（P7）。
 *
 * 写接口（unlock/diagnose）都挂 `@Idempotent()`：弱网重试是常态，
 * Redis 请求级去重挡秒级重复，持久幂等由服务层的 bizKey / 病例状态兜底。
 * `GET /clinic/case` 是读接口但会建行——有意的例外，见 `ClinicService`。
 */
@Controller('clinic')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class ClinicController {
  constructor(private readonly clinic: ClinicService) {}

  /** 解锁诊所。 */
  @Post('unlock')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  unlock(@CurrentUser() user: AuthUser, @Body() dto: UnlockDto) {
    return this.clinic.unlock(user.userId, dto.bizId);
  }

  /** 领病例（已有未过期病例则返回原例）。 */
  @Get('case')
  getCase(@CurrentUser() user: AuthUser) {
    return this.clinic.getCase(user.userId);
  }

  /** 接诊作答。 */
  @Post('diagnose')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  diagnose(@CurrentUser() user: AuthUser, @Body() dto: DiagnoseDto) {
    return this.clinic.diagnose(
      user.userId,
      dto.caseId,
      dto.optionKey,
      dto.bizId,
    );
  }
}
