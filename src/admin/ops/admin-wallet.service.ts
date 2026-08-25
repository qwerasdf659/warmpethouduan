import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EconomyService, WalletView } from '../../economy/economy.service';
import { User } from '../../entities/user.entity';
import { GrantWalletDto, QueryLedgerDto } from './dto/wallet-admin.dto';

/**
 * 后台钱包运营：全局流水查询 + 人工发币/扣币。
 * 所有余额变动一律委托 EconomyService.apply（DB 原子记账 + 持久幂等）。
 */
@Injectable()
export class AdminWalletService {
  constructor(
    private readonly economy: EconomyService,
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

  private async assertUserExists(userId: string): Promise<void> {
    const u = await this.users.findOne({
      where: { id: userId },
      select: { id: true },
    });
    if (!u) throw new NotFoundException('玩家不存在');
  }
}
