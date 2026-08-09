import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { PantryController } from './controllers/pantry.controller';
import { PantryService } from './application/pantry.service';
import { PantryRepository } from './infrastructure/pantry.repository';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [PantryController],
  providers: [PantryService, PantryRepository],
  exports: [PantryService],
})
export class PantryModule {}
