import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RequirePerms } from '@/common/decorators/permissions.decorator';
import { PermissionGuard } from '@/common/guards/permission.guard';
import { Public } from '@/common/decorators/public.decorator';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, gte, count, and, sql } from 'drizzle-orm';
import * as schema from '@/database/schema';
import { UseGuards, Req } from '@nestjs/common';
import { FilesService } from './files.service';

@Controller('files')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class FilesController {
  constructor(
    private files: FilesService,
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
  ) {}

  @Post('upload')
  @RequirePerms('hazard:create', 'work_permit:create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async upload(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException('未收到文件');
    const res = await this.files.save(file.buffer, file.originalname, file.mimetype);
    return { ...res, url: res.filePath };
  }

  // 微信扫码免登录上报用的公开图片上传（带 IP 限流）
  @Public()
  @Post('anonymous-upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async anonymousUpload(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException('未收到文件');
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [cnt] = await this.db
      .select({ c: count() })
      .from(schema.submissionLog)
      .where(and(eq(schema.submissionLog.clientIp, ip), gte(schema.submissionLog.submittedAt, oneHourAgo)));
    if (Number(cnt?.c ?? 0) >= 40) throw new BadRequestException('上传过于频繁，请稍后再试');
    const res = await this.files.save(file.buffer, file.originalname, file.mimetype);
    return { ...res, url: res.filePath };
  }
}
