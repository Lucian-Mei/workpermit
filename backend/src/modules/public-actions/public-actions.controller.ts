import { Controller, Get, Post, Param, Query, Body, Req, HttpCode, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '@/common/decorators/public.decorator';
import { PublicActionsService } from './public-actions.service';

// 全部为免登录公开接口（邮件审批 / 二维码签字 / 扫码培训 / 入厂登记）。
// 【2026-08 收敛】仅返回 JSON，页面统一由 React SPA 渲染（/public/* 前端路由），
// 彻底移除后端内嵌 HTML 页面（审批/签字/培训/入场），消除与前端 React 页面的重复实现。
@Public()
@Controller('public')
export class PublicActionsController {
  constructor(private svc: PublicActionsService) {}

  // 入厂登记：获取进行中的作业任务列表（看板QR无token显示全部；培训二维码带token时只显示对应任务）
  @Get('worker-register/tasks')
  async getActiveTasks(@Query('token') token?: string) {
    return this.svc.getActiveApplications(token);
  }

  // 入厂登记：工人注册 + 培训核验
  @Post('worker-register')
  @HttpCode(200)
  async workerRegister(@Body() body: { applicationId: string; contractorUnit: string; workerName: string; workerPhone?: string; workerIdCard?: string; signImg?: string }) {
    return this.svc.workerRegister(body);
  }

  // 入厂核验：获取作业单信息
  @Get('entry/:token')
  async getEntryInfo(@Param('token') token: string) {
    return this.svc.getEntryInfo(token);
  }

  // 入厂核验：提交姓名电话
  @Post('entry/:token')
  @HttpCode(200)
  async submitEntry(@Param('token') token: string, @Body() body: { name: string; phone?: string }) {
    if (!body.name?.trim()) throw new BadRequestException('请填写姓名');
    return this.svc.submitEntry(token, body.name.trim(), body.phone?.trim());
  }

  // 作业代码入场签到（前端 EntryCheckIn 使用，纯 JSON）
  @Post('entry-by-code')
  @HttpCode(200)
  async entryByCode(@Body() body: { workCode: string; name: string; idCard: string; action?: 'in' | 'out'; gate?: string; phone?: string; confirmed?: boolean }) {
    if (!body.workCode || !body.name || !body.idCard) throw new BadRequestException('请输入作业代码、姓名和身份证号');
    return this.svc.entryByCode(body.workCode, body.name, body.idCard, body.action || 'in', body.gate, body.phone, body.confirmed);
  }

  // 离厂签出（不依赖作业代码）：按 姓名 + 身份证/手机号 匹配在厂记录，签出后返回带日期凭证
  @Post('entry-signout')
  @HttpCode(200)
  async entrySignout(@Body() body: { name: string; idCard?: string; phone?: string }) {
    if (!body.name || !String(body.name).trim()) throw new BadRequestException('请填写姓名');
    return this.svc.entrySignout(body.name.trim(), body.idCard?.trim(), body.phone?.trim());
  }

  // ===== 培训公开端点（手机扫码进入；页面由前端 /training/exam 渲染）=====
  @Get('training/:token')
  async trainingInfo(@Param('token') token: string) {
    return this.svc.getTrainingInfo(token);
  }

  @Post('training/:token/exam-start')
  @HttpCode(200)
  async startTrainingExam(@Param('token') token: string, @Body() body: { name: string; idCard: string }) {
    if (!body.name || !body.idCard) throw new BadRequestException('请输入姓名和身份证号');
    return this.svc.startTrainingExam(token, body.name, body.idCard);
  }

  @Post('training/:token/exam-submit')
  @HttpCode(200)
  async submitTrainingExam(
    @Param('token') token: string,
    @Body() body: { examToken: string; answers: Record<string, string>; name: string; idCard: string },
  ) {
    return this.svc.submitTrainingExam(token, body.examToken, body.name, body.idCard, body.answers);
  }

  // 邮件内"同意/拒绝"落地页数据：GET 仅展示信息，执行一律走 POST（S09，防邮件网关预取误审批）
  @Get('approval/:token')
  async approvalInfo(@Param('token') token: string) {
    return this.svc.getApprovalInfo(token);
  }

  // 同一链接的 POST 提交（React 页面按钮触发）——唯一执行审批的通道
  @Post('approval/:token')
  @HttpCode(200)
  async approvalPost(@Param('token') token: string, @Body() body: { action?: string }, @Req() req: Request) {
    const action = body.action === 'reject' ? 'reject' : 'approve';
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    const ua = (req.headers['user-agent'] || '').toString().slice(0, 200);
    return this.svc.executeApproval(token, action as any, { ip, ua });
  }

  // 二维码手机签字数据（前端 PublicSign 消费）
  @Get('sign/:token')
  async signInfo(@Param('token') token: string) {
    return this.svc.getSignInfo(token);
  }

  // 提交手机签字
  @Post('sign/:token')
  @HttpCode(200)
  async signSubmit(@Param('token') token: string, @Body() body: { name?: string; role?: string; signImg?: string }) {
    if (!body.signImg) throw new BadRequestException('请先手写签名');
    return this.svc.submitSign(token, body as any);
  }
}
