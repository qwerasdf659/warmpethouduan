import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt-auth.guard';
import {
  CreatePetDto,
  OfflineClaimDto,
  PetActionDto,
  PetStateQueryDto,
  SetActivePetDto,
} from './dto/pet.dto';
import { PetService } from './pet.service';

@Controller('pet')
@UseGuards(JwtAuthGuard)
export class PetController {
  constructor(private readonly pet: PetService) {}

  /** 当前出战宠（或指定 petId）的结算后状态。 */
  @Get('state')
  getState(@CurrentUser() user: AuthUser, @Query() q: PetStateQueryDto) {
    return this.pet.getState(user.userId, q.petId);
  }

  /** 我的宠物列表。 */
  @Get('list')
  list(@CurrentUser() user: AuthUser) {
    return this.pet.list(user.userId);
  }

  /** 离线收益预览。 */
  @Get('offline')
  offline(@CurrentUser() user: AuthUser) {
    return this.pet.offlinePreview(user.userId);
  }

  /** 领取离线收益。 */
  @Post('offline/claim')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  offlineClaim(@CurrentUser() user: AuthUser, @Body() dto: OfflineClaimDto) {
    return this.pet.offlineClaim(user.userId, dto.bizId);
  }

  @Post('create')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePetDto) {
    return this.pet.create(user.userId, dto.nickname, dto.species);
  }

  /** 切换当前出战宠。 */
  @Put('active')
  setActive(@CurrentUser() user: AuthUser, @Body() dto: SetActivePetDto) {
    return this.pet.setActive(user.userId, dto.petId);
  }

  @Post('feed')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  feed(@CurrentUser() user: AuthUser, @Body() dto: PetActionDto) {
    return this.pet.act(user.userId, 'feed', dto.bizId, dto.petId);
  }

  @Post('bath')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  bath(@CurrentUser() user: AuthUser, @Body() dto: PetActionDto) {
    return this.pet.act(user.userId, 'bath', dto.bizId, dto.petId);
  }

  /** 抚摸/梳毛 */
  @Post('pet')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  petAction(@CurrentUser() user: AuthUser, @Body() dto: PetActionDto) {
    return this.pet.act(user.userId, 'pet', dto.bizId, dto.petId);
  }

  @Post('play')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  play(@CurrentUser() user: AuthUser, @Body() dto: PetActionDto) {
    return this.pet.act(user.userId, 'play', dto.bizId, dto.petId);
  }
}
