import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUser } from '../entities/admin-user.entity';
import { AdminRole } from '../entities/admin-role.entity';
import { AdminPermission } from '../entities/admin-permission.entity';
import { AdminMenu } from '../entities/admin-menu.entity';
import { AdminAuditLog } from '../entities/admin-audit-log.entity';
import { AdminSetting } from '../entities/admin-setting.entity';
import { User } from '../entities/user.entity';
import { Pet } from '../entities/pet.entity';
import { RedeemOrder } from '../entities/redeem-order.entity';
import { AssetDef } from '../entities/asset-def.entity';
import { PromoCode } from '../entities/promo-code.entity';
import { PromoRedemption } from '../entities/promo-redemption.entity';
import { GameConfig } from '../entities/game-config.entity';
import { GameEvent } from '../entities/game-event.entity';
import { EventProgress } from '../entities/event-progress.entity';
import { PetEgg } from '../entities/pet-egg.entity';
import { PvpRank } from '../entities/pvp-rank.entity';
import { PvpMatch } from '../entities/pvp-match.entity';
import { Clinic } from '../entities/clinic.entity';
import { ClinicCase } from '../entities/clinic-case.entity';
import { MinigameSession } from '../entities/minigame-session.entity';
import { PetModule } from '../pet/pet.module';
import { EconomyModule } from '../economy/economy.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ItemsModule } from '../items/items.module';
import { MarketModule } from '../market/market.module';
import { TradingModule } from '../trading/trading.module';
import { AdminPlayersService } from './ops/admin-players.service';
import { AdminPlayersController } from './ops/admin-players.controller';
import { AdminIdempotencyService } from './ops/admin-idempotency.service';
import { AdminIdempotencyController } from './ops/admin-idempotency.controller';
import { AdminWalletService } from './ops/admin-wallet.service';
import { AdminWalletController } from './ops/admin-wallet.controller';
import { AdminStatsService } from './ops/admin-stats.service';
import { AdminStatsController } from './ops/admin-stats.controller';
import { AdminConfigService } from './ops/admin-config.service';
import { AdminConfigController } from './ops/admin-config.controller';
import { AdminThemeService } from './ops/admin-theme.service';
import { AdminThemeController } from './ops/admin-theme.controller';
import { AdminItemsService } from './ops/admin-items.service';
import { AdminItemsController } from './ops/admin-items.controller';
import { AdminMarketService } from './ops/admin-market.service';
import { AdminMarketController } from './ops/admin-market.controller';
import { AdminPromoService } from './ops/admin-promo.service';
import { AdminPromoController } from './ops/admin-promo.controller';
import { AdminExchangeService } from './ops/admin-exchange.service';
import { AdminExchangeController } from './ops/admin-exchange.controller';
import { AdminAuthController } from './auth/admin-auth.controller';
import { AdminAuthService } from './auth/admin-auth.service';
import { LoginThrottleService } from './auth/login-throttle.service';
import { AdminAccessService } from './services/admin-access.service';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AdminAuditService } from './audit/admin-audit.service';
import { AdminAuditInterceptor } from './audit/admin-audit.interceptor';
import { AdminAuditController } from './audit/admin-audit.controller';
import { AdminPermissionService } from './rbac/admin-permission.service';
import { AdminPermissionController } from './rbac/admin-permission.controller';
import { AdminRoleService } from './rbac/admin-role.service';
import { AdminRoleController } from './rbac/admin-role.controller';
import { AdminMenuService } from './rbac/admin-menu.service';
import { AdminMenuController } from './rbac/admin-menu.controller';
import { AdminUserService } from './rbac/admin-user.service';
import { AdminUserController } from './rbac/admin-user.controller';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { AdminEventController } from '../event/admin-event.controller';
import { AdminEventService } from '../event/admin-event.service';
import { AdminPlayExpController } from './ops/admin-playexp.controller';
import { AdminPlayExpService } from './ops/admin-playexp.service';

/**
 * 后台管理域（RBAC + 审计）。与玩家端 AuthModule 完全隔离：
 *  - 独立鉴权 /admin/auth/login（typ:'admin' 的 JWT）
 *  - /admin/* 受 AdminJwtAuthGuard + RolesGuard 保护
 *  - 写操作经 AdminAuditInterceptor 落审计
 * LockService/ClockService 来自全局 CommonModule。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AdminUser,
      AdminRole,
      AdminPermission,
      AdminMenu,
      AdminAuditLog,
      AdminSetting,
      User,
      Pet,
      RedeemOrder,
      AssetDef,
      GameConfig,
      PromoCode,
      PromoRedemption,
      GameEvent,
      EventProgress,
      PetEgg,
      PvpRank,
      PvpMatch,
      Clinic,
      ClinicCase,
      MinigameSession,
    ]),
    PetModule,
    // 后台补发装扮/家具走 ItemsService.grant
    ItemsModule,
    EconomyModule,
    LedgerModule,
    MarketModule,
    // AdminMarketService 直接注入 TradeRiskService（净流出风控视图）。
    // MarketModule 虽然 import 了 TradingModule，但只 exports MarketService，
    // 不会把 TradeRiskService 透传出来，这里必须自己 import。
    TradingModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
      }),
    }),
  ],
  controllers: [
    AdminAuthController,
    AdminAuditController,
    AdminPermissionController,
    AdminRoleController,
    AdminMenuController,
    AdminUserController,
    AdminPlayersController,
    AdminIdempotencyController,
    AdminWalletController,
    AdminStatsController,
    AdminConfigController,
    AdminThemeController,
    AdminItemsController,
    AdminMarketController,
    AdminExchangeController,
    AdminPromoController,
    AdminEventController,
    AdminPlayExpController,
  ],
  providers: [
    AdminAuthService,
    LoginThrottleService,
    AdminAccessService,
    AdminAuditService,
    AdminPermissionService,
    AdminRoleService,
    AdminMenuService,
    AdminUserService,
    AdminPlayersService,
    AdminIdempotencyService,
    AdminWalletService,
    AdminStatsService,
    AdminConfigService,
    AdminThemeService,
    AdminItemsService,
    AdminMarketService,
    AdminExchangeService,
    AdminPromoService,
    AdminEventService,
    AdminPlayExpService,
    AdminBootstrapService,
    AdminJwtAuthGuard,
    RolesGuard,
    AdminAuditInterceptor,
  ],
})
export class AdminModule {}
