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
  menus: MenuNode[];
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
}

export interface LedgerEntry {
  id: string;
  userId: string;
  pool: 'game' | 'marketing';
  delta: number;
  balanceAfter: number;
  bizId: string;
  reason: string;
  refId: string | null;
  createdAt: string;
}

export interface StatsOverview {
  players: { total: number; banned: number; newToday: number; dauToday: number };
  pets: { total: number };
  wallet: { gameCoinTotal: number; marketingPointTotal: number };
  exchange: { pendingOrders: number };
}

export interface TrendPoint {
  day: string;
  newUsers: number;
  coinIssued: number;
}

export interface ItemDefView {
  id: string;
  key: string;
  type: 'skin' | 'accessory' | 'furniture';
  name: string;
  slot: string | null;
  price: number;
  pool: 'game' | 'marketing';
  comfort: number;
  meta: Record<string, unknown>;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface GameConfigView {
  id: string;
  key: string;
  description: string;
  value: unknown;
  createdAt: string;
  updatedAt: string;
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
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}
