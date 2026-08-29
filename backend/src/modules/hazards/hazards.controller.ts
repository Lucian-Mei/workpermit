import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  Sse,
} from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { PermissionGuard } from '@/common/guards/permission.guard';
import { RequirePerms } from '@/common/decorators/permissions.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { HazardsService } from './hazards.service';

@Controller('hazards')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class HazardsController {
  constructor(private svc: HazardsService) {}

  // 微信扫码免登录上报（公开，限流）
  @Public()
  @Post('anonymous')
  @HttpCode(200)
  async anonymous(@Body() body: any, @Req() req: any) {
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    return this.svc.createAnonymous(body, ip);
  }

  // 免登录上报验证码（公开，防机器人恶意填报）
  @Public()
  @Get('captcha')
  @HttpCode(200)
  async captcha() {
    return this.svc.issueCaptcha();
  }

  // 登录用户上报
  @Post()
  @RequirePerms('hazard:create')
  @HttpCode(200)
  async create(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.createByUser(body, user);
  }

  // AI 分析（不落库）
  // AI 分析（不落库；公开给免登录填报使用，IP 限流防滥用）
  @Public()
  @Post('analyze')
  @HttpCode(200)
  async analyze(@Body() body: any, @Req() req: any) {
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    await this.svc.assertAiRateLimit(ip);
    return this.svc.analyze(body);
  }

  // AI 分析（流式 SSE，逐 token 推送，前端可实时显示进度；公开给免登录填报，IP 限流）
  @Public()
  @Post('analyze/stream')
  @Sse()
  async analyzeStream(@Body() body: any, @Req() req: any): Promise<Observable<any>> {
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    await this.svc.assertAiRateLimit(ip);
    return from(this.svc.analyzeHazardStream(body)).pipe(map((chunk: string) => ({ data: chunk })));
  }

  // 把 AI 分析结果应用到某条隐患
  @Put(':id/ai')
  @RequirePerms('hazard:assign', 'hazard:accept')
  @HttpCode(200)
  async applyAi(@Param('id') id: string, @Body() body: any) {
    return this.svc.applyAi(id, body);
  }

  // 派单
  @Put(':id/assign')
  @RequirePerms('hazard:assign')
  @HttpCode(200)
  async assign(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.assign(id, body, user);
  }

  // 整改
  @Put(':id/rectify')
  @RequirePerms('hazard:rectify')
  @HttpCode(200)
  async rectify(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.rectify(id, body, user);
  }

  // 整改人员转发给部门内其他人员
  @Put(':id/forward')
  @RequirePerms('hazard:rectify')
  @HttpCode(200)
  async forward(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.forward(id, body, user);
  }

  // 整改人员退回给管理人员（重新派单）
  @Put(':id/return')
  @RequirePerms('hazard:rectify')
  @HttpCode(200)
  async returnToManager(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.returnToManager(id, body, user);
  }

  // 验收
  @Put(':id/accept')
  @RequirePerms('hazard:accept')
  @HttpCode(200)
  async accept(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.accept(id, body, user);
  }

  // 部门负责人审核确认（整改完成后、EHS 验收前的必经环节）
  @Put(':id/dept-review')
  @RequirePerms('hazard:dept_review', 'hazard:accept')
  @HttpCode(200)
  async deptReview(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.deptReview(id, body, user);
  }

  // 管理员直接归档（已完成）
  @Put(':id/archive')
  @RequirePerms('hazard:archive')
  @HttpCode(200)
  async archive(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.archive(id, body, user);
  }

  // 撤销
  @Put(':id/cancel')
  @RequirePerms('hazard:assign')
  @HttpCode(200)
  async cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.svc.cancel(id, user);
  }

  // 某部门内用户（用于整改转发选择）
  @Get('departments/:deptId/users')
  @HttpCode(200)
  async departmentUsers(@Param('deptId') deptId: string) {
    return this.svc.departmentUsers(deptId);
  }

  // 列表（按权限过滤）
  @Get()
  @RequirePerms('hazard:view_all', 'hazard:view_own', 'hazard:view_department')
  @HttpCode(200)
  async list(@Query() query: any, @CurrentUser() user: any) {
    return this.svc.list(query, user);
  }

  // 部门隐患（部门负责人）
  @Get('department')
  @RequirePerms('hazard:view_department')
  @HttpCode(200)
  async departmentList(@Query() query: any, @CurrentUser() user: any) {
    return this.svc.list({ ...query, scope: 'department' }, user);
  }

  @Get('department/stats')
  @RequirePerms('hazard:view_department')
  @HttpCode(200)
  async departmentStats(@CurrentUser() user: any) {
    return this.svc.departmentStats(user);
  }

  // 我的上报历史
  @Get('my/history')
  @RequirePerms('hazard:view_own', 'hazard:view_all', 'hazard:view_department')
  @HttpCode(200)
  async myHistory(@CurrentUser() user: any) {
    return this.svc.myHistory(user.userId);
  }

  // 我提交的隐患（前端「我的隐患」页签使用；必须在 @Get(':id') 之前，否则会被当成 id 解析为 UUID 失败）
  @Get('my')
  @RequirePerms('hazard:view_own', 'hazard:view_all', 'hazard:view_department')
  @HttpCode(200)
  async myHazards(@Query() query: any, @CurrentUser() user: any) {
    return this.svc.list({ ...query, scope: 'mine' }, user);
  }

  // 详情
  @Get('stats')
  @RequirePerms('hazard:view_all', 'hazard:view_own', 'hazard:view_department')
  @HttpCode(200)
  async stats() {
    return this.svc.stats();
  }

  @Get(':id')
  @RequirePerms('hazard:view_all', 'hazard:view_own', 'hazard:view_department')
  @HttpCode(200)
  async detail(@Param('id') id: string, @CurrentUser() user: any) {
    return this.svc.getDetail(id, user);
  }
}
