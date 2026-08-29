import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@/database/schema';
import { OcrProvider, OcrResult } from './ocr-provider.interface';

// OCR 服务：调用具体供应商识别证书，结果写回 certificate_ocr 表。
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    @Inject('OCR_PROVIDER') private provider: OcrProvider,
    private cfg: ConfigService,
  ) {}

  async recognize(buffer: Buffer, mime: string): Promise<OcrResult> {
    return this.provider.recognize(buffer, mime);
  }

  // 把识别结果落库，返回是否需人工
  async saveResult(
    workPermitId: string,
    file: { fileName: string; filePath: string; fileType: string },
    result: OcrResult,
  ): Promise<boolean> {
    const issuer = result.fields.issuer;
    await this.db.insert(schema.certificateOcr).values({
      workPermitId,
      fileName: file.fileName,
      filePath: file.filePath,
      fileType: file.fileType,
      issuer,
      ocrRaw: result.raw,
      ocrFields: result.fields,
      ocrStatus: result.needManual ? 'manual' : 'done',
      needManual: result.needManual,
    });
    return result.needManual;
  }
}
