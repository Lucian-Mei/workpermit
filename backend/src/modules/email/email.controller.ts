import { Controller, Get, Put, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { PermissionGuard } from '@/common/guards/permission.guard';
import { RequirePerms } from '@/common/decorators/permissions.decorator';
import { EmailService } from './email.service';

@Controller('email')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePerms('email:manage')
export class EmailController {
  constructor(private svc: EmailService) {}

  @Get('config')
  getConfig() {
    return this.svc.getConfig();
  }

  @Put('config')
  saveConfig(@Body() dto: any) {
    return this.svc.saveConfig(dto);
  }

  @Get('templates')
  getTemplates() {
    return this.svc.getTemplates();
  }

  @Put('templates')
  saveTemplates(@Body() dto: any) {
    return this.svc.saveTemplates(dto);
  }

  @Post('test')
  test(@Body() dto: { to: string }) {
    return this.svc.test(dto.to);
  }
}
