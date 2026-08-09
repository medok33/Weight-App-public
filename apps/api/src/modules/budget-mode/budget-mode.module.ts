import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BudgetModeService } from './application/budget-mode.service';
import { BudgetModeController } from './controllers/budget-mode.controller';
import { BudgetModeRepository } from './infrastructure/budget-mode.repository';

@Module({
  imports: [AuthModule],
  controllers: [BudgetModeController],
  providers: [BudgetModeService, BudgetModeRepository],
  exports: [BudgetModeService],
})
export class BudgetModeModule {}
