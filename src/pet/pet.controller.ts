import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt-auth.guard';
import { FeedDto } from './dto/feed.dto';
import { PetService } from './pet.service';

@Controller('pet')
@UseGuards(JwtAuthGuard)
export class PetController {
  constructor(private readonly pet: PetService) {}

  @Get('state')
  getState(@CurrentUser() user: AuthUser) {
    return this.pet.getState(user.userId);
  }

  @Post('feed')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  feed(@CurrentUser() user: AuthUser, @Body() _dto: FeedDto) {
    return this.pet.feed(user.userId);
  }
}
