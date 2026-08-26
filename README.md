# warmpet-api

微信小游戏「宠物养成」后端。基于 **NestJS 11 + TypeScript 5 + PostgreSQL 16 + Redis 7 + TypeORM**，运行于 Sealos DevBox（`/home/devbox/project`）。

## 技术栈

| 领域             | 选型                                                                       |
| ---------------- | -------------------------------------------------------------------------- |
| 框架             | NestJS 11 + TypeScript 5 + Node.js 22                                      |
| 持久层           | PostgreSQL 16（Sealos 托管）+ TypeORM（`synchronize:false`，**只走迁移**） |
| 缓存 / 锁 / 幂等 | Redis 7（DevBox 本机，PM2 守护 + AOF）+ ioredis，统一 `REDIS_URL`          |
| 鉴权             | `@nestjs/jwt`（玩家 JWT + 后台 RBAC）                                      |
| 配置             | `@nestjs/config` + Joi 校验                                                |
| 运营后台         | Ant Design Pro（`admin-web/`，构建产物挂载于 `/console`）                  |

## 架构铁律

1. **服务端权威**：时间 / 收益 / 衰减一律用 `ClockService`，禁用客户端上报的时间与数值。
2. **幂等**：写接口带 `bizId`，资产变动叠加 `asset_txn.biz_id` 全局唯一索引做持久去重（Redis 结果缓存只兜 24h）。前缀由 `LedgerService` 强制拼接，调用方绕不过去 —— 少了前缀，两个玩家提交同一个客户端 UUID 会互相把对方的操作「幂等回放」掉。
3. **并发安全**：同一玩家的写操作用 `LockService.withLock('pet:'+userId, ...)` 串行化；记账靠单语句原子 `UPDATE … WHERE available + delta >= 0`，不加 Redis 锁（避免与宠物域锁自死锁）。多账户凭证在同一事务内按 `account_id` 升序更新，杜绝交易双方互等的死锁。
4. **软失败不死亡**：非关键依赖失败降级，不阻断主链路。
5. **资产只有一个写入口**：`LedgerService`。业务代码不得直接改 `asset_balance` / `asset_lot` / `item_instance` —— 那些路径没有分录、没有幂等、没有批次分摊，而对账的 11 项不变量正是校验这三层一致。
6. **合规红线固化在库层**：`tradable AND redeemable`、`tradable AND gacha_output` 由 DB CHECK 禁止，后台改不了。放开需要显式迁移 + 在架构文档追加决策记录。

## 功能模块

| 模块     | 目录           | 说明                                                                                         |
| -------- | -------------- | -------------------------------------------------------------------------------------------- |
| 鉴权     | `src/auth`     | 微信 `code2Session` 登录 → 自签 JWT                                                          |
| 宠物     | `src/pet`      | 四动作照顾（feed/bath/pet/play）+ 惰性衰减结算 + 成长 + 多宠 + 离线收益                      |
| **账本** | `src/ledger`   | 行式统一账本：货币 / 可堆叠道具 / 唯一实例同一套凭证与分录。唯一写入口 `LedgerService`，产出出口 `RewardService` |
| 经济     | `src/economy`  | 货币视角门面（`WalletView` 出参形状）+ 每日对账 11 项不变量                                  |
| **市场** | `src/market`   | 玩家间交易四档：系统回收 / 定向赠送 / 一价寄售 / 自由竞价，含风控 R1~R10                     |
| 每日     | `src/daily`    | 签到（连签奖励）+ 每日任务领奖                                                               |
| 赛跑     | `src/race`     | 赛道 + 服务端权威结算（三围 speed/stamina/endurance）+ 名次奖励                              |
| 换装     | `src/items`    | 目录 / 拥有 / 穿戴，购买扣币                                                                 |
| 家园     | `src/home`     | 家具布局 + 舒适度 `comfortFactor` 回流心情衰减                                               |
| 图鉴     | `src/dex`      | 点亮 + 系列集齐奖励                                                                          |
| 变现     | `src/boost`    | 激励广告核销 / 加速 / 体力恢复                                                               |
| 兑换履约 | `src/exchange` | 虚拟 + 实物兑换、收货地址、兑换订单                                                          |
| 运营后台 | `src/admin`    | RBAC + 审计 + 玩家管理 + 全局流水 + 人工发币 + 数据看板 + 配置中心 + `asset_def` CRUD + 兑换管理 |

