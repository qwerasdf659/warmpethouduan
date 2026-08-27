import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AccountService } from './account.service';
import { LedgerQueryService } from './ledger-query.service';
import { LedgerService } from './ledger.service';

/**
 * 账本核心的纯逻辑部分：幂等键拼接、凭证平衡校验、幂等冲突识别。
 *
 * 涉及真实 SQL 的部分（FIFO 跨批次消耗、限量编号分配、分区写入、
 * 条件 UPDATE 的 0 行语义）由 `test/ledger.e2e-spec.ts` 连真库验证 ——
 * 用假 EntityManager 断言 SQL 文本只会测出「我写的字符串等于我写的字符串」。
 */
describe('LedgerService', () => {
  let svc: LedgerService;

  beforeEach(() => {
    svc = new LedgerService(
      { query: jest.fn(), transaction: jest.fn() } as unknown as DataSource,
      {
        resolveMany: jest.fn(),
        resolve: jest.fn(),
      } as unknown as AccountService,
      { balances: jest.fn() } as unknown as LedgerQueryService,
    );
  });

  /**
   * 幂等键前缀是全局唯一 `biz_id` 的安全带。
   *
   * 旧 `ledger` 的幂等键是 `(user_id, biz_id, pool)`，带 `user_id` 是为了防不同
   * 玩家撞同一个客户端 UUID。收敛到凭证头之后不再有 `user_id` 参与，
   * 前缀就是它的替代物 —— 少了它，两个玩家提交同样的 UUID 会互相把对方的操作
   * 「幂等回放」掉，表现为「我领了奖但没到账」。
   */
  describe('buildBizId', () => {
    it('玩家发起的键带 u{userId}: 前缀', () => {
      expect(
        svc.buildBizId({ actorUserId: '42', bizKey: 'pet:interact:abc' }),
      ).toBe('u42:pet:interact:abc');
    });

    it('不同玩家用同一个客户端 UUID 得到不同的幂等键', () => {
      const a = svc.buildBizId({ actorUserId: '1', bizKey: 'uuid-x' });
      const b = svc.buildBizId({ actorUserId: '2', bizKey: 'uuid-x' });
      expect(a).not.toBe(b);
    });

    it('服务端派生与交易撮合各有独立命名空间', () => {
      expect(
        svc.buildBizId({ scope: 'sys', bizKey: 'expire:2026-01-01' }),
      ).toBe('sys:expire:2026-01-01');
      expect(svc.buildBizId({ scope: 'mkt', bizKey: '9:settle' })).toBe(
        'mkt:9:settle',
      );
    });

    it('scope=user 但没给 actorUserId 时拒绝，不静默退化成无前缀', () => {
      expect(() => svc.buildBizId({ scope: 'user', bizKey: 'k' })).toThrow(
        BadRequestException,
      );
    });

    it('空 bizKey 拒绝', () => {
      expect(() => svc.buildBizId({ actorUserId: '1', bizKey: '   ' })).toThrow(
        BadRequestException,
      );
    });

    it('超长键拒绝（varchar(160) 截断会让两个不同操作撞成同一个键）', () => {
      expect(() =>
        svc.buildBizId({ actorUserId: '1', bizKey: 'x'.repeat(200) }),
      ).toThrow(BadRequestException);
    });
  });

  /**
   * 平衡校验的求和口径是 `delta + frozenDelta`，而不是只看 `delta`。
   * 竞价中标时买家出的是冻结中的钱（frozenDelta=−1000、delta=0），
   * 卖家收到的是可用余额 —— 只看 delta 会把这张完全平衡的凭证判成差 1000。
   */
  describe('assertBalanced（经 postWithin 间接触发）', () => {
    /** 直接调私有方法：它是纯函数，为它单独造一条事务路径反而更不可读。 */
    const check = (kind: string, legs: unknown[], moves = 0) =>
      (
        svc as unknown as {
          assertBalanced: (k: string, l: unknown[], m: number) => void;
        }
      ).assertBalanced(kind, legs, moves);

    const leg = (assetCode: string, delta: number, frozenDelta = 0) => ({
      accountId: '1',
      assetCode,
      delta,
      frozenDelta,
    });

    it('transfer 按资产求和为 0 时通过', () => {
      expect(() =>
        check('transfer', [
          leg('game_coin', -1000),
          leg('game_coin', 950),
          leg('game_coin', 50),
        ]),
      ).not.toThrow();
    });

    it('transfer 不平衡时抛错（能指出是哪个资产差多少）', () => {
      expect(() =>
        check('transfer', [leg('game_coin', -1000), leg('game_coin', 900)]),
      ).toThrow(InternalServerErrorException);
    });

    it('竞价结算：买家付冻结、卖家收可用，按 delta+frozenDelta 求和为 0', () => {
      expect(() =>
        check('transfer', [
          leg('game_coin', 0, -1000),
          leg('game_coin', 950),
          leg('game_coin', 50),
        ]),
      ).not.toThrow();
    });

    it('多资产 transfer：每个资产各自平衡', () => {
      expect(() =>
        check('transfer', [
          leg('game_coin', -1000),
          leg('game_coin', 1000),
          leg('furn_sofa', 0, -1),
          leg('furn_sofa', 1),
        ]),
      ).not.toThrow();

      expect(() =>
        check('transfer', [
          leg('game_coin', -1000),
          leg('game_coin', 1000),
          leg('furn_sofa', 1),
        ]),
      ).toThrow(InternalServerErrorException);
    });

    it('transfer 只有一条腿时拒绝（转移必须有对手方）', () => {
      expect(() => check('transfer', [leg('game_coin', 0)])).toThrow(
        InternalServerErrorException,
      );
    });

    /**
     * 纯唯一物品的赠送没有数量分录，对手方体现在成对的 ±1 实例分录上，
     * 因此实例转移也算满足「必须有对手方」。
     */
    it('transfer 无数量分录但有实例转移时通过', () => {
      expect(() => check('transfer', [], 1)).not.toThrow();
    });

    it('freeze 要求每条腿的 delta+frozenDelta 守恒', () => {
      expect(() =>
        check('freeze', [leg('game_coin', -100, 100)]),
      ).not.toThrow();
      expect(() => check('freeze', [leg('game_coin', -100, 50)])).toThrow(
        InternalServerErrorException,
      );
    });

    it('issue / burn 不要求平衡（发行与销毁本就是凭空产生与消失）', () => {
      expect(() => check('issue', [leg('game_coin', 12)])).not.toThrow();
      expect(() => check('burn', [leg('game_coin', -100)])).not.toThrow();
      // 扭蛋：扣币 + 发多种奖品，一张凭证内不守恒
      expect(() =>
        check('burn', [
          leg('game_coin', -100),
          leg('furn_sofa', 1),
          leg('cons_snack', 3),
        ]),
      ).not.toThrow();
    });
  });

  /**
   * 幂等冲突必须精确到约束名。任何 23505 都当成「重复提交」的话，
   * 限量编号冲突（`uq_instance_serial`）或活跃出价冲突（`uq_bid_active_bidder`）
   * 会被误判成幂等回放，于是玩家得到一个「成功了」的响应而实际什么都没发生。
   */
  describe('isDuplicateBizId', () => {
    it('只认 uq_asset_txn_biz_id 上的唯一冲突', () => {
      expect(
        svc.isDuplicateBizId({
          code: '23505',
          constraint: 'uq_asset_txn_biz_id',
        }),
      ).toBe(true);
    });

    it('其它唯一约束的 23505 不算幂等冲突', () => {
      expect(
        svc.isDuplicateBizId({
          code: '23505',
          constraint: 'uq_instance_serial',
        }),
      ).toBe(false);
      expect(
        svc.isDuplicateBizId({
          code: '23505',
          constraint: 'uq_bid_active_bidder',
        }),
      ).toBe(false);
    });

    it('识别包在 driverError 里的形态（TypeORM 的两种错误形状）', () => {
      expect(
        svc.isDuplicateBizId({
          driverError: { code: '23505', constraint: 'uq_asset_txn_biz_id' },
        }),
      ).toBe(true);
    });

    it('非唯一冲突错误一律否', () => {
      expect(svc.isDuplicateBizId(new Error('boom'))).toBe(false);
      expect(svc.isDuplicateBizId({ code: '23514' })).toBe(false);
      expect(svc.isDuplicateBizId(undefined)).toBe(false);
    });
  });

  describe('replay', () => {
    /**
     * 唯一冲突却查不到原凭证，说明并发事务尚未提交。这时不能返回「成功」——
     * 那会让客户端以为操作完成了，而余额其实还没变。交由客户端重试。
     */
    it('查不到原凭证时抛 409 让客户端重试，而不是假装成功', async () => {
      const ds = { query: jest.fn().mockResolvedValue([]) };
      const s = new LedgerService(
        ds as unknown as DataSource,
        {} as unknown as AccountService,
        { balances: jest.fn() } as unknown as LedgerQueryService,
      );
      await expect(s.replay('u1:k')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('空凭证', () => {
    it('既没有分录也没有实例变动时拒绝', async () => {
      const m = { query: jest.fn() };
      await expect(
        svc.postWithin(m as never, {
          kind: 'issue',
          reason: 'daily',
          bizKey: 'k',
          actorUserId: '1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(m.query).not.toHaveBeenCalled();
    });
  });
});
