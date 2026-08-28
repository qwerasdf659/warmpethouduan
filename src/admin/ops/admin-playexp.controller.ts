import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { AdminPlayExpService } from './admin-playexp.service';
import { QueryRaceRecordsDto } from './dto/gameplay-query.dto';

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

  /** 赛跑记录。status=pending 即「跑完未结算」的掉单清单。 */
  @Get('race/records')
  @RequirePermissions('race:read')
  raceRecords(@Query() q: QueryRaceRecordsDto) {
    return this.svc.raceRecordList(q);
  }
}
