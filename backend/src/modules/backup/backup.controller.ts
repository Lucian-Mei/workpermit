import { Controller, Post, Get, Put, Delete, Param, Body, Res, UseGuards, HttpCode, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { PermissionGuard } from '@/common/guards/permission.guard';
import { RequirePerms } from '@/common/decorators/permissions.decorator';
import { BackupService } from './backup.service';

@Controller('backup')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class BackupController {
  constructor(private svc: BackupService) {}

  @Get('config')
  @RequirePerms('backup:download')
  @HttpCode(200)
  getConfig() {
    return this.svc.getConfig();
  }

  @Put('config')
  @RequirePerms('backup:download')
  @HttpCode(200)
  saveConfig(@Body() dto: any) {
    return this.svc.saveConfig(dto);
  }

  // 触发一次数据库备份并下载
  @Post('download')
  @RequirePerms('backup:download')
  @HttpCode(200)
  async download() {
    const { file, backupKind } = await this.svc.run('download');
    await this.svc.log('download', file);
    await this.svc.enforceRetention();
    return { file: '/backups/' + file.split(/[\\/]/).pop(), kind: backupKind };
  }

  // 同步到飞书多维表格
  @Post('feishu')
  @RequirePerms('backup:sync_feishu')
  @HttpCode(200)
  async feishu() {
    return this.svc.syncFeishu();
  }

  // 备份文件列表
  @Get('list')
  @RequirePerms('backup:download')
  @HttpCode(200)
  async list() {
    return this.svc.list();
  }

  // 删除备份文件（最新不能删）
  @Delete(':name')
  @RequirePerms('backup:download')
  @HttpCode(200)
  async deleteBackup(@Param('name') name: string) {
    return this.svc.deleteBackup(name);
  }

  // 下载具体备份文件
  @Get('file/:name')
  @RequirePerms('backup:download')
  async file(@Param('name') name: string, @Res() res: Response) {
    try {
      const fp = await this.svc.pathOf(name);
      res.download(fp);
    } catch {
      throw new NotFoundException('备份文件不存在');
    }
  }

  @Get('logs')
  @RequirePerms('backup:download')
  @HttpCode(200)
  async logs() {
    return this.svc.lastLogs();
  }
}
