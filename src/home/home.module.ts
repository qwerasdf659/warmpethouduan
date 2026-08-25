import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ItemsModule } from '../items/items.module';
import { ItemDef } from '../entities/item-def.entity';
import { HomeLayout } from '../entities/home-layout.entity';
import { HomeStat } from '../entities/home-stat.entity';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([HomeLayout, HomeStat, ItemDef]),
    AuthModule,
    ItemsModule,
  ],
  controllers: [HomeController],
  providers: [HomeService],
  exports: [HomeService],
})
export class HomeModule {}
