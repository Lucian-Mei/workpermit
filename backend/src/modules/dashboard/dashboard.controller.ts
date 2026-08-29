import { Controller, Get, UseGuards, HttpCode } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { PermissionGuard } from '@/common/guards/permission.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DashboardController {
  constructor(private svc: DashboardService) {}

  // 仪表盘是登录后的首页，所有已登录用户都应能查看自己的看板；
  // 数据可见范围已由 overview(user) 按角色（全厂/本部门/自己）自动过滤，无需再用 dashboard:view 设卡。
  @Get('overview')
  @HttpCode(200)
  async overview(@CurrentUser() user: any) {
    return this.svc.overview(user);
  }

  @Get('todos')
  @HttpCode(200)
  async todos(@CurrentUser() user: any) {
    return this.svc.todos(user);
  }
}
