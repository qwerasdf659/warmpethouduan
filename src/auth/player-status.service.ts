import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';

/**
 * 玩家账号状态校验的唯一出口。
 *
 * 单独抽成服务而不是让守卫直接注入仓储，是因为 Nest 在**使用方模块**的注入器里
 * 实例化守卫：若守卫依赖 `UserRepository`，每个挂载它的模块都得自己
 * `TypeOrmModule.forFeature([User])`。依赖本服务则只需 import AuthModule，
 * 而各玩法模块本来就已经 import 了它。
 */
@Injectable()
export class PlayerStatusService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /** 封禁账号抛 403；账号不存在不在此处判定，交由后续业务给出更准确的报错。 */
  async assertNotBanned(userId: string): Promise<void> {
    const row = await this.users.findOne({
      where: { id: userId },
      select: { id: true, status: true, bannedReason: true },
    });
    if (row?.status === 'banned') {
      throw new ForbiddenException(
        row.bannedReason ? `账号已被封禁：${row.bannedReason}` : '账号已被封禁',
      );
    }
  }
}
