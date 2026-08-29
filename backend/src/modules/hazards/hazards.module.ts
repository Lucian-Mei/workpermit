import { Module } from '@nestjs/common';
import { HazardsService } from './hazards.service';
import { HazardsController } from './hazards.controller';
import { AiModule } from '@/modules/ai/ai.module';
import { EmailModule } from '@/modules/email/email.module';
import { LotteryModule } from '@/modules/lottery/lottery.module';

@Module({
  imports: [AiModule, EmailModule, LotteryModule],
  controllers: [HazardsController],
  providers: [HazardsService],
  exports: [HazardsService],
})
export class HazardsModule {}
