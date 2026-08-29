import { Controller, Get, Put, Param, Body, UseGuards, HttpCode } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { PermissionGuard } from '@/common/guards/permission.guard';
import { RequirePerms } from '@/common/decorators/permissions.decorator';
import { SettingsService } from './settings.service';

@Controller('settings')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class SettingsController {
  constructor(private svc: SettingsService) {}

  @Get('config')
  @RequirePerms('config:manage')
  @HttpCode(200)
  async list() {
    return this.svc.list();
  }

  @Get('config/:key')
  @RequirePerms('config:manage')
  @HttpCode(200)
  async get(@Param('key') key: string) {
    return this.svc.get(key);
  }

  @Put('config/:key')
  @RequirePerms('config:manage')
  @HttpCode(200)
  async save(@Param('key') key: string, @Body() body: { value: string }) {
    return this.svc.save(key, body.value);
  }
}
