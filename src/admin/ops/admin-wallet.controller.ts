import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ReconcileService } from '../../economy/reconcile.service';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { AdminAuditInterceptor } from '../audit/admin-audit.interceptor';
import { Audit } from '../decorators/audit.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { AdminWalletService } from './admin-wallet.service';
import {
  GrantWalletBulkDto,
  GrantWalletDto,
  QueryDailyStatsDto,
  QueryLedgerDto,
  ReverseTxnDto,
} from './dto/wallet-admin.dto';

/**
 * 后台钱包与流水：全局流水（wallet:read）+ 人工发币/扣币（wallet:write）。
 * 发币/扣币带 bizId 幂等（IdempotencyInterceptor）并落审计（@Audit）。
 *
 * 前缀必须是 `admin/wallet` 而不是裸 `admin`：后者会和 AdminPlayersController
 * （`admin/players`）共享路径空间，`/admin/players/:id/...` 由谁接管取决于模块
 * 注册顺序 —— 那是靠运气而不是靠设计。
 */
@Controller('admin/wallet')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminWalletController {
  constructor(
    private readonly service: AdminWalletService,
    private readonly reconcileService: ReconcileService,
  ) {}

  @Get('ledger')
  @RequirePermissions('wallet:read')
  listLedger(@Query() q: QueryLedgerDto) {
    return this.service.listLedger(q);
  }

  @Get('players/:id')
  @RequirePermissions('wallet:read')
  getWallet(@Param('id') id: string) {
    return this.service.getWallet(id);
  }

  /**
   * 立即对账：逐条校验账本的 11 项不变量。与每日定时作业同一份逻辑，
   * 只读不写 —— 发现不平只报告，不自动纠账（自动纠账会把证据一起改掉）。
   */
  @Get('reconcile')
  @RequirePermissions('wallet:read')
  reconcile() {
    return this.reconcileService.run();
  }

  /**
   * 发行/销毁日报（通胀监控 + 刷币告警 + 待兑付负债）。
   *
   * 读的是每日对账物化出来的 `asset_daily_stat`，不实时扫分录 ——
   * 发行与销毁是单边不守恒的两个口径，实时求和给不出财务要的那两个数。
   */
  @Get('daily-stats')
  @RequirePermissions('wallet:read')
  dailyStats(@Query() q: QueryDailyStatsDto) {
    return this.service.dailyStats(q);
  }

  /**
   * 冲正凭证（R7：争议处理 / 盗号追回）。
   *
   * 权限归 `wallet:write`：冲正会真实改变余额，与人工发币同一风险等级。
   * 走 `@Audit` 落痕 —— 资金修复操作必须能回答「谁在什么时候改了什么」。
   */
  @Post('txns/:txnId/reverse')
  @RequirePermissions('wallet:write')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  @Audit('冲正凭证', 'asset_txn')
  reverseTxn(@Param('txnId') txnId: string, @Body() dto: ReverseTxnDto) {
    return this.service.reverseTxn(txnId, dto);
  }

  @Post('players/:id/grant')
  @RequirePermissions('wallet:write')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  @Audit('人工发币/扣币', 'wallet')
  grant(@Param('id') id: string, @Body() dto: GrantWalletDto) {
    return this.service.grant(id, dto);
  }

  /**
   * 批量发币/扣币。返回 `{ total, succeeded, failed[] }`——
   * 部分失败仍返回 200，运营看 `failed` 决定补发，不用整批重来。
   */
  @Post('grant-bulk')
  @RequirePermissions('wallet:write')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  @Audit('批量发币/扣币', 'wallet')
  grantBulk(@Body() dto: GrantWalletBulkDto) {
    return this.service.grantBulk(dto);
  }
}
