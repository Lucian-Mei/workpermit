import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

// S05：上传类型白名单（MIME + 文件头魔数）。仅图片与 PDF，拒绝 SVG/HTML/可执行等（防存储型 XSS）
const UPLOAD_TYPES: { mime: string; ext: string; magic: { offset: number; bytes: number[] }[] }[] = [
  { mime: 'image/jpeg', ext: '.jpg', magic: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  { mime: 'image/png', ext: '.png', magic: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }] },
  { mime: 'image/gif', ext: '.gif', magic: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }] },
  // WebP：RIFF....WEBP（RIFF 容器 + 8 偏移处 WEBP 标记）
  { mime: 'image/webp', ext: '.webp', magic: [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }] },
  { mime: 'application/pdf', ext: '.pdf', magic: [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }] },
];

// 文件上传：存到 UPLOAD_DIR（容器内 /app/uploads，已挂载数据卷），
// 对外通过 /uploads/... 访问。返回相对路径如 /uploads/2026/07/abc.jpg
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private root: string;

  constructor(cfg: ConfigService) {
    this.root = cfg.get<string>('UPLOAD_DIR') || './uploads';
  }

  async save(buffer: Buffer, _originalName: string, mime: string): Promise<{ filePath: string; fileName: string; fileType: string }> {
    // 白名单校验：MIME 必须在允许列表内
    const type = UPLOAD_TYPES.find((t) => t.mime === mime);
    if (!type) throw new BadRequestException('仅支持 JPG/PNG/GIF/WebP/PDF 文件');
    // 魔数校验：文件内容与声明类型必须一致，拒绝伪装成图片的 HTML/SVG/脚本
    const magicOk = type.magic.every(
      ({ offset, bytes }) =>
        buffer.length >= offset + bytes.length && bytes.every((b, i) => buffer[offset + i] === b),
    );
    if (!magicOk) throw new BadRequestException('文件内容与声明类型不符，已拒绝');

    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const dir = path.join(this.root, String(y), m);
    await fs.mkdir(dir, { recursive: true });

    // 扩展名由白名单映射，不信任原始文件名（防 .html/.svg/.jsp 等脚本扩展名）
    const fileName = randomUUID() + type.ext;
    const abs = path.join(dir, fileName);
    await fs.writeFile(abs, buffer);

    const filePath = `/uploads/${y}/${m}/${fileName}`;
    const fileType = type.mime === 'application/pdf' ? 'pdf' : 'image';
    return { filePath, fileName, fileType };
  }
}
