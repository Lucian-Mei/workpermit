import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { PermissionGuard } from '@/common/guards/permission.guard';
import { RequirePerms } from '@/common/decorators/permissions.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { WorkPermitApplicationsService } from './work-permit-applications.service';

/**
 * 电子化作业申请单（移动端优先）。
 * 复用 WorkPermitApplicationsService，所有写/读固定 channel='electronic'，与纸质申请单数据隔离。
 */
@Controller('e-applications')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class EApplicationsController {
  constructor(private svc: WorkPermitApplicationsService) {}

  @Post()
  @RequirePerms('epermit:create')
  @HttpCode(200)
  async create(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.createDraft(body, user, 'electronic');
  }

  @Post(':id/training')
  @RequirePerms('epermit:create')
  @HttpCode(200)
  async upsertTraining(@Param('id') id: string, @Body() body: any) {
    return this.svc.upsertTraining(id, body);
  }

  // 电子化：培训手写签字（移动端采集 base64 签名）
  @Post(':id/training/sign')
  @RequirePerms('epermit:create', 'epermit:onsite_check')
  @HttpCode(200)
  async signTraining(@Param('id') id: string, @Body() body: any) {
    return this.svc.signTraining(id, body);
  }

  // 生成培训签字二维码令牌（多人共用，72 小时有效）
  @Post(':id/training/sign-tokens')
  @RequirePerms('epermit:create', 'epermit:onsite_check')
  @HttpCode(200)
  async createTrainingSignToken(@Param('id') id: string) {
    return this.svc.createTrainingSignToken(id);
  }

  // 培训人点击“完成培训签到”
  @Post(':id/training/complete-sign')
  @RequirePerms('epermit:create', 'epermit:onsite_check')
  @HttpCode(200)
  async completeTrainingSign(@Param('id') id: string) {
    return this.svc.completeTrainingSign(id);
  }

  @Put(':id')
  @RequirePerms('epermit:create')
  @HttpCode(200)
  async update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.update(id, body, user);
  }

  @Post(':id/submit')
  @RequirePerms('epermit:create')
  @HttpCode(200)
  async submit(@Param('id') id: string, @CurrentUser() user: any) {
    return this.svc.submit(id, user);
  }

  @Put(':id/review')
  @RequirePerms('epermit:review')
  @HttpCode(200)
  async review(@Param('id') id: string, @Body() body: { approve: boolean; opinion?: string }, @CurrentUser() user: any) {
    return this.svc.review(id, body, user);
  }

  @Put(':id/approve')
  @RequirePerms('epermit:approve')
  @HttpCode(200)
  async approve(@Param('id') id: string, @Body() body: { approve: boolean; opinion?: string }, @CurrentUser() user: any) {
    return this.svc.approve(id, body, user);
  }

  @Put(':id/print')
  @RequirePerms('epermit:print')
  @HttpCode(200)
  async markPrinted(@Param('id') id: string) {
    return this.svc.markPrinted(id);
  }

  // ===== 安全交底（挂作业申请单）=====
  @Post(':id/briefing/generate')
  @RequirePerms('epermit:create', 'epermit:onsite_check')
  @HttpCode(200)
  async generateBriefing(@Param('id') id: string) {
    return this.svc.generateBriefingDraft(id);
  }

  @Put(':id/briefing')
  @RequirePerms('epermit:create', 'epermit:onsite_check')
  @HttpCode(200)
  async upsertBriefing(@Param('id') id: string, @Body() body: any) {
    return this.svc.upsertBriefing(id, body);
  }

  @Post(':id/briefing/submit')
  @RequirePerms('epermit:onsite_check')
  @HttpCode(200)
  async submitBriefing(@Param('id') id: string, @Body() body: any) {
    return this.svc.submitBriefing(id, body);
  }

  @Get(':id/briefing')
  @RequirePerms('epermit:view_all', 'epermit:view_own')
  @HttpCode(200)
  async getBriefing(@Param('id') id: string) {
    return this.svc.getBriefing(id);
  }

  // AI 智能识别危害（交底页风险打"推荐"标）：基于作业内容 + JSA 分析
  @Post(':id/briefing/ai-hazards')
  @RequirePerms('epermit:onsite_check', 'epermit:create')
  @HttpCode(200)
  async aiSuggestHazards(@Param('id') id: string) {
    return this.svc.aiSuggestHazards(id);
  }

  // ===== 巡检记录 =====
  @Post(':id/inspections')
  @RequirePerms('epermit:onsite_check')
  @HttpCode(200)
  async addInspection(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.addInspection(id, body, user);
  }

  @Post(':id/inspections/ocr')
  @RequirePerms('epermit:onsite_check')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @HttpCode(200)
  async addInspectionOcr(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @CurrentUser() user: any) {
    if (!file) throw new BadRequestException('未收到文件');
    return this.svc.addInspectionByOcr(id, file, user);
  }

  @Get(':id/inspections')
  @RequirePerms('epermit:view_all', 'epermit:view_own')
  @HttpCode(200)
  async listInspections(@Param('id') id: string) {
    return this.svc.listInspections(id);
  }

  @Delete(':id/inspections/:inspId')
  @RequirePerms('epermit:onsite_check')
  @HttpCode(200)
  async removeInspection(@Param('inspId') inspId: string) {
    return this.svc.removeInspection(inspId);
  }

  // ===== 执行态流转 =====
  @Put(':id/pause')
  @RequirePerms('epermit:pause')
  @HttpCode(200)
  async pause(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.pause(id, body, user);
  }

  @Put(':id/resume')
  @RequirePerms('epermit:pause')
  @HttpCode(200)
  async resume(@Param('id') id: string, @CurrentUser() user: any) {
    return this.svc.resume(id, user);
  }

  @Put(':id/void')
  @RequirePerms('epermit:void')
  @HttpCode(200)
  async void(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.void(id, body, user);
  }

  @Put(':id/finish')
  @RequirePerms('epermit:onsite_check')
  @HttpCode(200)
  async finish(@Param('id') id: string) {
    return this.svc.finish(id);
  }

  @Put(':id/archive')
  @RequirePerms('epermit:print', 'epermit:onsite_check')
  @HttpCode(200)
  async archive(@Param('id') id: string) {
    return this.svc.archive(id);
  }

  @Put(':id/daily-override')
  @RequirePerms('epermit:onsite_check', 'epermit:pause')
  @HttpCode(200)
  async setDailyOverride(@Param('id') id: string, @Body() body: any) {
    return this.svc.setDailyOverride(id, body);
  }

  // ===== 看板 / 统计 =====
  @Get('board/today')
  @RequirePerms('epermit:view_all', 'epermit:view_own')
  @HttpCode(200)
  async board(@Query('date') date: string) {
    return this.svc.board(date, 'electronic');
  }

  @Get('stats/annual')
  @RequirePerms('epermit:view_all')
  @HttpCode(200)
  async annualStats(@Query('year') year: string) {
    return this.svc.annualStats(year ? Number(year) : undefined);
  }

  @Get()
  @RequirePerms('epermit:view_all', 'epermit:view_own')
  @HttpCode(200)
  async list(@Query() query: any, @CurrentUser() user: any) {
    return this.svc.list({ ...query, channel: 'electronic' }, user);
  }

  @Get('my/history')
  @RequirePerms('epermit:view_own')
  @HttpCode(200)
  async myHistory(@CurrentUser() user: any) {
    return this.svc.myHistory(user.userId);
  }

  @Get('my')
  @RequirePerms('epermit:view_own', 'epermit:view_all')
  @HttpCode(200)
  async myApplications(@Query() query: any, @CurrentUser() user: any) {
    return this.svc.list({ ...query, channel: 'electronic', scope: 'mine' }, user);
  }

  @Get('stats')
  @RequirePerms('epermit:view_all', 'epermit:view_own')
  @HttpCode(200)
  async stats() {
    return this.svc.stats('electronic');
  }

  @Get(':id')
  @RequirePerms('epermit:view_all', 'epermit:view_own')
  @HttpCode(200)
  async detail(@Param('id') id: string, @CurrentUser() user: any) {
    return this.svc.getDetail(id, user);
  }

  @Delete(':id')
  @RequirePerms('epermit:create')
  @HttpCode(200)
  async remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
