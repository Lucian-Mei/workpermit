import { Module, Global } from '@nestjs/common';
import { FeishuSyncService } from './feishu-sync.service';

// 飞书多维表格同步（预留接口，全局可用，默认 no-op）
@Global()
@Module({
  providers: [FeishuSyncService],
  exports: [FeishuSyncService],
})
export class FeishuSyncModule {}
