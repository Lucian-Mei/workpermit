// OCR 供应商统一接口。不同发证机关（应急管理局、住建局…）的证书格式不同，
// 后期可分别接入不同识别能力，只要实现本接口即可。
export interface OcrProvider {
  readonly name: string;
  // buffer: 图片/PDF 二进制；mime: 文件类型
  // 返回：原始文本 + 尽量结构化的字段 + 是否需要人工
  recognize(buffer: Buffer, mime: string): Promise<OcrResult>;
}

export interface OcrResult {
  raw: string; // OCR 全部文本
  fields: Record<string, string>; // 结构化（姓名、作业类别、有效期、发证机关等）
  needManual: boolean; // 识别不了/置信度低，转人工确认
  confidence?: number;
}
