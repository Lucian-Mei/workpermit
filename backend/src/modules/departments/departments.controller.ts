import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { PermissionGuard } from '@/common/guards/permission.guard';
import { RequirePerms } from '@/common/decorators/permissions.decorator';
import { DepartmentsService, DeptDto } from './departments.service';

@Controller('departments')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePerms('department:manage')
export class DepartmentsController {
  constructor(private depts: DepartmentsService) {}

  @Get()
  list() {
    return this.depts.list();
  }

  @Post()
  create(@Body() dto: DeptDto) {
    return this.depts.create(dto);
  }

  @Post('import')
  importRows(@Body() body: { rows: any[] }) {
    return this.depts.import(body.rows || []);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: Partial<DeptDto>) {
    return this.depts.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.depts.remove(id);
  }
}
