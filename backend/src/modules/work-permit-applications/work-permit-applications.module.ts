import { Module } from '@nestjs/common';
import { WorkPermitApplicationsService } from './work-permit-applications.service';
import { EApplicationsController } from './e-applications.controller';
import { EmailModule } from '@/modules/email/email.module';
import { AiModule } from '@/modules/ai/ai.module';
import { OcrModule } from '@/modules/ocr/ocr.module';
import { FilesModule } from '@/modules/files/files.module';
import { WorkPermitsModule } from '@/modules/work-permits/work-permits.module';

// 纸质 legacy 路由（work-permit-applications.controller）已移除：前端统一走 /e-applications（channel=electronic），
// 纸质申请单不再暴露 HTTP 面，避免双控制器重复实现。
@Module({
  imports: [EmailModule, AiModule, OcrModule, FilesModule, WorkPermitsModule],
  controllers: [EApplicationsController],
  providers: [WorkPermitApplicationsService],
  exports: [WorkPermitApplicationsService],
})
export class WorkPermitApplicationsModule {}
