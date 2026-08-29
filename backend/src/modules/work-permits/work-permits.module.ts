import { Module } from '@nestjs/common';
import { WorkPermitsService } from './work-permits.service';
import { EPermitsController } from './e-permits.controller';
import { AiModule } from '@/modules/ai/ai.module';
import { OcrModule } from '@/modules/ocr/ocr.module';
import { FilesModule } from '@/modules/files/files.module';
import { EmailModule } from '@/modules/email/email.module';

// 纸质 legacy 路由（work-permits.controller）已移除：前端统一走 /e-permits（channel=electronic），
// 纸质通道不再暴露 HTTP 面，避免双控制器重复实现。
@Module({
  imports: [AiModule, OcrModule, FilesModule, EmailModule],
  controllers: [EPermitsController],
  providers: [WorkPermitsService],
  exports: [WorkPermitsService],
})
export class WorkPermitsModule {}
