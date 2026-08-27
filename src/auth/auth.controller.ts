import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from './jwt-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService, LoginResult } from './auth.service';
import { AccountAuthDto } from './dto/account-auth.dto';
import { DeviceLoginDto } from './dto/device-login.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 微信小游戏登录：wx.login 拿到的 code 换 JWT。 */
  @Post('login')
  login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.auth.login(dto.code);
  }

  /** 设备登录（匿名/游客）：无微信 code 的平台（Unity 原生/Steam 等）用它取 JWT。 */
  @Post('login/device')
  loginDevice(@Body() dto: DeviceLoginDto): Promise<LoginResult> {
    return this.auth.loginWithDevice(dto.deviceId);
  }

  /** 账号注册：用户名 + 口令，成功即返回 JWT（免二次登录）。 */
  @Post('register/account')
  registerAccount(@Body() dto: AccountAuthDto): Promise<LoginResult> {
    return this.auth.registerAccount(dto.username, dto.password);
  }

  /** 账号登录：用户名 + 口令换 JWT。 */
  @Post('login/account')
  loginAccount(@Body() dto: AccountAuthDto): Promise<LoginResult> {
    return this.auth.loginWithAccount(dto.username, dto.password);
  }

  /**
   * 设备账号绑定：已登录（通常是设备登录）状态下设置用户名 + 口令，
   * 使账号可跨设备找回。需带 Bearer 令牌；玩家 id 不变，不迁移任何数据。
   */
  @Post('bind/account')
  @UseGuards(JwtAuthGuard)
  bindAccount(
    @CurrentUser() user: AuthUser,
    @Body() dto: AccountAuthDto,
  ): Promise<LoginResult> {
    return this.auth.bindAccount(user.userId, dto.username, dto.password);
  }
}
