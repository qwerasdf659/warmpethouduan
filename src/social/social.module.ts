import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { HomeLike } from '../entities/home-like.entity';
import { HomeModule } from '../home/home.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PetModule } from '../pet/pet.module';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([HomeLike]),
    AuthModule,
    LedgerModule,
    HomeModule,
    PetModule,
  ],
  controllers: [SocialController],
  providers: [SocialService],
  exports: [SocialService],
})
export class SocialModule {}
