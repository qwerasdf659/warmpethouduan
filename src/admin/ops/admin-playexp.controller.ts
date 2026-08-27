import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { AdminPlayExpService } from './admin-playexp.service';

/** 玩法扩展后台只读查询（P3/P4/P7/P11）。 */
@Controller('admin')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AdminPlayExpController {
  constructor(private readonly svc: AdminPlayExpService) {}

  @Get('breed/eggs')
  @RequirePermissions('pet:read')
  eggs(@Query() q: PaginationDto) {
    return this.svc.eggList({ page: q.page ?? 1, pageSize: q.pageSize ?? 20 });
  }

  @Get('pvp/rank')
  @RequirePermissions('pvp:read')
  pvpRank(@Query() q: PaginationDto) {
    return this.svc.pvpRankList({
      page: q.page ?? 1,
      pageSize: q.pageSize ?? 20,
    });
  }

  @Get('pvp/matches')
  @RequirePermissions('pvp:read')
  pvpMatches(@Query() q: PaginationDto) {
    return this.svc.pvpMatchList({
      page: q.page ?? 1,
      pageSize: q.pageSize ?? 20,
    });
  }

  @Get('clinic')
  @RequirePermissions('clinic:read')
  clinic(@Query() q: PaginationDto) {
    return this.svc.clinicList({
      page: q.page ?? 1,
      pageSize: q.pageSize ?? 20,
    });
  }

  @Get('clinic/cases')
  @RequirePermissions('clinic:read')
  clinicCases(@Query() q: PaginationDto) {
    return this.svc.clinicCaseList({
      page: q.page ?? 1,
      pageSize: q.pageSize ?? 20,
    });
  }

  @Get('minigame/sessions')
  @RequirePermissions('minigame:read')
  minigameSessions(@Query() q: PaginationDto) {
    return this.svc.minigameSessionList({
      page: q.page ?? 1,
      pageSize: q.pageSize ?? 20,
    });
  }
}
