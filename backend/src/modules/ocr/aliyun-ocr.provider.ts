import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { OcrProvider, OcrResult } from './ocr-provider.interface';

// 阿里云 OCR（通用全文识别 RecognzeAllText）。
// 证书多为非标准卡证（应急管理局、住建局颁发），用通用文字识别提取全文，
// 再启发式解析常见字段；解析不出或置信度低 -> needManual=true，交给人工。
@Injectable()
export class AliyunOcrProvider implements OcrProvider {
  readonly name = 'aliyun';
  private readonly logger = new Logger(AliyunOcrProvider.name);
  private accessKeyId: string;
  private accessKeySecret: string;
  private region: string;

  constructor(cfg: ConfigService) {
    this.accessKeyId = cfg.get<string>('ALIYUN_OCR_ACCESS_KEY_ID') || '';
    this.accessKeySecret = cfg.get<string>('ALIYUN_OCR_ACCESS_KEY_SECRET') || '';
    this.region = cfg.get<string>('ALIYUN_OCR_REGION') || 'cn-shanghai';
  }

  // ROS 签名 V1（HMAC-SHA1）
  private sign(params: Record<string, string>, secret: string): string {
    const percent = (s: string) =>
      encodeURIComponent(s)
        .replace(/\+/g, '%20')
        .replace(/\*/g, '%2A')
        .replace(/%7E/g, '~');
    const sorted = Object.keys(params).sort();
    const canonical = sorted.map((k) => `${percent(k)}=${percent(params[k])}`).join('&');
    const stringToSign = `GET&${percent('/')}&${percent(canonical)}`;
    return crypto.createHmac('sha1', secret + '&').update(stringToSign).digest('base64');
  }

  async recognize(buffer: Buffer, mime: string): Promise<OcrResult> {
    if (!this.accessKeyId || !this.accessKeySecret) {
      this.logger.warn('未配置阿里云 OCR 密钥，转人工审核');
      return { raw: '', fields: {}, needManual: true };
    }

    const imageBase64 = buffer.toString('base64');
    const params: Record<string, string> = {
      Action: 'RecognizeAllText',
      Version: '2021-07-07',
      Format: 'JSON',
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      AccessKeyId: this.accessKeyId,
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      RegionId: this.region,
      ImageContent: imageBase64,
    };
    params.Signature = this.sign(params, this.accessKeySecret);

    try {
      const resp = await axios.get(`https://ocr.${this.region}.aliyuncs.com/`, {
        params,
        timeout: 30000,
      });
      const data = resp.data?.Data || {};
      const raw: string = data.Content || data.Result || JSON.stringify(data);
      const fields = this.parseFields(raw);
      const needManual = Object.keys(fields).length === 0;
      return { raw, fields, needManual };
    } catch (e: any) {
      this.logger.error('阿里云 OCR 调用失败：' + (e?.response?.data?.Message || e?.message || e));
      return { raw: '', fields: {}, needManual: true };
    }
  }

  // 启发式解析证书常见字段
  private parseFields(text: string): Record<string, string> {
    const f: Record<string, string> = {};
    const lines = text.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      const kv = line.match(/^(.*?)[：:]\s*(.+)$/);
      if (kv) {
        const key = kv[1].replace(/[：:\s]/g, '');
        const val = kv[2].trim();
        if (/姓名|名字|持证人/.test(key)) f.name = val;
        else if (/作业类别|作业种类|工种|操作项目/.test(key)) f.operationType = val;
        else if (/证书编号|编号|证号/.test(key)) f.certNo = val;
        else if (/发证机关|颁发机构|签发机关/.test(key)) f.issuer = val;
        else if (/有效期|有效期限/.test(key)) f.validUntil = val;
      }
    }

    // 兜底：从全文里抓“住建局/应急管理局/市场监督管理局”等机关名
    if (!f.issuer) {
      const m = text.match(/(.{2,}(?:局|委员会|管理局|监管局|住建|应急|市场监督))/);
      if (m) f.issuer = m[1];
    }
    if (!f.operationType) {
      const m = text.match(/(动火|高处|受限空间|起重|电工|焊接与热切割|制冷与空调|危险化学品|压力容器)/);
      if (m) f.operationType = m[1];
    }
    return f;
  }
}
