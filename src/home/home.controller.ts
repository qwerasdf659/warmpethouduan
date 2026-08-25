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
import {
  HomeBuyDto,
  PlaceFurnitureDto,
  RemoveFurnitureDto,
} from './dto/home.dto';
import { HomeService } from './home.service';

@Controller('home')
@UseGuards(JwtAuthGuard)
export class HomeController {
  constructor(private readonly home: HomeService) {}

  /** 家园：家具商店 + 拥有/摆放 + 舒适度。 */
  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.home.getHome(user.userId);
  }

  @Post('buy')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  buy(@CurrentUser() user: AuthUser, @Body() dto: HomeBuyDto) {
    return this.home.buy(user.userId, dto.itemKey, dto.bizId);
  }

  @Post('place')
  place(@CurrentUser() user: AuthUser, @Body() dto: PlaceFurnitureDto) {
    return this.home.place(user.userId, dto.itemKey, dto.posX, dto.posY);
  }

  @Post('remove')
  remove(@CurrentUser() user: AuthUser, @Body() dto: RemoveFurnitureDto) {
    return this.home.remove(user.userId, dto.layoutId);
  }
}