### 账本模型速查

| 资产种类    | 举例                | 持有形态                              | 可否交易       |
| ----------- | ------------------- | ------------------------------------- | -------------- |
| `currency`  | 游戏币 / 营销积分   | `asset_balance` + `asset_lot`（批次） | 币可，积分不可 |
| `stackable` | 家具 / 消耗品       | `asset_balance` + `asset_lot`         | 视 `tradable`  |
| `unique`    | 皮肤 / 配饰 / 限量款 | `item_instance`（有身份、可编号）     | 视 `tradable`  |

- **凭证** `asset_txn` 是幂等唯一权威；**分录** `asset_entry` 按月分区、只追加、永不物理删除（归档只允许 `DETACH PARTITION` + 转储，保留回档能力）。
- `issue` / `burn` 单边不要求平衡（发行与销毁本就是凭空产生与消失）；`transfer` 按资产求和必须为 0；`freeze` 在可用与冻结之间守恒。
- 交易市场默认**全关**（`market.enabled` + 四个分档开关），需在后台逐档打开。

详见 `docs/账本与交易系统架构设计.md`。

## 目录约定

- `src/entities/*.entity.ts`：所有实体（CLI DataSource 用 glob 登记，**新增实体禁止只登记到 `app.module.ts`**，否则 `migration:generate` 会把该表当「多余表」生成 `DROP TABLE`）。
- `src/migrations/*.ts`：迁移文件（`Baseline` + `LedgerRefactor` + `GachaRemoveCoinPayout` 三条）。
- `src/common`：基础设施三件套（`ClockService` / `LockService` / `IdempotencyInterceptor`，全局）。
- `scripts/dev/*.ts`：联调数据工具（播种 / 清理 / 清档 / 体检 / 冒烟），用 `ts-node -T -P scripts/tsconfig.json` 跑。
- `admin-web/`：运营后台前端（独立 pnpm 工程，`pnpm build` 产物挂 `/console`）。
- `docs/`：项目文档（宠物功能详细规格 / 账本与交易系统架构设计 / 待办执行清单 / 安全与运维加固清单）。

## 环境变量

密钥只存放于 `.env` / `secrets/`（已 `.gitignore`，**绝不提交**）。新增密钥请同步更新 `.env.example`（仅占位）。关键项：

- `PORT`（默认 8080，对齐 DevBox 暴露端口）
- `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME`
- `REDIS_URL`
- `JWT_SECRET` / `JWT_EXPIRES_IN`
- `WECHAT_APPID` / `WECHAT_SECRET`
- `WECHAT_MOCK_LOGIN`（联调假登录开关，见「联调自测数据」；生产为 `true` 会拒绝启动）

## 常用命令

```bash
# 安装依赖
npm install

# 本地开发（热重载）
npm run start:dev

# 生产构建 / 启动
npm run build
npm run start:prod

# 前端后台构建（产物挂 /console）
npm run build:web

# 迁移：生成 → 执行（禁用 synchronize）
npm run migration:generate -- src/migrations/Xxx
npm run migration:run
npm run migration:revert

# 测试
npm test               # 单元测试（*.spec.ts）
npm run test:e2e       # e2e（连真库，跑完自清）
npm run test:cov       # 覆盖率
npm run verify         # 全量卡口：lint + tsc + 前端 + 单测 + e2e

# 真机冒烟：账本与交易五档 + 11 项对账不变量（连真库真 Redis 真配置中心）
npm run smoke:ledger
npm run smoke:ledger -- --keep   # 保留数据以便人工排查
```

> 迁移生成后**必读一遍 SQL**，确认没有意外的 `DROP`。
>
> 账本表（`asset_entry` 分区、`asset_lot` 的 `NULLS NOT DISTINCT` 唯一索引、
> 多列 CHECK 约束）TypeORM 表达不了，一律**手写 raw SQL 迁移**；实体只映射父表做只读查询。
> 因此改动这几张表后不要指望 `migration:generate` 能生成正确的 diff。

## 联调自测数据

没有微信客户端也能把后端跑通，靠「假登录 + 种子玩家 + 一键清理」三件套。

