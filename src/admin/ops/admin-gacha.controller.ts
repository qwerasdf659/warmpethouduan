import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { AdminGachaService } from './admin-gacha.service';
import {
  QueryGachaDrawsDto,
  QueryGachaStatesDto,
} from './dto/gameplay-query.dto';

/** 扭蛋后台只读查询：抽取记录与保底进度。无写操作，故不落审计。 */
@Controller('admin/gacha')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AdminGachaController {
  constructor(private readonly svc: AdminGachaService) {}

  @Get('draws')
  @RequirePermissions('gacha:read')
  draws(@Query() q: QueryGachaDrawsDto) {
    return this.svc.drawList(q);
  }

  @Get('states')
  @RequirePermissions('gacha:read')
  states(@Query() q: QueryGachaStatesDto) {
    return this.svc.stateList(q);
  }
}
