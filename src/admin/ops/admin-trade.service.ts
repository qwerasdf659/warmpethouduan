import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TradeOffer } from '../../entities/trade-offer.entity';
import { TradeOfferItem } from '../../entities/trade-offer-item.entity';
import { QueryTradeOffersDto } from './dto/gameplay-query.dto';

export interface TradeOfferItemView {
  /** 行主键。前端按它做 key —— 同一单里同种资产可能出现多行 */
  id: string;
  side: 'from' | 'to';
  assetCode: string | null;
  qty: string | null;
  instanceId: string | null;
}

export interface TradeOfferView {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: string;
  fromCoin: string;
  toCoin: string;
  /** 双方各自付出的标的，按 side 分好，省得前端再分组 */
  fromItems: TradeOfferItemView[];
  toItems: TradeOfferItemView[];
  expiresAt: Date;
  settledTxnId: string | null;
  bizId: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 双向易货后台只读查询。
 *
 * 易货在建单时就冻结/托管双方资产，pending 期间玩家的东西是「锁着的」。
 * 后台此前对这个玩法完全没有入口：玩家来问「我的皮肤怎么用不了」，客服
 * 既看不到有没有挂在易货单上，也说不出这单什么时候过期。
 */
@Injectable()
export class AdminTradeService {
  constructor(
    @InjectRepository(TradeOffer)
    private readonly offers: Repository<TradeOffer>,
    @InjectRepository(TradeOfferItem)
    private readonly items: Repository<TradeOfferItem>,
  ) {}

  async offerList(
    q: QueryTradeOffersDto,
  ): Promise<{ list: TradeOfferView[]; total: number }> {
    const qb = this.offers
      .createQueryBuilder('o')
      .orderBy('o.id', 'DESC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize);

    if (q.status) qb.andWhere('o.status = :st', { st: q.status });
    if (q.userId) {
      // 客服拿到的只是「某个玩家」，不知道他是发起方还是接收方，两边都要查
      qb.andWhere('(o.fromUserId = :uid OR o.toUserId = :uid)', {
        uid: q.userId,
      });
    }

    const [rows, total] = await qb.getManyAndCount();
    return { list: await this.attachItems(rows), total };
  }

  /** 某玩家参与的易货单（详情抽屉用，只取最近若干条）。 */
  async offersOfUser(userId: string, limit = 20): Promise<TradeOfferView[]> {
    const rows = await this.offers
      .createQueryBuilder('o')
      .where('o.fromUserId = :uid OR o.toUserId = :uid', { uid: userId })
      .orderBy('o.id', 'DESC')
      .take(limit)
      .getMany();
    return this.attachItems(rows);
  }

  /**
   * 批量补挂标的。
   *
   * 一次 IN 查询而不是每单查一次：列表 20 行就是 20 次往返，而易货单的标的
   * 通常只有几件，一把捞回来在内存里分组更划算。
   */
  private async attachItems(rows: TradeOffer[]): Promise<TradeOfferView[]> {
    if (!rows.length) return [];

    const items = await this.items.find({
      where: { offerId: In(rows.map((r) => r.id)) },
      order: { id: 'ASC' },
    });
    const byOffer = new Map<string, TradeOfferItem[]>();
    for (const it of items) {
      const bucket = byOffer.get(it.offerId);
      if (bucket) bucket.push(it);
      else byOffer.set(it.offerId, [it]);
    }

    const toItemView = (it: TradeOfferItem): TradeOfferItemView => ({
      id: it.id,
      side: it.side,
      assetCode: it.assetCode,
      qty: it.qty,
      instanceId: it.instanceId,
    });

    return rows.map((o) => {
      const own = byOffer.get(o.id) ?? [];
      return {
        id: o.id,
        fromUserId: o.fromUserId,
        toUserId: o.toUserId,
        status: o.status,
        fromCoin: o.fromCoin,
        toCoin: o.toCoin,
        fromItems: own.filter((i) => i.side === 'from').map(toItemView),
        toItems: own.filter((i) => i.side === 'to').map(toItemView),
        expiresAt: o.expiresAt,
        settledTxnId: o.settledTxnId,
        bizId: o.bizId,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      };
    });
  }
}
