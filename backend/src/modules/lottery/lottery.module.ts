import { Module } from '@nestjs/common';
import { LotteryService } from './lottery.service';
import { LotteryController } from './lottery.controller';

@Module({
  providers: [LotteryService],
  controllers: [LotteryController],
  exports: [LotteryService],
})
export class LotteryModule {}
