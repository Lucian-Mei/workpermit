import { Module } from '@nestjs/common';
import { QrCodesService } from './qr-codes.service';
import { QrCodesController } from './qr-codes.controller';

@Module({
  providers: [QrCodesService],
  controllers: [QrCodesController],
})
export class QrCodesModule {}
