import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OcrService } from './ocr.service';
import { OcrProvider } from './ocr-provider.interface';
import { AliyunOcrProvider } from './aliyun-ocr.provider';

// 根据 OCR_PROVIDER 选择供应商，多厂商在下方 switch 注册。
const ocrProviderFactory = {
  provide: 'OCR_PROVIDER',
  inject: [ConfigService],
  useFactory: (cfg: ConfigService): OcrProvider => {
    const which = (cfg.get<string>('OCR_PROVIDER') || 'aliyun').toLowerCase();
    switch (which) {
      case 'aliyun':
      default:
        return new AliyunOcrProvider(cfg);
      // 例：case 'tencent': return new TencentOcrProvider(cfg);
      // 例：case 'baidu': return new BaiduOcrProvider(cfg);
    }
  },
};

@Module({
  providers: [OcrService, AliyunOcrProvider, ocrProviderFactory],
  exports: [OcrService],
})
export class OcrModule {}
