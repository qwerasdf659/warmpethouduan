/** 与后端返回结构对齐（camelCase、id 为 string），不做映射。 */

export interface AdminProfileMenu {
  id: string;
  parentId: string | null;
  name: string;
  type: 'catalog' | 'menu' | 'button';
  path: string | null;
  component: string | null;
  icon: string | null;
  permissionCode: string | null;
  sortOrder: number;
  visible: boolean;
}

export interface AdminProfile {
  id: string;
  username: string;
  displayName: string | null;
  roles: string[];
  permissions: string[];
  menus: AdminProfileMenu[];
}

export interface LoginResult {
  token: string;
  profile: AdminProfile;
}

export interface Permission {
  id: string;
  code: string;
  name: string;
  group: string | null;
  createdAt: string;
}

export interface MenuNode {
  id: string;
  parentId: string | null;
  name: string;
  type: 'catalog' | 'menu' | 'button';
  path: string | null;
  component: string | null;
  icon: string | null;
  permissionCode: string | null;
  sortOrder: number;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Permission[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserRoleBrief {
  id: string;
  code: string;
  name: string;
}

export interface AdminUserView {
  id: string;
  username: string;
  displayName: string | null;
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  roles: AdminUserRoleBrief[];
  createdAt: string;
  updatedAt: string;
}

export interface PlayerView {
  id: string;
  openid: string;
  unionid: string | null;
  status: 'active' | 'banned';
  bannedReason: string | null;
  bannedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PetStateView {
  id: string;
  nickname: string | null;
  species: string;
  isActive: boolean;
  hunger: number;
  cleanliness: number;
  mood: number;
  stamina: number;
  staminaMax: number;
  intimacy: number;
  level: number;
  exp: number;
  expIntoLevel: number;
  expToNext: number;
  stage: string;
  speed: number;
  endurance: number;
  lastSeenAt: string;
}

export interface PlayerDetail {
  player: PlayerView;
  pets: PetStateView[];
}

export interface AuditLog {
  id: string;
  adminUserId: string | null;
  adminUsername: string | null;
  action: string | null;
  method: string;
  path: string;
  targetType: string | null;
  targetId: string | null;
  bizId: string | null;
  ip: string | null;
  userAgent: string | null;
  requestBody: unknown;
  statusCode: number;
  success: boolean;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface Paged<T> {
  list: T[];
  total: number;
}

export interface WalletView {
  gameCoin: number;
  marketingPoint: number;
  /** 挂单/出价冻结中的部分：有余额不等于能花 */
  gameCoinFrozen: number;
  marketingPointFrozen: number;
}

/** 一条不变量的校验结果。`count = -1` 表示该条 SQL 本身执行失败。 */
export interface InvariantResult {
  /** 编号与架构设计 §2.1 一一对应 */
  id: number;
  name: string;
  ok: boolean;
  count: number;
  samples: Record<string, unknown>[];
}

/** 可兑资产的待兑付负债（财务口径）。 */
export interface LiabilityReport {
  assetCode: string;
  issued: number;
  burned: number;
  outstanding: number;
}

/**
 * 对账报告：账本 11 项不变量的校验结果。
 *
 * 结构随账本重构整体换过一次 —— 旧版是「钱包余额 vs 流水累计」单一维度
 * （`mismatches`/`negatives`/`orphanLedgerUsers`），现在是逐条不变量。
 */
export interface ReconcileReport {
  checkedAt: string;
  accountCount: number;
  invariants: InvariantResult[];
  liabilities: LiabilityReport[];
  statRowsMaterialized: number;
  ok: boolean;
}

/** 幂等记录（Redis 里的 idem:{userId}:{bizId}）。 */
export interface IdempotencyRecord {
  key: string;
  userId: string;
  bizId: string;
  status: 'pending' | 'done';
  ttlSec: number;
  result: unknown;
}

export interface LedgerEntry {
  id: string;
  /** 所属凭证 id。冲正按凭证做（一张凭证可能有多条分录），不是按分录 */
  txnId: string;
  userId: string;
  /**
   * 资产 code。流水里不止两种货币 —— 道具与消耗品的变动也有分录，
   * 所以展示要按 code，不能只看 `pool`（`cons_snack +3` 会显示成「游戏币 +3」）。
   */
  assetCode: string;
  /** 仅对两种货币有意义；道具类一律落 `game` */
  pool: 'game' | 'marketing';
  delta: number;
  balanceAfter: number;
  bizId: string;
  reason: string;
  refId: string | null;
  createdAt: string;
}

export interface StatsOverview {
  players: {
    total: number;
    banned: number;
    newToday: number;
    dauToday: number;
  };
  pets: { total: number };
  wallet: { gameCoinTotal: number; marketingPointTotal: number };
  exchange: { pendingOrders: number };
}

export interface TrendPoint {
  day: string;
  newUsers: number;
  coinIssued: number;
}

/**
 * 资产定义（`asset_def`）。
 *
 * 主键是 `code` 而不是自增 id —— 行式统一账本里「加一种资产」是插一行，
 * 自增 id 已不存在，增删改一律按 code 定位。
 */
export interface ItemDefView {
  code: string;
  /** 账本层的资产种类：unique 有身份可编号，stackable 只有数量 */
  kind: 'currency' | 'stackable' | 'unique';
  type: 'skin' | 'accessory' | 'furniture' | 'consumable' | null;
  name: string;
  slot: string | null;
  price: number;
  pool: 'game' | 'marketing';
  comfort: number;
  /** 以下三个合规开关**只读**：改动需走数据库迁移，见后端 AdminItemsService */
  tradable: boolean;
  redeemable: boolean;
  gachaOutput: boolean;
  /** 限量总量（null = 不限量）。只能上调，不能低于 mintedCount */
  mintLimit: number | null;
  mintedCount: number;
  meta: Record<string, unknown>;
  enabled: boolean;
  sortOrder: number;
}

export interface GameConfigView {
  key: string;
  description: string;
  value: unknown;
  updatedAt: string;
  /** 是否为代码注册过的可调项。false = 历史遗留 key，玩法不读它 */
  registered: boolean;
  /** 代码内置默认值（未注册项为 null） */
  default: unknown;
  /** 当前值是否已偏离默认值 */
  modified: boolean;
}

export interface RedeemOrderView {
  id: string;
  userId: string;
  exchangeKey: string;
  itemName: string;
  itemType: 'physical' | 'virtual';
  cost: number;
  pool: 'game' | 'marketing';
  status: 'pending' | 'shipped' | 'cancelled';
  bizId: string;
  address: {
    receiver: string;
    phone: string;
    region: string;
    detail: string;
  } | null;
  trackingNo: string | null;
  /** 发货时间（独立落列，不受改备注/补单号影响） */
  shippedAt: string | null;
  /** 取消退款时间 */
  cancelledAt: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------------------ 兑换码

export interface PromoCodeView {
  id: string;
  code: string;
  batch: string;
  pool: 'game' | 'marketing';
  amount: number;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  enabled: boolean;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 批次汇总。`usedUses`（占用次数）与 `redemptions`（核销行数）分开列：
 * 两者正常应相等，不等说明有「占了次数但入账失败」的记录，需要人工看一眼。
 */
export interface PromoBatchSummary {
  batch: string;
  pool: string;
  codes: number;
  totalUses: number;
  usedUses: number;
  redemptions: number;
  enabledCodes: number;
  createdAt: string;
}

export interface PromoRedemptionView {
  id: string;
  userId: string;
  code: string;
  batch: string;
  pool: 'game' | 'marketing';
  amount: number;
  createdAt: string;
}
