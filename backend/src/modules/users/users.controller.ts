import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { PermissionGuard } from '@/common/guards/permission.guard';
import { RequirePerms } from '@/common/decorators/permissions.decorator';
import { UsersService, CreateUserDto } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePerms('user:manage')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  list(
    @Query('keyword') keyword?: string,
    @Query('department') department?: string,
    @Query('status') status?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize = 20,
  ) {
    return this.users.list({ keyword, department, status, page, pageSize });
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Post('import')
  importRows(@Body() body: { rows: any[] }) {
    return this.users.import(body.rows || []);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateUserDto>) {
    return this.users.update(id, dto);
  }

  @Post(':id/reset-password')
  resetPassword(@Param('id') id: string) {
    return this.users.resetPassword(id);
  }

  @Post(':id/disable')
  disable(@Param('id') id: string) {
    return this.users.disable(id);
  }

  @Post(':id/enable')
  enable(@Param('id') id: string) {
    return this.users.enable(id);
  }
}
