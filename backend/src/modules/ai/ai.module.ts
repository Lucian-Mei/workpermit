import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';

// AI 厂商/Key/模型改为运行时从 systemConfig(ai_config) 读取（界面可切换），
// 环境变量仅作兜底。OpenAiProvider 由 AiService 在 getProvider() 中按配置 new 实例化，
// 不在此作为 Nest provider 注册（其构造函数参数非可注入依赖）。
@Module({
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
