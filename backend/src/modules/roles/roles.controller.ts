import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { PermissionGuard } from '@/common/guards/permission.guard';
import { RequirePerms } from '@/common/decorators/permissions.decorator';
import { RolesService } from './roles.service';

@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePerms('role:manage')
export class RolesController {
  constructor(private roles: RolesService) {}

  @Get('permissions')
  permissions() {
    return this.roles.listPermissions();
  }

  @Get()
  list() {
    return this.roles.listRoles();
  }

  @Post()
  create(@Body() dto: { key: string; name: string; description?: string; permissions: string[] }) {
    return this.roles.createRole(dto);
  }

  @Put(':key/permissions')
  updatePerms(@Param('key') key: string, @Body() dto: { permissions: string[] }) {
    return this.roles.updateRolePerms(key, dto.permissions);
  }

  @Delete(':key')
  delete(@Param('key') key: string) {
    return this.roles.deleteRole(key);
  }
}
