import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { Pet } from '../entities/pet.entity';
import { User } from '../entities/user.entity';
import { HomeComfortModule } from '../home/home-comfort.module';
import { PetBonusModule } from '../pet-bonus/pet-bonus.module';
import { EventModule } from '../event/event.module';
import { PetController } from './pet.controller';
import { PetService } from './pet.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Pet, User]),
    AuthModule,
    EconomyModule,
    HomeComfortModule,
    PetBonusModule,
    EventModule,
  ],
  controllers: [PetController],
  providers: [PetService],
  exports: [PetService],
})
export class PetModule {}
