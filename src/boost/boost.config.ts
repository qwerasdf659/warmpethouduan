/**
 * 广告 / 加速 / 体力恢复的可调数值。
 */

/** 激励视频广告奖励：每次固定发币，账号级每日次数上限。 */
export const AD_REWARD = {
  coin: 30,
  dailyCap: 5,
} as const;

/** 体力恢复：付费恢复满体力的游戏币花费。 */
export const STAMINA_RECOVER = {
  cost: 50,
} as const;

/** 加速：清除某宠全部互动冷却的游戏币花费。 */
export const SPEEDUP = {
  cost: 20,
} as const;

/**
 * 「看广告换增值」的一次性凭证（nonce）。玩法侧不直接信任客户端说「我看过广告了」，
 * 而是先领一枚 scene 绑定的短时效 nonce，用掉即失效。
 *
 * 注：微信激励视频无标准服务端回调票据，nonce 只能防「同一次广告重复兑换」与
 * 「凭空调用增值接口」，挡不住刻意刷量；接入第三方 SSP 回调后应在签发处校验签名。
 */
export const AD_TOKEN = {
  /** 凭证有效期：够放完一支激励视频 + 结算往返 */
  ttlSec: 300,
  /** 每个 scene 的账号级每日签发上限（防刷） */
  dailyCapPerScene: 10,
} as const;

/** 允许领取广告凭证的业务场景。 */
export const AD_SCENES = ['race_double', 'race_revive'] as const;
export type AdScene = (typeof AD_SCENES)[number];
