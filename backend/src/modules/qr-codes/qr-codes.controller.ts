import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { PermissionGuard } from '@/common/guards/permission.guard';
import { RequirePerms } from '@/common/decorators/permissions.decorator';
import { QrCodesService, QrCodeDto } from './qr-codes.service';

@Controller('qr-codes')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePerms('qr:manage')
export class QrCodesController {
  constructor(private svc: QrCodesService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  create(@Body() dto: QrCodeDto) {
    return this.svc.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: Partial<QrCodeDto>) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
