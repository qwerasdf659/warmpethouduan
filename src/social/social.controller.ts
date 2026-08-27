import {
  Body,
  Controller,
  Get,
  Param,
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
import { LikeDto } from './dto/social.dto';
import { SocialService } from './social.service';

/**
 * 社交展示（P9）。资源标识走路径参数（/home/visit/:userId），与既有风格一致。
 * 注意：本控制器亦挂 @Controller('home')，与 HomeController 路由不冲突。
 */
@Controller('home')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get('visit/:userId')
  visit(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.social.visit(user.userId, userId);
  }

  @Post('like')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  like(@CurrentUser() user: AuthUser, @Body() dto: LikeDto) {
    return this.social.like(user.userId, dto.userId, dto.bizId);
  }
}
