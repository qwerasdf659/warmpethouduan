import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

interface Jscode2SessionResponse {
  openid?: string;
  unionid?: string;
  session_key?: string;
  errcode?: number;
  errmsg?: string;
}

export interface WechatSession {
  openid: string;
  unionid?: string;
  sessionKey: string;
}

/**
 * 微信小游戏服务端接口封装。
 * M1 只用 jscode2session（用登录 code 换 openid/unionid）。
 */
@Injectable()
export class WechatService {
  private readonly logger = new Logger(WechatService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async code2Session(code: string): Promise<WechatSession> {
    const appid = this.config.get<string>('wechat.appid');
    const secret = this.config.get<string>('wechat.secret');

    const { data } = await firstValueFrom(
      this.http.get<Jscode2SessionResponse>(
        'https://api.weixin.qq.com/sns/jscode2session',
        {
          params: {
            appid,
            secret,
            js_code: code,
            grant_type: 'authorization_code',
          },
        },
      ),
    );

    if (data.errcode || !data.openid) {
      // 只记录 errcode/errmsg，不打印任何密钥
      this.logger.warn(
        `jscode2session 失败: code=${data.errcode} msg=${data.errmsg}`,
      );
      throw new UnauthorizedException(
        `微信登录失败：${data.errmsg ?? '未知错误'}`,
      );
    }

    return {
      openid: data.openid,
      unionid: data.unionid,
      sessionKey: data.session_key ?? '',
    };
  }
}
