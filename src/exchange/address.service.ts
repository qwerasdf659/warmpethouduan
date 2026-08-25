import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserAddress } from '../entities/user-address.entity';
import { CreateAddressDto, UpdateAddressDto } from './dto/exchange.dto';

/** 收货地址 CRUD（玩家自管）。 */
@Injectable()
export class AddressService {
  constructor(
    @InjectRepository(UserAddress)
    private readonly addresses: Repository<UserAddress>,
  ) {}

  async list(userId: string): Promise<{ list: UserAddress[] }> {
    const list = await this.addresses.find({
      where: { userId },
      order: { isDefault: 'DESC', id: 'DESC' },
    });
    return { list };
  }

  async create(
    userId: string,
    dto: CreateAddressDto,
  ): Promise<{ address: UserAddress }> {
    if (dto.isDefault) await this.clearDefault(userId);
    const saved = await this.addresses.save(
      this.addresses.create({
        userId,
        receiver: dto.receiver,
        phone: dto.phone,
        region: dto.region,
        detail: dto.detail,
        isDefault: dto.isDefault ?? false,
      }),
    );
    return { address: saved };
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateAddressDto,
  ): Promise<{ address: UserAddress }> {
    const addr = await this.addresses.findOne({ where: { id, userId } });
    if (!addr) throw new NotFoundException('地址不存在');
    if (dto.isDefault) await this.clearDefault(userId);
    Object.assign(addr, {
      receiver: dto.receiver ?? addr.receiver,
      phone: dto.phone ?? addr.phone,
      region: dto.region ?? addr.region,
      detail: dto.detail ?? addr.detail,
      isDefault: dto.isDefault ?? addr.isDefault,
    });
    return { address: await this.addresses.save(addr) };
  }

  async remove(userId: string, id: string): Promise<{ ok: true }> {
    const res = await this.addresses.delete({ id, userId });
    if (!res.affected) throw new NotFoundException('地址不存在');
    return { ok: true };
  }

  /** 校验归属并返回地址（兑换下单快照用）。 */
  async getOwned(userId: string, id: string): Promise<UserAddress> {
    const addr = await this.addresses.findOne({ where: { id, userId } });
    if (!addr) throw new NotFoundException('收货地址不存在');
    return addr;
  }

  private async clearDefault(userId: string): Promise<void> {
    await this.addresses.update(
      { userId, isDefault: true },
      { isDefault: false },
    );
  }
}
