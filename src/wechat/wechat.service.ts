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

/**
 * code2Session 的结果。
 *
 * 刻意**不保留 `session_key`**：它是解密微信加密数据（手机号、运动步数等）的钥匙，
 * 而本服务没有任何解密场景。取回来放着不用，等于凭空多一份高价值凭据在内存与日志里
 * 打转。将来真要接加密数据，再连同存储与轮换策略一起设计。
 */
export interface WechatSession {
  openid: string;
  unionid?: string;
}

/** 假登录 code 前缀。只有带此前缀的 code 才会走 mock 分支。 */
const MOCK_CODE_PREFIX = 'mock:';
/** 假身份标识允许的字符与长度（防止拼出奇形怪状的 openid）。 */
const MOCK_TAG_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * 假登录账号的 openid 前缀。
 *
 * 导出而非内联：种子脚本要按它造号、清理脚本要按它圈定删除范围，
 * 三处若各写各的字面量，改动前缀就会漏删测试数据。
 */
export const MOCK_OPENID_PREFIX = 'mock_openid_';

/**
 * 微信小游戏服务端接口封装。
 * 目前只用 jscode2session（用登录 code 换 openid/unionid）。
 */
@Injectable()
export class WechatService {
  private readonly logger = new Logger(WechatService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    if (this.mockEnabled) {
      this.logger.warn(
        `⚠ 微信假登录已开启（WECHAT_MOCK_LOGIN=true，env=${this.config.get<string>('env')}）：` +
          `形如 "${MOCK_CODE_PREFIX}alice" 的 code 将跳过微信校验直接签发 JWT。仅限联调，生产环境禁止开启。`,
      );
    }
  }

  private get mockEnabled(): boolean {
    return this.config.get<boolean>('wechat.mockLogin') === true;
  }

  async code2Session(code: string): Promise<WechatSession> {
    // 假登录只在开关打开、且 code 显式带前缀时生效；
    // 真 code 即便开关开着也照常走微信，便于同一环境混合联调。
    if (code.startsWith(MOCK_CODE_PREFIX)) {
      return this.mockSession(code);
    }

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

    return { openid: data.openid, unionid: data.unionid };
  }

  /**
   * 联调用假会话：`mock:alice` → openid `mock_openid_alice`。
   * 标识相同即映射到同一个玩家，方便反复登录同一账号验证养成进度。
   *
   * 开关未开时**不报「凭证无效」而是明确报开关未开**——否则联调时会误以为是
   * code 写错了，白白排查半天。
   */
  private mockSession(code: string): WechatSession {
    if (!this.mockEnabled) {
      throw new UnauthorizedException(
        '假登录未启用（需 WECHAT_MOCK_LOGIN=true 且非生产环境）',
      );
    }

    const tag = code.slice(MOCK_CODE_PREFIX.length);
    if (!MOCK_TAG_PATTERN.test(tag)) {
      throw new UnauthorizedException(
        `假登录标识非法：需匹配 ${String(MOCK_TAG_PATTERN)}，例如 "${MOCK_CODE_PREFIX}alice"`,
      );
    }

    this.logger.warn(`⚠ 假登录放行：tag=${tag}（未经微信校验）`);
    return { openid: `${MOCK_OPENID_PREFIX}${tag}`, unionid: undefined };
  }
}
