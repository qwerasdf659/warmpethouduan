import { BadRequestException } from '@nestjs/common';
import { AssetCatalogService, AssetView } from './asset-catalog.service';
import { LedgerService } from './ledger.service';
import { PostInput } from './ledger.types';
import { RewardService } from './reward.service';

function assetOf(code: string, kind: AssetView['kind']): AssetView {
  return {
    code,
    kind,
    itemType: kind === 'unique' ? 'skin' : 'consumable',
    name: code,
    slot: null,
    price: 100,
    priceAsset: 'game_coin',
    comfort: 0,
    gridW: 1,
    gridH: 1,
    tradable: true,
    redeemable: false,
    mintLimit: null,
    mintedCount: 0,
    enabled: true,
    sortOrder: 0,
    meta: {},
  };
}

/**
 * `RewardService` 是所有玩法产出与消耗的唯一出口。它自己不写库，
 * 职责是把「奖励清单」翻译成一张凭证的分录与铸造项，因此这里测的就是那次翻译。
 */
describe('RewardService', () => {
  let ledger: { post: jest.Mock };
  let svc: RewardService;

  /** 取本次交给 LedgerService 的凭证。 */
  const posted = (): PostInput =>
    (ledger.post.mock.calls as unknown[][])[0][0] as PostInput;

  beforeEach(() => {
    ledger = {
      post: jest.fn().mockResolvedValue({
        txnId: 'T1',
        bizId: 'u1:x',
        balances: {},
        minted: [],
        duplicated: false,
      }),
    };
    const catalog = {
      getManyByCode: jest.fn((codes: string[]) =>
        Promise.resolve(
          new Map(
            codes.map((c) => [
              c,
              assetOf(c, c.startsWith('skin') ? 'unique' : 'stackable'),
            ]),
          ),
        ),
      ),
    };
    svc = new RewardService(
      ledger as unknown as LedgerService,
      catalog as unknown as AssetCatalogService,
    );
  });

  describe('grant', () => {
    it('纯发放落 issue 凭证', async () => {
      await svc.grant('u1', [{ assetCode: 'game_coin', count: 50 }], {
        reason: 'daily',
        bizKey: 'daily:2026-01-01',
      });

      expect(posted()).toMatchObject({
        kind: 'issue',
        reason: 'daily',
        bizKey: 'daily:2026-01-01',
        actorUserId: 'u1',
        scope: 'user',
        legs: [
          { account: { userId: 'u1' }, assetCode: 'game_coin', delta: 50 },
        ],
      });
    });

    /**
     * 唯一物品必须逐件铸造：每件要独立占用一个限量编号，
     * 合成一条「+3」的数量分录就没有编号可分了。
     */
    it('唯一物品按件数展开成多条 mint，而不是一条数量分录', async () => {
      await svc.grant('u1', [{ assetCode: 'skin_tiger', count: 3 }], {
        reason: 'compensation',
        bizKey: 'k',
      });

      const input = posted();
      expect(input.legs).toHaveLength(0);
      expect(input.mints).toEqual([
        { assetCode: 'skin_tiger', to: { userId: 'u1' } },
        { assetCode: 'skin_tiger', to: { userId: 'u1' } },
        { assetCode: 'skin_tiger', to: { userId: 'u1' } },
      ]);
    });

    it('合并同一资产的多项（十连抽到三份零食应该是一条分录）', async () => {
      await svc.grant(
        'u1',
        [
          { assetCode: 'cons_snack', count: 3 },
          { assetCode: 'cons_snack', count: 2 },
          { assetCode: 'cons_cake', count: 1 },
        ],
        { reason: 'gacha', bizKey: 'k' },
      );

      const legs = posted().legs ?? [];
      expect(legs).toHaveLength(2);
      expect(legs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ assetCode: 'cons_snack', delta: 5 }),
          expect.objectContaining({ assetCode: 'cons_cake', delta: 1 }),
        ]),
      );
    });

    it('忽略 count<=0 的项；全部无效时拒绝而不是发一张空凭证', async () => {
      await expect(
        svc.grant('u1', [{ assetCode: 'game_coin', count: 0 }], {
          reason: 'daily',
          bizKey: 'k',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(ledger.post).not.toHaveBeenCalled();
    });

    it('未知资产直接拒绝，不静默跳过', async () => {
      const catalog = {
        getManyByCode: jest.fn(() => Promise.resolve(new Map())),
      };
      const s = new RewardService(
        ledger as unknown as LedgerService,
        catalog as unknown as AssetCatalogService,
      );
      await expect(
        s.grant('u1', [{ assetCode: 'ghost', count: 1 }], {
          reason: 'daily',
          bizKey: 'k',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('charge', () => {
    it('扣费落 burn 凭证，delta 取负', async () => {
      await svc.charge('u1', [{ assetCode: 'game_coin', count: 300 }], {
        reason: 'gacha',
        bizKey: 'k',
      });

      expect(posted()).toMatchObject({
        kind: 'burn',
        legs: [
          { account: { userId: 'u1' }, assetCode: 'game_coin', delta: -300 },
        ],
      });
    });

    /**
     * 唯一物品的「花掉」必须指名是哪一件：每件都有独立身份与编号，
     * 按 code 扣减无法回答「卖掉的是第 7/100 件还是第 92/100 件」。
     */
    it('拒绝按数量扣减唯一物品', async () => {
      await expect(
        svc.charge('u1', [{ assetCode: 'skin_tiger', count: 1 }], {
          reason: 'purchase',
          bizKey: 'k',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(ledger.post).not.toHaveBeenCalled();
    });
  });

  describe('exchange', () => {
    /** G2 的修复点：扣费与发放在同一张凭证里，中间态不存在。 */
    it('扣费与发放合成一张凭证，成本与奖励同时出现在分录里', async () => {
      await svc.exchange(
        'u1',
        [{ assetCode: 'game_coin', count: 900 }],
        [{ assetCode: 'furn_sofa', count: 1 }],
        { reason: 'purchase', bizKey: 'buy:1' },
      );

      expect(ledger.post).toHaveBeenCalledTimes(1);
      const legs = posted().legs ?? [];
      expect(legs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ assetCode: 'game_coin', delta: -900 }),
          expect.objectContaining({ assetCode: 'furn_sofa', delta: 1 }),
        ]),
      );
    });

    /**
     * 混合凭证按「定义性动作」归类。两者都不要求平衡 —— 发行与销毁本就是
     * 凭空产生与消失，硬凑对手方只会让对账多一个说谎的地方。
     */
    it('有成本就是 burn，纯发放是 issue', async () => {
      await svc.exchange(
        'u1',
        [{ assetCode: 'game_coin', count: 1 }],
        [{ assetCode: 'cons_snack', count: 1 }],
        { reason: 'purchase', bizKey: 'k1' },
      );
      expect(posted().kind).toBe('burn');

      ledger.post.mockClear();
      await svc.exchange('u1', [], [{ assetCode: 'cons_snack', count: 1 }], {
        reason: 'daily',
        bizKey: 'k2',
      });
      expect(posted().kind).toBe('issue');
    });

    it('扣币 + 铸造唯一物品：分录与 mint 同在一张凭证', async () => {
      await svc.exchange(
        'u1',
        [{ assetCode: 'game_coin', count: 5000 }],
        [{ assetCode: 'skin_aurora', count: 1 }],
        { reason: 'purchase', bizKey: 'buy:2' },
      );

      const input = posted();
      expect(input.legs).toHaveLength(1);
      expect(input.mints).toHaveLength(1);
    });

    it('scope 可覆盖为 sys（定时任务与后台的键不该带玩家前缀）', async () => {
      await svc.grant('u1', [{ assetCode: 'game_coin', count: 1 }], {
        reason: 'compensation',
        bizKey: 'k',
        scope: 'sys',
      });
      expect(posted().scope).toBe('sys');
    });
  });
});
