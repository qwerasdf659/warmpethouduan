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
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { AdminAuditInterceptor } from '../audit/admin-audit.interceptor';
import { Audit } from '../decorators/audit.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { AdminWalletService } from './admin-wallet.service';
import { GrantWalletDto, QueryLedgerDto } from './dto/wallet-admin.dto';

/**
 * 后台钱包与流水：全局流水（wallet:read）+ 人工发币/扣币（wallet:write）。
 * 发币/扣币带 bizId 幂等（IdempotencyInterceptor）并落审计（@Audit）。
 */
@Controller('admin')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminWalletController {
  constructor(private readonly service: AdminWalletService) {}

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

  @Post('players/:id/wallet/grant')
  @RequirePermissions('wallet:write')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  @Audit('人工发币/扣币', 'wallet')
  grant(@Param('id') id: string, @Body() dto: GrantWalletDto) {
    return this.service.grant(id, dto);
  }
}