**开关**：`.env` 设 `WECHAT_MOCK_LOGIN=true`。此后 `POST /auth/login` 传 `{"code":"mock:<tag>"}`
即跳过微信校验直接签发 JWT，openid 固定为 `mock_openid_<tag>`，同一 tag 永远映射同一个玩家。
不带 `mock:` 前缀的真 code 照常走微信，可在同一环境混合联调。

生产环境双重封死：`NODE_ENV=production` 时 Joi 校验直接**拒绝启动**，配置层再把该值强制算作 `false`。

```bash
# 造 3 个不同进度的测试玩家（幂等，可反复跑）
npm run seed:dev
#   mock:newbie   Lv1  空钱包    —— 新手引导 / 首次互动
#   mock:mid      Lv8  5000 币   —— 换装 / 家园 / 赛跑 / 签到
#   mock:veteran  Lv30 5 万币    —— 兑换实物 / 履约 / 图鉴

# 清掉全部假登录玩家及其关联数据
npm run clean:dev              # 预演，只报数
npm run clean:dev -- --yes     # 真删

# 上线前清档：删除全部玩家，保留后台账号与配置表
npm run wipe:pre-launch                  # 预演
npm run wipe:pre-launch -- --execute     # 真删（需手输「确认清档」）
```

三个脚本都在 `NODE_ENV=production` 下直接拒绝运行。清理不写死表名，
运行时从 `pg_constraint` 反查外键依赖递归删除，新增业务表自动纳入范围，不会留孤儿数据。

发币一律走 `EconomyService.apply` 并使用稳定 `bizId`，所以重复播种命中幂等回放，
不会把余额翻倍，也不会造出「有余额无流水」的脏账。

## 部署

**PM2 常驻**（非「打包镜像」）。`ecosystem.config.js` 守护应用进程 + 本机 Redis。应用监听 `8080`，`main.ts` 绑 `0.0.0.0`。健康检查：`GET /health`。

### 后台账号口令

改超管口令用 `npm run admin:passwd`（不带参数则随机生成并打印）。它会**同时**更新数据库
与 `.env` 的 `ADMIN_INIT_PASSWORD`——后者是重建数据库时的播种种子，两边必须一致。

后台界面的「系统管理 → 管理员 → 重置密码」只改数据库，用它改完超管口令后 `.env`
会静默过期，直到某天重建库才发现登不进去。应用启动时会比对两边，不一致打 WARN。
给**其他**管理员改密走界面即可，他们的口令本来就不该记进 `.env`。

## 端口与入口

公网（Sealos DevBox 的 8080 端口，经 Istio 网关 HTTPS 暴露）：

- 运营后台：<https://ocqeeuitbygc.sealosbja.site/console/>（登录页 `/console/login`）
- 健康检查：<https://ocqeeuitbygc.sealosbja.site/health>

域名由平台分配、不写在代码里（`scripts/deploy-admin.sh` 打印的是 `<域名>/console` 占位），
换 DevBox 会变；在 Sealos 控制台该 DevBox 的网络栏可查。

玩家端 API：`/auth`、`/pet`、`/wallet`、`/daily`、`/race`、`/home`、`/dex`、`/gacha`、
`/promo`、`/items/consumables`、`/items/wardrobe`、`/boost`、`/boost/ad`、`/boost/stamina`、
`/exchange`、`/exchange/address`、`/market`

`/market` 下：`listings`（GET 浏览 / POST 挂单）、`my-listings`、`recycle`、`gift`、
`listings/:id/{cancel,buy,bid}`。写接口在 `market.enabled` 关闭时一律返回 403。

后台 API 全部收在 `/admin/*` 下：`auth`、`players`、`wallet`、`config`、`items`、
`exchange`、`promo`、`stats`、`audit-logs`、`idempotency`、`admin-users`、`roles`、
`permissions`、`menus`

> 装扮曾挂 `/wardrobe`、看广告曾挂 `/ad`、体力曾挂 `/stamina`、收货地址曾挂 `/address`，
> 后台登录曾挂 `/auth/admin`——这些**旧路径已全部移除且不做兼容**，
> 客户端须按上表调用。改动原委见 `docs/待办执行清单.md` 的「R 轮：路由收缩」。
