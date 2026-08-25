import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Ledger } from '../entities/ledger.entity';
import { Wallet } from '../entities/wallet.entity';
import { EconomyService } from './economy.service';

/**
 * EconomyService 是经济域唯一记账入口，核心保证：
 *  - 入参校验（delta 非零安全整数、bizId 必填）
 *  - 记账原子性 + 余额非负
 *  - (userId,bizId,pool) 幂等回放（依赖唯一索引 23505）
 * 这里用假 DataSource 覆盖上述路径，不触碰真实 Postgres。
 */
describe('EconomyService', () => {
  let service: EconomyService;
  let wallets: jest.Mocked<Pick<Repository<Wallet>, 'findOne'>>;
  let ledgers: jest.Mocked<
    Pick<Repository<Ledger>, 'findOne' | 'findAndCount'>
  >;
  let dataSource: {
    manager: Partial<EntityManager>;
    transaction: jest.Mock;
  };

  beforeEach(() => {
    wallets = { findOne: jest.fn() };
    ledgers = { findOne: jest.fn(), findAndCount: jest.fn() };
    dataSource = {
      manager: { query: jest.fn().mockResolvedValue([]) },
      transaction: jest.fn(),
    };

    service = new EconomyService(
      dataSource as unknown as DataSource,
      wallets as unknown as Repository<Wallet>,
      ledgers as unknown as Repository<Ledger>,
    );
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
    });

    it('拒绝空 bizId', async () => {
      await expect(
        service.apply({
          userId: 'u1',
          pool: 'game',
          delta: 10,
          bizId: '',
          reason: 'interact',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('apply 记账', () => {
    /** 模拟一次成功事务：UPDATE 返回新余额，INSERT ledger 返回主键。 */
    function mockSuccessTx() {
      const m: Partial<EntityManager> = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('INSERT INTO "wallet"')) return [];
          if (sql.includes('UPDATE "wallet"')) {
            // UPDATE ... RETURNING → [rows[], affected]
            return [[{ game_coin: '110', marketing_point: '0' }], 1];
          }
          if (sql.includes('INSERT INTO "ledger"')) {
            return [{ id: 'L1', created_at: new Date('2026-01-01T00:00:00Z') }];
          }
          return [];
        }),
      };
      dataSource.transaction.mockImplementation((cb: any) => cb(m));
      return m;
    }

    it('发放成功：返回新余额与账目，duplicated=false', async () => {
      mockSuccessTx();
      const res = await service.apply({
        userId: 'u1',
        pool: 'game',
        delta: 10,
        bizId: 'b1',
        reason: 'interact',
      });

      expect(res.duplicated).toBe(false);
      expect(res.wallet.gameCoin).toBe(110);
      expect(res.entry).toMatchObject({
        id: 'L1',
        pool: 'game',
        delta: 10,
        balanceAfter: 110,
        bizId: 'b1',
        reason: 'interact',
      });
    });

    it('余额不足：UPDATE 影响 0 行 → BadRequestException', async () => {
      const m: Partial<EntityManager> = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('UPDATE "wallet"')) return [[], 0];
          return [];
        }),
      };
      dataSource.transaction.mockImplementation((cb: any) => cb(m));

      await expect(
        service.apply({
          userId: 'u1',
          pool: 'game',
          delta: -999,
          bizId: 'b1',
          reason: 'purchase',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('重复提交(23505)：走幂等回放，duplicated=true 且不二次变动', async () => {
      dataSource.transaction.mockRejectedValue({ code: '23505' });
      ledgers.findOne.mockResolvedValue({
        id: 'L1',
        pool: 'game',
        delta: 10,
        balanceAfter: 110,
        bizId: 'b1',
        reason: 'interact',
        refId: null,
        userId: 'u1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      } as unknown as Ledger);
      wallets.findOne.mockResolvedValue({
        userId: 'u1',
        gameCoin: '110',
        marketingPoint: '0',
      } as unknown as Wallet);

      const res = await service.apply({
        userId: 'u1',
        pool: 'game',
        delta: 10,
        bizId: 'b1',
        reason: 'interact',
      });

      expect(res.duplicated).toBe(true);
      expect(res.entry.id).toBe('L1');
      expect(res.wallet.gameCoin).toBe(110);
    });

    it('唯一冲突但查不到原账目(并发未提交)：抛 ConflictException 让客户端重试', async () => {
      dataSource.transaction.mockRejectedValue({ code: '23505' });
      ledgers.findOne.mockResolvedValue(null);

      await expect(
        service.apply({
          userId: 'u1',
          pool: 'game',
          delta: 10,
          bizId: 'b1',
          reason: 'interact',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('adminGrant', () => {
    it('正数 → admin_grant，负数 → admin_deduct', async () => {
      const spy = jest.spyOn(service, 'apply').mockResolvedValue({} as any);

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
  });
});
