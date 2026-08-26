import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HomeLayout } from '../entities/home-layout.entity';
import { HomeComfortService } from './home-comfort.service';

/**
 * 单独成模块，是为了让 PetModule 也能用上舒适度口径而不产生循环依赖
 * （ItemsModule → PetModule 已成链，PetModule 再导入 HomeModule 就会成环）。
 * 这里只依赖 HomeLayout 仓储，不牵扯控制器与 ItemsModule。
 */
@Module({
  imports: [TypeOrmModule.forFeature([HomeLayout])],
  providers: [HomeComfortService],
  exports: [HomeComfortService],
})
export class HomeComfortModule {}
