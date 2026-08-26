import { BadRequestException } from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service';
import { GAME_COIN, MARKETING_POINT } from '../ledger/ledger.types';
import { EconomyService } from './economy.service';

/**
 * `EconomyService` 重构后是**货币视角的门面**，本身不含记账逻辑。
 * 因此这里测的是两件翻译工作是否正确：
 *  - 池 ↔ 资产 code（双池在新模型里是两个 `asset_def` 行，不是两列）
 *  - 余额 map ↔ `WalletView`（含新增的 frozen 口径）
 * 以及它是否把正确形状的凭证交给了 `LedgerService`。
 *
 * 真正的记账语义（分录平衡、批次分摊、幂等回放）在 `ledger.service.spec.ts` 测。
 */
describe('EconomyService', () => {
  let service: EconomyService;
  let ledger: jest.Mocked<
    Pick<LedgerService, 'post' | 'balances' | 'history' | 'globalHistory'>
  >;

  beforeEach(() => {
    ledger = {
      post: jest.fn().mockResolvedValue({
        txnId: 'T1',
        bizId: 'u1:b1',
        balances: { [GAME_COIN]: { available: 110, frozen: 0 } },
        minted: [],
        duplicated: false,
      }),
      balances: jest.fn().mockResolvedValue({
        [GAME_COIN]: { available: 110, frozen: 40 },
        [MARKETING_POINT]: { available: 7, frozen: 0 },
      }),
      history: jest.fn().mockResolvedValue({ list: [], total: 0 }),
      globalHistory: jest.fn().mockResolvedValue({ list: [], total: 0 }),
    };
    service = new EconomyService(ledger as unknown as LedgerService);
  });

  describe('入参校验', () => {
    it.each([0, 1.5, NaN])('拒绝非法 delta=%p', async (delta) => {
      await expect(
        service.apply({
          userId: 'u1',
          pool: 'game',
          delta,
          bizId: 'b1',
          reason: 'interact',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(ledger.post).not.toHaveBeenCalled();
    });

    it('拒绝未知积分池', async () => {
      await expect(
        service.apply({
          userId: 'u1',
          // 绕过类型检查模拟脏调用：池名来自配置，配错了不该静默记到某个默认资产上
          pool: 'gold' as 'game',
          delta: 10,
          bizId: 'b1',
          reason: 'interact',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('钱包读取', () => {
    it('把余额 map 摊成 WalletView，含 frozen 口径', async () => {
      const w = await service.getWallet('u1');
      expect(w).toEqual({
        gameCoin: 110,
        marketingPoint: 7,
        gameCoinFrozen: 40,
        marketingPointFrozen: 0,
      });
    });

    it('没有任何余额行时按 0 返回，不报错', async () => {
      ledger.balances.mockResolvedValue({});
      expect(await service.getWallet('u404')).toEqual({
        gameCoin: 0,
        marketingPoint: 0,
        gameCoinFrozen: 0,
        marketingPointFrozen: 0,
      });
    });
  });

  describe('apply 记账', () => {
    it('game 池映射到 game_coin，正数 delta 落 issue 凭证', async () => {
      await service.apply({
        userId: 'u1',
        pool: 'game',
        delta: 10,
        bizId: 'b1',
        reason: 'interact',
      });

      expect(ledger.post).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'issue',
          reason: 'interact',
          bizKey: 'b1',
          actorUserId: 'u1',
          scope: 'user',
          legs: [
            { account: { userId: 'u1' }, assetCode: GAME_COIN, delta: 10 },
          ],
        }),
      );
    });

    it('marketing 池映射到 marketing_point，负数 delta 落 burn 凭证', async () => {
      await service.apply({
        userId: 'u1',
        pool: 'marketing',
        delta: -20,
        bizId: 'b2',
        reason: 'exchange',
      });

      expect(ledger.post).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'burn',
          legs: [
            {
              account: { userId: 'u1' },
              assetCode: MARKETING_POINT,
              delta: -20,
            },
          ],
        }),
      );
    });

    it('出参回读整个钱包：本次只碰一池，另一池的值仍需查库', async () => {
      const res = await service.apply({
        userId: 'u1',
        pool: 'game',
        delta: 10,
        bizId: 'b1',
        reason: 'interact',
      });

      expect(res.wallet.marketingPoint).toBe(7);
      expect(res.entry).toMatchObject({
        txnId: 'T1',
        pool: 'game',
        delta: 10,
        balanceAfter: 110,
      });
      expect(res.duplicated).toBe(false);
    });

    it('透传 duplicated：幂等回放不该被门面吞掉', async () => {
      ledger.post.mockResolvedValue({
        txnId: 'T1',
        bizId: 'u1:b1',
        balances: {},
        minted: [],
        duplicated: true,
      });
      const res = await service.apply({
        userId: 'u1',
        pool: 'game',
        delta: 10,
        bizId: 'b1',
        reason: 'interact',
      });
      expect(res.duplicated).toBe(true);
    });
  });

  describe('adminGrant', () => {
    it('正数 → admin_grant，负数 → admin_deduct', async () => {
      const spy = jest.spyOn(service, 'apply').mockResolvedValue({
        wallet: {
          gameCoin: 0,
          marketingPoint: 0,
          gameCoinFrozen: 0,
          marketingPointFrozen: 0,
        },
        entry: {
          txnId: 'T',
          pool: 'game',
          delta: 0,
          balanceAfter: 0,
          bizId: '',
        },
        duplicated: false,
      });

      await service.adminGrant({
        userId: 'u1',
        pool: 'game',
        delta: 5,
        bizId: 'g1',
      });
      expect(spy).toHaveBeenLastCalledWith(
        expect.objectContaining({ reason: 'admin_grant', delta: 5 }),
      );

      await service.adminGrant({
        userId: 'u1',
        pool: 'game',
        delta: -5,
        bizId: 'g2',
      });
      expect(spy).toHaveBeenLastCalledWith(
        expect.objectContaining({ reason: 'admin_deduct', delta: -5 }),
      );
    });

    /**
     * 后台批量发放的幂等键必须由「运营填的 bizId + 玩家 id」派生，且不带
     * `u{userId}:` 前缀。整批共用一个键的话，全局唯一的 `asset_txn.biz_id`
     * 只会让第一个人拿到东西，其余人全部命中幂等回放。
     */
    it('派生出「不带玩家前缀、但含玩家 id」的幂等键', async () => {
      const spy = jest.spyOn(service, 'apply').mockResolvedValue({
        wallet: {
          gameCoin: 0,
          marketingPoint: 0,
          gameCoinFrozen: 0,
          marketingPointFrozen: 0,
        },
        entry: {
          txnId: 'T',
          pool: 'game',
          delta: 0,
          balanceAfter: 0,
          bizId: '',
        },
        duplicated: false,
      });

      await service.adminGrant({
        userId: 'u42',
        pool: 'game',
        delta: 5,
        bizId: 'batch-2026',
      });

      expect(spy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          bizId: 'admin:batch-2026:u42',
          actorIsPlayer: false,
        }),
      );
    });
  });
});
