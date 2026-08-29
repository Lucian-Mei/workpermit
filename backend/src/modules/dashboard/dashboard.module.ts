import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { HazardsModule } from '@/modules/hazards/hazards.module';
import { WorkPermitsModule } from '@/modules/work-permits/work-permits.module';

@Module({
  imports: [HazardsModule, WorkPermitsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
