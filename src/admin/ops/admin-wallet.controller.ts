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
  QueryLedgerDto,
} from './dto/wallet-admin.dto';

/**
 * 后台钱包与流水：全局流水（wallet:read）+ 人工发币/扣币（wallet:write）。
 * 发币/扣币带 bizId 幂等（IdempotencyInterceptor）并落审计（@Audit）。
 */
@Controller('admin')
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

  @Get('players/:id/wallet')
  @RequirePermissions('wallet:read')
  getWallet(@Param('id') id: string) {
    return this.service.getWallet(id);
  }

  /**
   * 立即对账：校验 `wallet == sum(ledger.delta)`。与每日定时作业同一份逻辑，
   * 只读不写 —— 发现不平只报告，不自动纠账（自动纠账会把证据一起改掉）。
   */
  @Get('reconcile')
  @RequirePermissions('wallet:read')
  reconcile() {
    return this.reconcileService.run();
  }

  @Post('players/:id/wallet/grant')
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
  @Post('wallet/grant-bulk')
  @RequirePermissions('wallet:write')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  @Audit('批量发币/扣币', 'wallet')
  grantBulk(@Body() dto: GrantWalletBulkDto) {
    return this.service.grantBulk(dto);
  }
}
