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
import { WorkPermitsService } from './work-permits.service';

/**
 * 作业票（移动端优先）。
 * 复用 WorkPermitsService，但所有写/读均固定 channel='electronic'，
 * 与纸质作业票（work-permits，channel='paper'）数据完全隔离。
 */
@Controller('e-permits')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class EPermitsController {
  constructor(private svc: WorkPermitsService) {}

  @Post()
  @RequirePerms('epermit:create')
  @HttpCode(200)
  async create(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.createDraft(body, user, 'electronic');
  }

  @Get('measure-templates')
  @RequirePerms('epermit:create', 'epermit:view_all', 'epermit:view_own')
  @HttpCode(200)
  async measureTemplates(@Query('type') type: string) {
    return this.svc.getMeasureTemplates(type || 'other');
  }

  @Put(':id/measure-selections')
  @RequirePerms('epermit:create', 'epermit:onsite_check')
  @HttpCode(200)
  async saveMeasureSelections(@Param('id') id: string, @Body() body: any) {
    return this.svc.saveMeasureSelections(id, body.items || []);
  }

  @Post(':id/ai-analyze')
  @RequirePerms('epermit:create')
  @HttpCode(200)
  async aiAnalyze(@Param('id') id: string) {
    return this.svc.aiAnalyze(id);
  }

  // AI JSA 工作安全分析（按作业步骤逐一分析危害与措施）；纯 AI 调用，不依赖具体作业票
  @Post('ai-jsa')
  @RequirePerms('epermit:create')
  @HttpCode(200)
  async aiJsa(@Body() body: { content?: string; steps?: string[]; type?: string }) {
    return { jsas: await this.svc.aiAnalyzeJsa(body) };
  }

  @Put(':id')
  @RequirePerms('epermit:create')
  @HttpCode(200)
  async update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.update(id, body, user);
  }

  @Post(':id/certificates')
  @RequirePerms('epermit:create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @HttpCode(200)
  async uploadCert(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('issuer') issuer: string,
  ) {
    if (!file) throw new BadRequestException('未收到文件');
    return this.svc.uploadCertificate(id, file, issuer);
  }

  @Put(':id/certificates/:certId/confirm')
  @RequirePerms('epermit:review')
  @HttpCode(200)
  async confirmCert(@Param('certId') certId: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.confirmCertificate(certId, body, user);
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

  // 会签第 2 步：EHS工程师审批（危险作业票）
  @Put(':id/approve-ehs')
  @RequirePerms('epermit:approve_ehs')
  @HttpCode(200)
  async approveEhs(@Param('id') id: string, @Body() body: { approve: boolean; opinion?: string }, @CurrentUser() user: any) {
    return this.svc.approveEhs(id, body, user);
  }

  // 会签第 3 步：工程部经理批准
  @Put(':id/approve')
  @RequirePerms('epermit:approve_mgr', 'epermit:approve')
  @HttpCode(200)
  async approve(@Param('id') id: string, @Body() body: { approve: boolean; opinion?: string }, @CurrentUser() user: any) {
    return this.svc.approve(id, body, user);
  }

  // 生成二维码手机签字令牌（承包商陪同签字/扫码签字）
  @Post(':id/sign-tokens')
  @RequirePerms('epermit:onsite_check', 'epermit:create')
  @HttpCode(200)
  async createSignToken(@Param('id') id: string, @Body() body: any) {
    return this.svc.createSignToken(id, body || {});
  }

  // 续期/重发培训二维码：默认 3 天，可选 1/3/7/14/30
  @Post(':id/training-qr')
  @RequirePerms('epermit:onsite_check', 'epermit:create', 'epermit:print')
  @HttpCode(200)
  async renewTrainingQr(@Param('id') id: string, @Body() body: { days?: number }) {
    return this.svc.renewTrainingQr(id, body || {});
  }

  // 打印：仅计数留痕，不改变流程状态（打印已与流程解耦）
  @Put(':id/print')
  @RequirePerms('epermit:print')
  @HttpCode(200)
  async markPrinted(@Param('id') id: string) {
    return this.svc.markPrinted(id);
  }

  // 开始作业：approved → printed(执行中)，现场开工的唯一入口
  @Put(':id/start')
  @RequirePerms('epermit:onsite_check', 'epermit:create')
  @HttpCode(200)
  async start(@Param('id') id: string, @CurrentUser() user: any) {
    return this.svc.start(id, user);
  }

  // P0-8：手动关联/换绑常规作业票（body: { routineId: string | null }）
  @Put(':id/link-routine')
  @RequirePerms('epermit:create')
  @HttpCode(200)
  async linkRoutine(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.linkRoutine(id, body?.routineId ?? null, user);
  }

  @Post(':id/checks')
  @RequirePerms('epermit:onsite_check')
  @HttpCode(200)
  async addCheck(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.addCheck(id, body, user);
  }

  @Get(':id/checks')
  @RequirePerms('epermit:view_all', 'epermit:view_own')
  @HttpCode(200)
  async listChecks(@Param('id') id: string) {
    return this.svc.listChecks(id);
  }

  // 危险作业提交前现场检查（单表合并后由作业票承载，原仅存在于申请单）
  @Post(':id/inspections')
  @RequirePerms('epermit:create', 'epermit:onsite_check')
  @HttpCode(200)
  async saveSiteInspection(@Param('id') id: string, @Body() body: any) {
    return this.svc.saveSiteInspection(id, body);
  }

  @Get(':id/inspections')
  @RequirePerms('epermit:view_all', 'epermit:view_own')
  @HttpCode(200)
  async listInspections(@Param('id') id: string) {
    return this.svc.listInspections(id);
  }

  // 纸质巡检记录扫描件 → OCR 回填
  @Post(':id/inspections/ocr')
  @RequirePerms('epermit:onsite_check', 'epermit:create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @HttpCode(200)
  async addInspectionByOcr(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    if (!file) throw new BadRequestException('未收到文件');
    return this.svc.addInspectionByOcr(id, file, user);
  }

  @Delete(':id/inspections/:inspId')
  @RequirePerms('epermit:onsite_check')
  @HttpCode(200)
  async removeInspection(@Param('id') id: string, @Param('inspId') inspId: string) {
    return this.svc.removeInspection(id, inspId);
  }

  // ===== 安全交底（单表合并后挂作业票，一张票一份）=====
  @Post(':id/briefing/generate')
  @RequirePerms('epermit:onsite_check', 'epermit:create', 'epermit:view_all')
  @HttpCode(200)
  async generateBriefing(@Param('id') id: string) {
    return this.svc.generateBriefingDraft(id);
  }

  @Get(':id/briefing')
  @RequirePerms('epermit:onsite_check', 'epermit:view_all', 'epermit:view_own')
  @HttpCode(200)
  async getBriefing(@Param('id') id: string) {
    return this.svc.getBriefing(id);
  }

  @Put(':id/briefing')
  @RequirePerms('epermit:onsite_check', 'epermit:create')
  @HttpCode(200)
  async upsertBriefing(@Param('id') id: string, @Body() body: any) {
    return this.svc.upsertBriefing(id, body);
  }

  @Post(':id/briefing/submit')
  @RequirePerms('epermit:onsite_check', 'epermit:create')
  @HttpCode(200)
  async submitBriefing(@Param('id') id: string, @Body() body: any) {
    return this.svc.submitBriefing(id, body);
  }

  @Post(':id/briefing/ai-hazards')
  @RequirePerms('epermit:onsite_check', 'epermit:create')
  @HttpCode(200)
  async aiBriefingHazards(@Param('id') id: string) {
    return this.svc.aiSuggestHazards(id);
  }

  // ===== 承包商安全培训记录（挂作业票）=====
  @Post(':id/training')
  @RequirePerms('epermit:create', 'epermit:onsite_check')
  @HttpCode(200)
  async upsertTraining(@Param('id') id: string, @Body() body: any) {
    return this.svc.upsertTraining(id, body);
  }

  @Post(':id/training/sign-tokens')
  @RequirePerms('epermit:create', 'epermit:onsite_check')
  @HttpCode(200)
  async createTrainingSignToken(@Param('id') id: string) {
    return this.svc.createTrainingSignToken(id);
  }

  @Post(':id/training/complete-sign')
  @RequirePerms('epermit:create', 'epermit:onsite_check')
  @HttpCode(200)
  async completeTrainingSign(@Param('id') id: string) {
    return this.svc.completeTrainingSign(id);
  }

  @Post(':id/signatures')
  @RequirePerms('epermit:onsite_check')
  @HttpCode(200)
  async addSignature(@Param('id') id: string, @Body() body: any) {
    return this.svc.addSignature(id, body);
  }

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

  @Get()
  @RequirePerms('epermit:view_all', 'epermit:view_own')
  @HttpCode(200)
  async list(@Query() query: any, @CurrentUser() user: any) {
    return this.svc.list({ ...query, channel: 'electronic' }, user);
  }

  @Get('entry-records')
  @RequirePerms('epermit:view_all', 'epermit:view_own')
  @HttpCode(200)
  async entryRecords(@Query() query: any) {
    return this.svc.entryRecords(query);
  }

  // 入场记录按 ID 离厂签出（管理后台：表格在厂记录一键签出，无需重填姓名/证件号）
  @Post('entry-records/:id/sign-out')
  @RequirePerms('epermit:view_all', 'epermit:view_own')
  @HttpCode(200)
  async entrySignOut(@Param('id') id: string) {
    return this.svc.entrySignOut(id);
  }

  // P0-8：可供危险作业票关联的常规作业票候选（已批准且未完成）
  // 注意：必须声明在 @Get(':id') 之前，否则会被通配路由吃掉
  @Get('linkable-routines')
  @RequirePerms('epermit:view_all', 'epermit:view_own', 'epermit:create')
  @HttpCode(200)
  async linkableRoutines(@Query() query: any, @CurrentUser() user: any) {
    return this.svc.linkableRoutines(user, query);
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
  async myPermits(@Query() query: any, @CurrentUser() user: any) {
    return this.svc.list({ ...query, channel: 'electronic', scope: 'mine' }, user);
  }

  @Get('stats')
  @RequirePerms('epermit:view_all', 'epermit:view_own')
  @HttpCode(200)
  async stats() {
    return this.svc.stats('electronic');
  }

  // 消息中心 4 类任务计数（按当前用户过滤）：审批/检查/交底/签字
  @Get('notifications')
  @RequirePerms('epermit:view_own', 'epermit:view_all')
  @HttpCode(200)
  async notifications(@CurrentUser() user: any) {
    return this.svc.notifications(user);
  }

  // 电子票 6 类生命周期卡片计数（审批中/交底中/作业中/已完成/已归档/全部）
  @Get('category-stats')
  @RequirePerms('epermit:view_all', 'epermit:view_own')
  @HttpCode(200)
  async categoryStats(@Query() query: any, @CurrentUser() user: any) {
    return this.svc.categoryStats({ ...query, channel: 'electronic' }, user);
  }

  // 今日作业看板（大屏 / 手机端共用数据源）
  // 声明在 @Get(':id') 之前，避免被通配路由吃掉
  @Get('board/today')
  @RequirePerms('epermit:view_all', 'epermit:view_own', 'board:view')
  @HttpCode(200)
  async boardToday(@Query('date') date: string) {
    return this.svc.board(date, 'electronic');
  }

  // 年度作业统计
  @Get('stats/annual')
  @RequirePerms('work_permit:view_all')
  @HttpCode(200)
  async annualStats(@Query('year') year: string) {
    return this.svc.annualStats(year ? Number(year) : undefined);
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

  // 归档后补交材料（过程检查记录等）：清除「资料缺少」标签
  @Post(':id/materials')
  @RequirePerms('epermit:create')
  @HttpCode(200)
  async completeMaterials(@Param('id') id: string, @Body() body: { note?: string }, @CurrentUser() user: any) {
    return this.svc.completeMaterials(id, body, user);
  }

  // 一次性维护：游离危险票回填关联常规票（按创建时间就近挂靠 + 时间截断），幂等
  @Post('admin/backfill-links')
  @RequirePerms('epermit:view_all')
  @HttpCode(200)
  async backfillLinks() {
    return this.svc.backfillFreeHazardLinks();
  }

  // 一次性维护：清理 ZY 旧格式历史作业票（种子遗留）
  @Post('admin/cleanup-legacy-zy')
  @RequirePerms('epermit:view_all')
  @HttpCode(200)
  async cleanupLegacyZy() {
    return this.svc.cleanupLegacyZy();
  }
}
