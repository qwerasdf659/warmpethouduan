import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * 数据库启动自测（对齐参考项目的 testConnection）：
 * 应用启动完成后跑一次 `SELECT 1` 验证真实往返，成功打印脱敏目标，
 * 失败则抛错阻断启动（fail-fast），避免「连不上库还对外提供服务」。
 * 只打印 host:port/db，绝不打印账号密码等敏感值。
 */
@Injectable()
export class DbBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Database');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const host = this.config.get<string>('db.host');
    const port = this.config.get<number>('db.port');
    const name = this.config.get<string>('db.name');
    const target = `${host}:${port}/${name}`;

    try {
      await this.dataSource.query('SELECT 1');
      this.logger.log(`PostgreSQL 连接自测通过: ${target}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`PostgreSQL 连接自测失败: ${target} - ${message}`);
      throw err;
    }
  }
}
