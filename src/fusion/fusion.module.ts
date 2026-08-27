import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Pet } from '../entities/pet.entity';
import { FusionController } from './fusion.controller';
import { FusionService } from './fusion.service';

@Module({
  imports: [TypeOrmModule.forFeature([Pet]), AuthModule],
  controllers: [FusionController],
  providers: [FusionService],
  exports: [FusionService],
})
export class FusionModule {}
