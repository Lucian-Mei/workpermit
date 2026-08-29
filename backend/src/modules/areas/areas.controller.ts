import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { PermissionGuard } from '@/common/guards/permission.guard';
import { RequirePerms } from '@/common/decorators/permissions.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { AreasService, AreaDto } from './areas.service';

@Controller('areas')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePerms('area:manage')
export class AreasController {
  constructor(private svc: AreasService) {}

  // 区域列表为只读参考数据，匿名免登录上报页需要拉取区域下拉，故放行
  @Public()
  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  create(@Body() dto: AreaDto) {
    return this.svc.create(dto);
  }

  @Post('import')
  importRows(@Body() body: { rows: any[] }) {
    return this.svc.import(body.rows || []);
  }

  // 一键为所有启用区域补齐上报二维码
  @Post('ensure-qr-codes')
  ensureAll() {
    return this.svc.ensureAllQrCodes();
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: Partial<AreaDto>) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
