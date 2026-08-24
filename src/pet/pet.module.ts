import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Pet } from '../entities/pet.entity';
import { PetController } from './pet.controller';
import { PetService } from './pet.service';

@Module({
  imports: [TypeOrmModule.forFeature([Pet]), AuthModule],
  controllers: [PetController],
  providers: [PetService],
})
export class PetModule {}
