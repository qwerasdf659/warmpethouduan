import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EconomyService, WalletView } from '../../economy/economy.service';
import { User } from '../../entities/user.entity';
import { LedgerService } from '../../ledger/ledger.service';
import {
  GrantWalletBulkDto,
  GrantWalletDto,
  QueryLedgerDto,
  ReverseTxnDto,
} from './dto/wallet-admin.dto';

/**
 * 后台钱包运营：全局流水查询 + 人工发币/扣币。
 * 所有余额变动一律委托 EconomyService.apply（DB 原子记账 + 持久幂等）。
 */
@Injectable()
export class AdminWalletService {
  constructor(
    private readonly economy: EconomyService,
    private readonly ledger: LedgerService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  /** 全局流水分页。 */
  listLedger(q: QueryLedgerDto) {
    return this.economy.listGlobalLedger({
      page: q.page,
      pageSize: q.pageSize,
      userId: q.userId,
      pool: q.pool,
      assetCode: q.assetCode,
      reason: q.reason,
    });
  }

  /** 读某玩家钱包（校验玩家存在）。 */
  async getWallet(userId: string): Promise<{ wallet: WalletView }> {
    await this.assertUserExists(userId);
    return { wallet: await this.economy.getWallet(userId) };
  }

  /** 人工发币/扣币。 */
  async grant(userId: string, dto: GrantWalletDto) {
    await this.assertUserExists(userId);
    const delta = dto.direction === 'grant' ? dto.amount : -dto.amount;
    const result = await this.economy.adminGrant({
      userId,
      pool: dto.pool,
      delta,
      bizId: dto.bizId,
      refId: null,
    });
    return result;
  }

  /**
   * 批量发币/扣币（活动补偿、批量发营销积分）。
   *
   * 三个刻意的设计：
   *  - **每人一个派生 bizId**（`{bizId}:{userId}`）：整批用同一个 bizId 的话，
   *    经济域的 `(user_id, biz_id, pool)` 唯一键只能保证「每人一次」，
   *    但重试时无法区分是同一批还是新的一批。派生后重试整批完全幂等。
   *  - **单人失败不中断整批**：一个玩家不存在或扣减余额不足，不该让其余 199 人
   *    的发放回滚。逐个收集失败原因返回，运营据此补发。
   *  - **顺序执行而非 Promise.all**：批量发放不是延迟敏感操作，串行让 DB 压力可控，
   *    也让失败列表的顺序与输入一致、便于核对。
   */
  async grantBulk(dto: GrantWalletBulkDto): Promise<{
    total: number;
    succeeded: number;
    failed: { userId: string; message: string }[];
  }> {
    const delta = dto.direction === 'grant' ? dto.amount : -dto.amount;
    // 同一批里重复的 userId 去重：派生 bizId 相同，第二次本就是幂等回放，
    // 但去重能让 succeeded 计数反映真实人数而不是提交次数
    const targets = [...new Set(dto.userIds)];
    const failed: { userId: string; message: string }[] = [];
    let succeeded = 0;

    for (const userId of targets) {
      try {
        await this.assertUserExists(userId);
        await this.economy.adminGrant({
          userId,
          pool: dto.pool,
          delta,
          bizId: `${dto.bizId}:${userId}`,
          refId: null,
        });
        succeeded += 1;
      } catch (err) {
        failed.push({
          userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { total: targets.length, succeeded, failed };
  }

  /**
   * 冲正一张凭证（R7）。
   *
   * 适用场景：交易纠纷、盗号追回、配错数值的批量发放。冲正会按原凭证生成**反向
   * 分录**并写 `reversal_of`，原凭证一字不改 —— 这样「当初发生了什么」与
   * 「后来怎么修的」都留在账上。
   *
   * 两条限制由 `LedgerService.reverse` 保证：同一凭证不可重复冲正；
   * 铸造凭证不可冲正（那会让唯一物品凭空消失，破坏实例守恒）。
   */
  async reverseTxn(
    txnId: string,
    dto: ReverseTxnDto,
  ): Promise<{ txnId: string; reversedFrom: string }> {
    const result = await this.ledger.reverse(txnId, dto.bizId, 'reversal');
    return { txnId: result.txnId, reversedFrom: txnId };
  }

  private async assertUserExists(userId: string): Promise<void> {
    const u = await this.users.findOne({
      where: { id: userId },
      select: { id: true },
    });
    if (!u) throw new NotFoundException('玩家不存在');
  }
}
