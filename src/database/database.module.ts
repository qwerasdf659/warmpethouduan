import { Module } from '@nestjs/common';
import { DbBootstrapService } from './db-bootstrap.service';

/**
 * 承载数据库层的启动自测。TypeOrmModule 在 AppModule 里全局建连，
 * 这里只负责「连上之后跑一次自测 + fail-fast」。
 */
@Module({
  providers: [DbBootstrapService],
})
export class DatabaseModule {}
