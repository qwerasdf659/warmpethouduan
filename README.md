# warmpet-api

微信小游戏「宠物养成」后端。基于 **NestJS 11 + TypeScript 5 + PostgreSQL 16 + Redis 7 + TypeORM**，运行于 Sealos DevBox（`/home/devbox/project`）。

## 技术栈

| 领域 | 选型 |
| --- | --- |
| 框架 | NestJS 11 + TypeScript 5 + Node.js 22 |
| 持久层 | PostgreSQL 16（Sealos 托管）+ TypeORM（`synchronize:false`，**只走迁移**） |
| 缓存 / 锁 / 幂等 | Redis 7（DevBox 本机，PM2 守护 + AOF）+ ioredis，统一 `REDIS_URL` |
| 鉴权 | `@nestjs/jwt`（玩家 JWT + 后台 RBAC） |
| 配置 | `@nestjs/config` + Joi 校验 |
| 运营后台 | Ant Design Pro（`admin-web/`，构建产物挂载于 `/console`） |

## 架构铁律

1. **服务端权威**：时间 / 收益 / 衰减一律用 `ClockService`，禁用客户端上报的时间与数值。
2. **幂等**：写接口带 `bizId`，经济写操作叠加 `uq_ledger_user_biz_pool` DB 唯一索引做持久去重（Redis 结果缓存只兜 24h）。
3. **并发安全**：同一玩家的写操作用 `LockService.withLock('pet:'+userId, ...)` 串行化；经济记账靠单语句原子 `UPDATE … WHERE col + delta >= 0`，不加 Redis 锁（避免与宠物域锁自死锁）。
4. **软失败不死亡**：非关键依赖失败降级，不阻断主链路。

## 功能模块

| 模块 | 目录 | 说明 |
| --- | --- | --- |
| 鉴权 | `src/auth` | 微信 `code2Session` 登录 → 自签 JWT |
| 宠物 | `src/pet` | 四动作照顾（feed/bath/pet/play）+ 惰性衰减结算 + 成长 + 多宠 + 离线收益 |
| 经济 | `src/economy` | 双积分账户（游戏币 / 营销积分）+ 单边流水账本，唯一记账入口 `EconomyService.apply` |
| 每日 | `src/daily` | 签到（连签奖励）+ 每日任务领奖 |
| 赛跑 | `src/race` | 赛道 + 服务端权威结算（三围 speed/stamina/endurance）+ 名次奖励 |
| 换装 | `src/items` | 目录 / 拥有 / 穿戴，购买扣币 |
| 家园 | `src/home` | 家具布局 + 舒适度 `comfortFactor` 回流心情衰减 |
| 图鉴 | `src/dex` | 点亮 + 系列集齐奖励 |
| 变现 | `src/boost` | 激励广告核销 / 加速 / 体力恢复 |
| 兑换履约 | `src/exchange` | 虚拟 + 实物兑换、收货地址、兑换订单 |
| 运营后台 | `src/admin` | RBAC + 审计 + 玩家管理 + 全局流水 + 人工发币 + 数据看板 + 配置中心 + `*_def` CRUD + 兑换管理 |

## 目录约定

- `src/entities/*.entity.ts`：所有实体（CLI DataSource 用 glob 登记，**新增实体禁止只登记到 `app.module.ts`**，否则 `migration:generate` 会把该表当「多余表」生成 `DROP TABLE`）。
- `src/migrations/*.ts`：迁移文件（当前 12 条）。
- `src/common`：基础设施三件套（`ClockService` / `LockService` / `IdempotencyInterceptor`，全局）。
- `scripts/dev/*.ts`：联调数据工具（播种 / 清理 / 清档），用 `ts-node -T -P scripts/tsconfig.json` 跑。
- `admin-web/`：运营后台前端（独立 pnpm 工程，`pnpm build` 产物挂 `/console`）。
- `docs/`：项目文档（宠物功能详细规格 / 待办执行清单）。

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
npm run test:e2e       # e2e（/health）
npm run test:cov       # 覆盖率
```

> 迁移生成后**必读一遍 SQL**，确认没有意外的 `DROP`。

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

## 端口与入口

- API：`/auth`、`/pet`、`/wallet`、`/daily`、`/race`、`/wardrobe`、`/home`、`/dex`、`/ad`、`/boost`、`/stamina`、`/exchange`、`/address`、`/admin/*`、`/health`
- 运营后台：`/console`
