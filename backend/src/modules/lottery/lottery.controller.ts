import { Controller, Get, Put, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { PermissionGuard } from '@/common/guards/permission.guard';
import { RequirePerms } from '@/common/decorators/permissions.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { LotteryService } from './lottery.service';

@Controller('lottery')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class LotteryController {
  constructor(private svc: LotteryService) {}

  @Get('config')
  @RequirePerms('lottery:manage')
  getConfig() {
    return this.svc.getConfig();
  }

  @Put('config')
  @RequirePerms('lottery:manage')
  saveConfig(@Body() dto: any) {
    return this.svc.saveConfig(dto);
  }

  // 抽奖（登录即可参与）
  @Post('draw')
  @UseGuards(JwtAuthGuard)
  draw(@CurrentUser() user: any, @Body() body?: any) {
    return this.svc.draw(user, body);
  }

  // 我的中奖（登录即可查询）
  @Get('my')
  @UseGuards(JwtAuthGuard)
  myWins(@CurrentUser() user: any) {
    return this.svc.myRecords(user.userId);
  }
}
