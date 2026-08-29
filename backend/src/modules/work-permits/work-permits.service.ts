import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Inject, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, ilike, and, count, desc, or, gte, lt, sql, inArray, isNull, isNotNull, not } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import * as schema from '@/database/schema';
import { AiService } from '@/modules/ai/ai.service';
import { OcrService } from '@/modules/ocr/ocr.service';
import { FilesService } from '@/modules/files/files.service';
import { EmailService } from '@/modules/email/email.service';
import { TokensService } from '@/modules/tokens/tokens.service';
import { FeishuSyncService } from '@/modules/feishu-sync/feishu-sync.service';
import { getWorkPermitType, permitDurationLimitHours, permitNoPrefix, requiredSignRoles, SIGN_ROLES, WORK_PERMIT_TYPES } from '@/common/constants/domain';
import { isSuperAdmin } from '@/common/permissions';
import { emailByName, emailsByDepartment } from '@/common/user-helper';
import { appBaseUrl } from '@/common/base-url';
import { buildBriefingTemplate } from './briefing-template';
import {
  ChainNode,
  ChainStage,
  PermitKind,
  PERMIT_KIND_LABEL,
  advanceChain,
  chainTemplate,
  describeChain,
  evaluateRiskLevel,
  nextPending,
  permitKind,
  stageToStatus,
} from './approval-routing';

// 危险作业票三方顺序会签步骤定义（申请部门主管 -> EHS工程师 -> 工程部经理）
const APPROVAL_STEPS: Record<string, { label: string; nextStatus: string }> = {
  review: { label: '申请部门主管审核', nextStatus: 'ehs_reviewing' },
  approve_ehs: { label: 'EHS工程师审批', nextStatus: 'reviewing' },
  approve_mgr: { label: '工程部经理批准', nextStatus: 'approved' },
};

@Injectable()
export class WorkPermitsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('AutoArchive');
  private archiveTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    private ai: AiService,
    private ocr: OcrService,
    private files: FilesService,
    private email: EmailService,
    private tokens: TokensService,
    private feishu: FeishuSyncService,
  ) {}

  // R7：超期自动归档改为「启动时一次 + 每 6 小时一次」，不再每次列表/详情请求触发，避免大数据量下列表变慢
  async onModuleInit() {
    await this.autoArchiveExpired().catch((e) => this.logger.warn(`启动时归档失败：${e?.message}`));
    this.archiveTimer = setInterval(() => {
      this.autoArchiveExpired().catch((e) => this.logger.warn(`定时归档失败：${e?.message}`));
      this.purgeAbandonedDrafts().catch((e) => this.logger.warn(`清理废弃草稿失败：${e?.message}`));
    }, 6 * 3600 * 1000);
    if (typeof this.archiveTimer.unref === 'function') this.archiveTimer.unref();
    this.logger.log('超期自动归档已启动：启动时执行一次，此后每 6 小时一次');
  }

  /**
   * 清理废弃草稿：申请向导"按需建票"会在用户点保存/传证书/提现场检查时就占号建票，
   * 中途放弃会留下空草稿并永久占用 GWP-/HWP- 票号。
   * 安全边界：仅删除「状态为草稿 + 超过 7 天 + 作业内容/地点/作业名称全为空」的空白票，
   * 绝不触碰任何已填写内容的票据；整体 try/catch 包裹，失败只告警不影响服务。
   */
  async purgeAbandonedDrafts() {
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const rows = await this.db
      .select({ id: schema.workPermits.id })
      .from(schema.workPermits)
      .where(
        and(
          eq(schema.workPermits.status, 'draft'),
          lt(schema.workPermits.createdAt, cutoff),
          isNull(schema.workPermits.content),
          isNull(schema.workPermits.location),
          isNull(schema.workPermits.jobName),
        ),
      )
      .limit(200);
    if (rows.length === 0) return 0;
    for (const r of rows) {
      await this.db.delete(schema.workPermits).where(eq(schema.workPermits.id, r.id));
    }
    this.logger.log(`清理废弃空白草稿 ${rows.length} 张`);
    return rows.length;
  }

  onModuleDestroy() {
    if (this.archiveTimer) {
      clearInterval(this.archiveTimer);
      this.archiveTimer = null;
    }
  }

  // ======== 时限硬拦截（内部从严口径，依据 GB 30871-2022 与公司制度）========
  // 危险作业票（动火/受限空间/高处/吊装/挖掘/断路/盲板）≤24 小时；临时用电 ≤15 天。
  private validateDuration(type: string, start?: Date | string | null, end?: Date | string | null, ctx: 'submit' | 'update' = 'update') {
    const s = start ? new Date(start) : null;
    const e = end ? new Date(end) : null;
    if (!s || !e) {
      if (ctx === 'submit') throw new BadRequestException('请填写作业开始时间与结束时间');
      return;
    }
    if (e <= s) throw new BadRequestException('作业结束时间必须晚于开始时间');
    const limit = permitDurationLimitHours(type);
    if (limit != null) {
      const hours = (e.getTime() - s.getTime()) / 36e5;
      if (hours > limit + 1e-6) {
        const label = getWorkPermitType(type).label;
        const human = limit >= 48 && limit % 24 === 0 ? `${limit / 24} 天` : `${limit} 小时`;
        throw new BadRequestException(
          `${label}单张作业票有效期不得超过 ${human}（当前填写约 ${Math.ceil(hours)} 小时）。请缩短作业周期；确需延续的，应到期后重新办理作业许可。`,
        );
      }
    }
  }

  // 会签步骤邮件通知：向下一步审批人发送含“同意/拒绝”按钮的邮件（链接 48 小时有效）
  private async sendStepApprovalMail(wp: any, step: 'review' | 'approve_ehs' | 'approve_mgr') {
    try {
      const meta = APPROVAL_STEPS[step];
      const prefix = wp.channel === 'electronic' ? 'epermit' : 'work_permit';
      const stepPerms: Record<string, string[]> = {
        review: [`${prefix}:review`],
        approve_ehs: [`${prefix}:approve_ehs`],
        approve_mgr: [`${prefix}:approve_mgr`, `${prefix}:approve`],
      };
      const { token } = await this.tokens.create({
        purpose: 'email_approval',
        targetType: 'work_permit',
        targetId: wp.id,
        step,
        meta: { permitNo: wp.permitNo, channel: wp.channel },
        ttlHours: 48,
      });
      const base = appBaseUrl();
      const approvalPage = `${base}/public/approval/${token}`;
      await this.email?.notify('work_permit_step_approval', {
        permitNo: wp.permitNo,
        type: getWorkPermitType(wp.type).label,
        applicant: wp.applicantName || '',
        location: wp.location || '',
        stepLabel: meta.label,
        approveUrl: `${approvalPage}?action=approve`,
        rejectUrl: `${approvalPage}?action=reject`,
        actionUrl: `${base}/${wp.channel === 'electronic' ? 'e-permits' : 'work-permits'}`,
        perms: stepPerms[step],
      });
    } catch {
      /* 邮件失败不阻断业务 */
    }
  }

  /**
   * 生成作业票编号：{类型前缀}-{YYYYMM}-{4位月流水}
   * 常规作业 GWP-202608-0001；动火 HWP-202608-0001；受限空间 CSE-…（前缀表见 domain.ts）。
   * 流水按「前缀+月份」独立计数，不同作业类型互不干扰，便于分类台账与归档检索。
   * 旧格式（ZY202608xxxx / ZY-DM-A-xxxx）因前缀不同不会参与新流水计算，历史数据保持原样。
   */
  private async genPermitNo(type: string): Promise<string> {
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prefix = `${permitNoPrefix(type)}-${ym}-`;
    const rows = await this.db
      .select({ no: schema.workPermits.permitNo })
      .from(schema.workPermits)
      .where(ilike(schema.workPermits.permitNo, `${prefix}%`))
      .orderBy(desc(schema.workPermits.permitNo))
      .limit(1);
    let seq = 1;
    if (rows.length) {
      const num = parseInt(rows[0].no.slice(prefix.length), 10);
      if (!isNaN(num)) seq = num + 1;
    }
    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  // 创建草稿（申请人先填基本信息）
  // channel: 'paper' 纸质作业票（原流程）/ 'electronic' 作业票（移动端优先）
  async createDraft(dto: any, user: { userId: string; name: string; department?: string }, channel: 'paper' | 'electronic' = 'paper') {
    if (!dto.type) throw new BadRequestException('请选择作业类型');
    const t = getWorkPermitType(dto.type);
    // P0-8：危险作业票必须挂靠一张“已批准且未完成”的常规作业票（GWP）。
    // 由常规票详情页「继续开危险作业票」进入时自动带入 linkedRoutineId；
    // 从其他入口（作业票列表/新建页）进入时由用户手动选择，草稿阶段可为空，提交时强制校验。
    let linked: { id: string; permitNo: string } | null = null;
    if (t.isHazardous && dto.linkedRoutineId) {
      linked = await this.assertLinkableRoutine(dto.linkedRoutineId);
    }
    // 常规票申请仅填“预计作业人数”（第31轮第5条），非法值忽略
    const expected = Number(dto.expectedOperatorCount);
    const [wp] = await this.db
      .insert(schema.workPermits)
      .values({
        permitNo: await this.genPermitNo(dto.type),
        type: dto.type,
        isHazardous: t.isHazardous,
        applicantId: user.userId,
        applicantName: user.name,
        department: dto.department || user.department,
        linkedRoutineId: linked ? linked.id : null,
        linkedRoutineNo: linked ? linked.permitNo : null,
        expectedOperatorCount: !t.isHazardous && Number.isFinite(expected) && expected > 0 ? Math.floor(expected) : null,
        channel,
        status: 'draft',
      })
      .returning({ id: schema.workPermits.id, permitNo: schema.workPermits.permitNo, isHazardous: schema.workPermits.isHazardous });
    return wp;
  }

  // ===== P0-8：危险作业票 ↔ 常规作业票 手动关联 =====
  // 可关联的常规票 = 非特种(isHazardous=false) + 状态已批准且未完成(approved/printed/paused) + 未作废。
  // 「未完成」不含 finished/completed：作业已完工的常规票不允许再挂新的特殊票。
  private readonly LINKABLE_ROUTINE_STATUS = ['approved', 'printed', 'paused'];

  /** 校验目标常规票是否可被关联，通过返回 {id, permitNo}，否则抛 400 */
  private async assertLinkableRoutine(routineId: string): Promise<{ id: string; permitNo: string }> {
    const [r] = await this.db
      .select({
        id: schema.workPermits.id,
        permitNo: schema.workPermits.permitNo,
        status: schema.workPermits.status,
        isHazardous: schema.workPermits.isHazardous,
        endTime: schema.workPermits.endTime,
      })
      .from(schema.workPermits)
      .where(eq(schema.workPermits.id, routineId))
      .limit(1);
    if (!r) throw new BadRequestException('所选常规作业票不存在');
    if (r.isHazardous) throw new BadRequestException('只能关联常规作业票（GWP），不能关联危险作业票');
    if (!this.LINKABLE_ROUTINE_STATUS.includes(r.status)) {
      throw new BadRequestException(`常规作业票 ${r.permitNo} 当前状态为「${r.status}」，只有已批准且未完成的常规票可被关联`);
    }
    return { id: r.id, permitNo: r.permitNo };
  }

  /** 下拉候选：当前可供危险作业票关联的常规作业票列表 */
  async linkableRoutines(user: any, query: any = {}) {
    const conds: any[] = [
      eq(schema.workPermits.isHazardous, false),
      inArray(schema.workPermits.status, this.LINKABLE_ROUTINE_STATUS),
    ];
    // scope=mine：只看自己申请的（默认全局，便于代开）
    if (query.scope === 'mine' && user?.userId) conds.push(eq(schema.workPermits.applicantId, user.userId));
    if (query.keyword) {
      const kw = `%${query.keyword}%`;
      conds.push(
        or(
          ilike(schema.workPermits.permitNo, kw),
          ilike(schema.workPermits.content, kw),
          ilike(schema.workPermits.location, kw),
          ilike(schema.workPermits.applicantName, kw),
        ),
      );
    }
    const rows = await this.db
      .select({
        id: schema.workPermits.id,
        permitNo: schema.workPermits.permitNo,
        status: schema.workPermits.status,
        type: schema.workPermits.type,
        isHazardous: schema.workPermits.isHazardous,
        area: schema.workPermits.area,
        location: schema.workPermits.location,
        content: schema.workPermits.content,
        applicantName: schema.workPermits.applicantName,
        department: schema.workPermits.department,
        workCode: schema.workPermits.workCode,
        startTime: schema.workPermits.startTime,
        endTime: schema.workPermits.endTime,
        approvedAt: schema.workPermits.approvedAt,
        supervisorName: schema.workPermits.supervisorName,
        supervisorContact: schema.workPermits.supervisorContact,
        operatorNames: schema.workPermits.operatorNames,
        contractorUnit: schema.workPermits.contractorUnit,
        expectedOperatorCount: schema.workPermits.expectedOperatorCount,
        approvalChain: schema.workPermits.approvalChain,
        checksCount: sql<number>`(SELECT count(*) FROM work_permit_checks WHERE work_permit_id = ${schema.workPermits.id})`,
      })
      .from(schema.workPermits)
      .where(and(...conds))
      .orderBy(desc(schema.workPermits.approvedAt))
      .limit(Number(query.limit) || 50);
    // 补 typeLabel：作业类型中文标签，前端无需再做映射
    const items = rows.map((r: any) => ({
      ...r,
      typeLabel: r.isHazardous ? (WORK_PERMIT_TYPES[r.type]?.label || r.type) : '常规作业',
      isHazardous: !!r.isHazardous,
    }));
    return { items, total: rows.length };
  }

  /** 手动绑定/换绑常规票（仅草稿或被驳回的特殊票可改） */
  async linkRoutine(id: string, routineId: string | null, user: any) {
    const wp = await this.ensure(id);
    if (!wp.isHazardous) throw new BadRequestException('常规作业票无需关联');
    if (!['draft', 'rejected'].includes(wp.status)) {
      throw new BadRequestException('作业票已提交，无法修改关联的常规作业票');
    }
    if (!routineId) {
      await this.db
        .update(schema.workPermits)
        .set({ linkedRoutineId: null, linkedRoutineNo: null, updatedAt: new Date() })
        .where(eq(schema.workPermits.id, id));
      return { success: true, linkedRoutineId: null, linkedRoutineNo: null };
    }
    const linked = await this.assertLinkableRoutine(routineId);
    await this.db
      .update(schema.workPermits)
      .set({ linkedRoutineId: linked.id, linkedRoutineNo: linked.permitNo, updatedAt: new Date() })
      .where(eq(schema.workPermits.id, id));
    return { success: true, linkedRoutineId: linked.id, linkedRoutineNo: linked.permitNo };
  }

  // 申请时 AI JSA 工作安全分析：按作业步骤逐一返回 {step, hazard, control}，前端编辑后保存
  async aiAnalyzeJsa(dto: { content?: string; steps?: string[]; type?: string }) {
    const steps = Array.isArray(dto.steps) ? dto.steps.map((s) => String(s).trim()).filter(Boolean) : [];
    if (!dto.content && steps.length === 0) throw new BadRequestException('请先填写作业内容与作业步骤再分析');
    return this.ai.analyzeJsa({ content: dto.content || '', steps, type: dto.type });
  }

  // 申请时 AI 风险分析（点“AI分析”触发，返回风险与措施建议，不直接落库到措施表）
  async aiAnalyze(id: string) {
    const wp = await this.ensure(id);
    if (!wp.content) throw new BadRequestException('请先填写作业内容再分析');
    const res = await this.ai.analyzeWorkPermitRisk({
      type: wp.type,
      content: wp.content,
      location: wp.location || undefined,
      startTime: wp.startTime ? new Date(wp.startTime).toISOString() : undefined,
      endTime: wp.endTime ? new Date(wp.endTime).toISOString() : undefined,
    });
    // 分析报告先存到 aiRiskAnalysis，方便前端查看；措施建议由申请人在页面上确认后再写入 safety_measures
    await this.db.update(schema.workPermits).set({ aiRiskAnalysis: res.riskAnalysis, updatedAt: new Date() }).where(eq(schema.workPermits.id, id));
    return res;
  }

  // 更新草稿/申请信息
  async update(id: string, dto: any, user: any) {
    const wp = await this.ensure(id);
    // 越权防护：仅超级管理员 / 具备全量查看权限者 / 申请人本人可修改
    // （口径与 pause/resume、getDetail 保持一致）
    const canEditAll = isSuperAdmin(user) || (user?.permissions || []).includes('epermit:view_all');
    if (!canEditAll && wp.applicantId !== user?.userId) {
      throw new ForbiddenException('仅管理员、具备全量查看权限者或申请人本人可修改该作业票');
    }
    // 终态票据禁止修改（完工 / 归档 / 作废）
    if (['finished', 'completed', 'archived', 'voided'].includes(wp.status)) {
      throw new BadRequestException('作业票已结束（完工/归档/作废），不可再修改');
    }
    const patch: any = { updatedAt: new Date() };
    // 单表合并后全部表单字段均由作业票承载（原[方案A]分散在申请单）
    const strFields = [
      'area', 'location', 'content', 'supervisorName', 'supervisorContact', 'operatorContact',
      'jobName', 'building', 'floor', 'department', 'managementDept', 'managementPerson',
      'contractorUnit', 'contractorHead', 'contractorPhone',
    ];
    for (const f of strFields) if (dto[f] !== undefined) patch[f] = dto[f];
    if (dto.startTime) patch.startTime = new Date(dto.startTime);
    if (dto.endTime) patch.endTime = new Date(dto.endTime);
    if (dto.operatorNames) patch.operatorNames = dto.operatorNames;
    if (dto.safetyMeasures) patch.safetyMeasures = dto.safetyMeasures;
    if (dto.jsas !== undefined) patch.jsas = dto.jsas;
    if (dto.steps !== undefined) patch.steps = dto.steps;
    // 监护人双签属合规签名：仅草稿/驳回态可变更，防止已提交票据上的签名被篡改
    if (dto.guardianSignatures !== undefined && ['draft', 'rejected'].includes(wp.status)) {
      patch.guardianSignatures = dto.guardianSignatures;
    }
    // 常规票预计作业人数（P0-9）
    if (dto.expectedOperatorCount !== undefined && !wp.isHazardous) {
      const n = Number(dto.expectedOperatorCount);
      patch.expectedOperatorCount = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
    // P0-8：编辑页内换绑关联的常规作业票（仅特殊票、仅草稿/驳回态）
    if (dto.linkedRoutineId !== undefined && wp.isHazardous) {
      if (!['draft', 'rejected'].includes(wp.status)) throw new BadRequestException('作业票已提交，无法修改关联的常规作业票');
      if (dto.linkedRoutineId) {
        const linked = await this.assertLinkableRoutine(dto.linkedRoutineId);
        patch.linkedRoutineId = linked.id;
        patch.linkedRoutineNo = linked.permitNo;
      } else {
        patch.linkedRoutineId = null;
        patch.linkedRoutineNo = null;
      }
    }
    // 时限硬拦截：填写即校验（提交时再次校验）
    const nextStart = patch.startTime ?? wp.startTime;
    const nextEnd = patch.endTime ?? wp.endTime;
    if (nextStart && nextEnd) this.validateDuration(wp.type, nextStart, nextEnd, 'update');
    await this.db.update(schema.workPermits).set(patch).where(eq(schema.workPermits.id, id));
    return { success: true };
  }

  // 上传证书（危险作业需上传），上传后立即 OCR，结果回写 certificate_ocr
  async uploadCertificate(id: string, file: Express.Multer.File, issuer?: string) {
    await this.ensure(id);
    const saved = await this.files.save(file.buffer, file.originalname, file.mimetype);
    const result = await this.ocr.recognize(file.buffer, file.mimetype);
    const needManual = result.needManual;
    const [cert] = await this.db
      .insert(schema.certificateOcr)
      .values({
        workPermitId: id,
        fileName: saved.fileName,
        filePath: saved.filePath,
        fileType: saved.fileType,
        issuer: issuer || result.fields.issuer,
        ocrRaw: result.raw,
        ocrFields: result.fields,
        ocrStatus: needManual ? 'manual' : 'done',
        needManual,
      })
      .returning({ id: schema.certificateOcr.id });
    return {
      id: cert.id,
      filePath: saved.filePath,
      ocrStatus: needManual ? 'manual' : 'done',
      ocrFields: result.fields,
      ocrRaw: result.raw,
      needManual,
      message: needManual ? '无法自动识别，已转人工确认，请提醒审核人员人工审核。' : '识别完成。',
    };
  }

  // 人工确认证书（OCR 失败或审核人员复核）
  async confirmCertificate(certId: string, dto: { issuer?: string; fields?: Record<string, string>; ok?: boolean }, user: any) {
    const [cert] = await this.db.select().from(schema.certificateOcr).where(eq(schema.certificateOcr.id, certId)).limit(1);
    if (!cert) throw new NotFoundException('证书记录不存在');
    const patch: any = { ocrStatus: dto.ok === false ? 'manual' : 'done', needManual: dto.ok === false };
    if (dto.issuer !== undefined) patch.issuer = dto.issuer;
    if (dto.fields !== undefined) patch.ocrFields = dto.fields;
    await this.db.update(schema.certificateOcr).set(patch).where(eq(schema.certificateOcr.id, certId));
    return { success: true };
  }

  // 提交申请
  async submit(id: string, user: any) {
    const wp = await this.ensure(id);
    if (!wp.content) throw new BadRequestException('请填写作业内容');
    if (!wp.location) throw new BadRequestException('请填写作业位置');
    // 作业人：仅危险作业必填；常规作业不要求（常规票仅填预计作业人数）
    if (wp.isHazardous && (!wp.operatorNames || wp.operatorNames.length === 0)) {
      throw new BadRequestException('请填写作业人');
    }
    // P0-8：危险作业票必须挂靠在一张“已批准且未完成”的常规作业票之下。
    // 常规票是承包商入厂作业的总许可（含一级安全培训、入厂校验），危险作业只是其中的高风险环节，
    // 不允许脱离常规票单独存在。这里同时复查关联票的当前状态（草稿期间常规票可能已完工/作废）。
    if (wp.isHazardous) {
      if (!wp.linkedRoutineId) throw new BadRequestException('危险作业票必须关联一张已批准的常规作业票，请先选择关联的常规作业票');
      await this.assertLinkableRoutine(wp.linkedRoutineId);
    }
    // 时限硬拦截：危险作业票 ≤24 小时，临时用电 ≤15 天（超出直接拦截提交）
    this.validateDuration(wp.type, wp.startTime, wp.endTime, 'submit');
    // 危险作业必须指定监护人（动火作业即监火人），并要求联系方式可追溯
    if (wp.isHazardous && !wp.supervisorName) {
      throw new BadRequestException(wp.type === 'hot_work' ? '动火作业必须指定监火人（请填写监护人姓名）' : '危险作业必须指定专职监护人（请填写监护人姓名）');
    }
    // 危险作业操作证：仅对法规明确要求持证的作业类型强制上传
    // （动火 / 高处 / 受限空间 / 起重吊装，见 WORK_PERMIT_TYPES.needCertificate）。
    // 【2026-08 改造】原按 isHazardous 一刀切，导致动土、临时用电、盲板抽堵等无对应操作证的
    // 作业类型也被要求"上传作业证"，申请人只能传无关照片凑数，反而污染了证照台账。
    if (getWorkPermitType(wp.type).needCertificate) {
      const certs = await this.db.select().from(schema.certificateOcr).where(eq(schema.certificateOcr.workPermitId, id));
      if (certs.length === 0) throw new BadRequestException(`${getWorkPermitType(wp.type).label}需上传危险作业操作证照片/PDF`);
    }
    // 现场作业台已内置「作业前安全措施落实情况」检查项，按类型预设，无需 AI 复核。

    // 审批路由：自动判定风险等级并按层级分配审批人（低=2级 / 中=3级 / 重大=4级）
    const routing = await this.buildRouting(wp);
    await this.db
      .update(schema.workPermits)
      .set({
        status: routing.firstStatus,
        riskLevel: routing.riskLevel,
        approvalChain: routing.approvalChain as any,
        updatedAt: new Date(),
      })
      .where(eq(schema.workPermits.id, id));
    // 会签第 1 步：通知申请部门主管审核（邮件含同意/拒绝按钮，48 小时有效）
    await this.sendStepApprovalMail({ ...wp, status: routing.firstStatus }, 'review');
    return {
      success: true,
      status: routing.firstStatus,
      kind: routing.kind,
      kindLabel: PERMIT_KIND_LABEL[routing.kind],
      approvalChain: routing.approvalChain,
    };
  }

  // 会签第 1 步：申请部门主管审核
  async review(id: string, dto: { approve: boolean; opinion?: string }, user: { userId: string | null; name: string }) {
    const wp = await this.ensure(id);
    if (wp.status !== 'pending_review') throw new BadRequestException('当前状态不可审核');
    if (!dto.approve) {
      const rej = this.applyChain(wp, 'review', user, false, dto.opinion);
      // S14：CAS 条件更新（仅当状态仍为 pending_review 才生效），并发重复审批被拒
      await this.casUpdate(id, 'pending_review', { ...rej.patch, status: 'rejected', reviewerId: user.userId ?? null, reviewerName: user.name, reviewOpinion: dto.opinion, reviewedAt: new Date(), updatedAt: new Date() });
            // 驳回时同步更新关联申请单状态，让申请单页/列表/审批台统一显示驳回
      await this.notifyRejected(wp, '申请部门主管审核', dto.opinion);
      return { success: true, status: 'rejected' };
    }
    // 通过：按审批链推进（无链的历史票沿用旧逻辑——危险票进 EHS 审批，常规票直接批准）
    const adv = this.applyChain(wp, 'review', user, true, dto.opinion, wp.isHazardous ? 'ehs_reviewing' : 'approved');
    const nextStatus = adv.nextStatus;
    await this.casUpdate(id, 'pending_review', { ...adv.patch, status: nextStatus, reviewerId: user.userId ?? null, reviewerName: user.name, reviewOpinion: dto.opinion, reviewedAt: new Date(), updatedAt: new Date() });
    if (nextStatus === 'ehs_reviewing') await this.sendStepApprovalMail({ ...wp, status: nextStatus }, 'approve_ehs');
    else if (nextStatus === 'reviewing') await this.sendStepApprovalMail({ ...wp, status: nextStatus }, 'approve_mgr');
    // 常规票两级审批人为同一人时链会被合并成一级，第一步签完即 approved，需在此触发批准后动作
    else if (nextStatus === 'approved') await this.onApproved(wp, id);
    return { success: true, status: nextStatus, nextApprover: adv.nextNode?.approverName ?? null, nextRole: adv.nextNode?.roleName ?? null };
  }

  // 会签第 2 步：EHS工程师审批（仅危险作业票，ehs_reviewing 阶段）
  async approveEhs(id: string, dto: { approve: boolean; opinion?: string }, user: { userId: string | null; name: string }) {
    const wp = await this.ensure(id);
    if (wp.status !== 'ehs_reviewing') throw new BadRequestException('当前状态不可进行EHS审批');
    if (!dto.approve) {
      const rej = this.applyChain(wp, 'ehs', user, false, dto.opinion);
      await this.casUpdate(id, 'ehs_reviewing', { ...rej.patch, status: 'rejected', ehsApproverId: user.userId ?? null, ehsApproverName: user.name, ehsApprovalOpinion: dto.opinion, ehsApprovedAt: new Date(), updatedAt: new Date() });
            // 驳回时同步更新关联申请单状态，让申请单页/列表/审批台统一显示驳回
      await this.notifyRejected(wp, 'EHS工程师审批', dto.opinion);
      return { success: true, status: 'rejected' };
    }
    // 一般风险（2 级链）在安全员签完即批准；中等/重大风险继续进入最终批准环节
    const adv = this.applyChain(wp, 'ehs', user, true, dto.opinion, 'reviewing');
    const nextStatus = adv.nextStatus;
    await this.casUpdate(id, 'ehs_reviewing', { ...adv.patch, status: nextStatus, ehsApproverId: user.userId ?? null, ehsApproverName: user.name, ehsApprovalOpinion: dto.opinion, ehsApprovedAt: new Date(), updatedAt: new Date() });
    if (nextStatus === 'reviewing') await this.sendStepApprovalMail({ ...wp, status: 'reviewing' }, 'approve_mgr');
    else if (nextStatus === 'approved') await this.onApproved(wp, id);
    return { success: true, status: nextStatus, nextApprover: adv.nextNode?.approverName ?? null, nextRole: adv.nextNode?.roleName ?? null };
  }

  // 会签第 3 步：工程部经理批准（仅危险作业票 reviewing 阶段）
  async approve(id: string, dto: { approve: boolean; opinion?: string }, user: { userId: string | null; name: string }) {
    const wp = await this.ensure(id);
    if (wp.status !== 'reviewing') throw new BadRequestException('当前状态不可批准');
    if (!dto.approve) {
      const rej = this.applyChain(wp, 'final', user, false, dto.opinion);
      await this.casUpdate(id, 'reviewing', { ...rej.patch, status: 'rejected', approverId: user.userId ?? null, approverName: user.name, approvalOpinion: dto.opinion, approvedAt: new Date(), updatedAt: new Date() });
            // 驳回时同步更新关联申请单状态，让申请单页/列表/审批台统一显示驳回
      await this.notifyRejected(wp, '最终批准', dto.opinion);
      return { success: true, status: 'rejected' };
    }
    // 重大风险有 2 个 final 节点（安全部门负责人 → 分管副总），需串行签完才 approved
    const adv = this.applyChain(wp, 'final', user, true, dto.opinion, 'approved');
    const nextStatus = adv.nextStatus;
    await this.casUpdate(id, 'reviewing', { ...adv.patch, status: nextStatus, approverId: user.userId ?? null, approverName: user.name, approvalOpinion: dto.opinion, approvedAt: new Date(), updatedAt: new Date() });
    if (nextStatus === 'reviewing') {
      // 还有上一级未签，继续留在 reviewing 并通知下一位
      await this.sendStepApprovalMail({ ...wp, status: 'reviewing' }, 'approve_mgr');
      return { success: true, status: nextStatus, nextApprover: adv.nextNode?.approverName ?? null, nextRole: adv.nextNode?.roleName ?? null };
    }
    await this.onApproved(wp, id);
    return { success: true, status: 'approved' };
  }

  /**
   * 作业票最终批准（approved）后的统一动作，多处复用：
   *   1) 常规作业票自动生成 6 位作业码 + 一级安全培训考试二维码（3 天有效）。
   *      作业码与培训码只挂在常规票上——危险作业票必须关联一张已批准的常规票，
   *      入厂人员的培训考核、进厂校验均以该常规票为准，避免同一批人重复考试。
   *   2) 邮件通知申请人；常规票额外抄送 EHS（安全环保部）存档——常规票不经 EHS 审批，
   *      但 EHS 需知悉厂区在办的全部作业。
   * 【2026-08 改造】原先作业码在「首次打印(printed)」时才生成；打印已与流程解耦，
   * 故提前到批准即生成，承包商拿到码即可组织培训，不必等打印。
   */
  private async onApproved(wp: any, id: string) {
    const isRoutine = !wp.isHazardous;
    const patch: any = {};
    if (isRoutine) {
      if (!wp.workCode) patch.workCode = await this.genWorkCode();
      if (!wp.trainingQrToken) {
        patch.trainingQrToken = randomUUID();
        patch.trainingQrExpiresAt = new Date(Date.now() + 3 * 24 * 3600 * 1000);
      }
    }
    if (Object.keys(patch).length) {
      patch.updatedAt = new Date();
      await this.db.update(schema.workPermits).set(patch).where(eq(schema.workPermits.id, id));
    }
    const to = await emailByName(this.db, wp.applicantName);
    // 常规票批准后抄送 EHS（部门名可由系统设置 approval.ehs_dept_name 覆盖）
    const cc = isRoutine ? await emailsByDepartment(this.db, (await this.configValue('approval.ehs_dept_name')) || '安全环保部') : [];
    const base = appBaseUrl();
    await this.email?.notify('work_permit_approved', {
      permitNo: wp.permitNo,
      type: getWorkPermitType(wp.type).label,
      applicant: wp.applicantName || '',
      to,
      cc,
      actionUrl: `${base}/${wp.channel === 'electronic' ? 'e-permits' : 'work-permits'}/${id}`,
      perms: ['epermit:view_all'],
    });
    return { workCode: patch.workCode || wp.workCode || null, trainingQrToken: patch.trainingQrToken || wp.trainingQrToken || null };
  }

  /** @deprecated 保留旧名以兼容历史调用，实际转发到 onApproved */
  private async notifyApproved(wp: any, id: string) {
    return this.onApproved(wp, id);
  }

  /**
   * 常规作业票批准后触发（方案 B 单表：审批通过即在此处理，不再有“申请单批准→建票”环节）：
   * 常规作业票批准后自动生成作业码 + 一级安全培训考试二维码（复用 onApproved）。
   * 危险作业票不在此处理（走各自三级审批）。
   */
  async autoApproveFromApplication(id: string) {
    const wp = await this.ensure(id);
    if (wp.isHazardous) return;
    if (['approved', 'printed', 'paused', 'finished', 'completed'].includes(wp.status)) return;
    await this.onApproved(wp, id);
    await this.db
      .update(schema.workPermits)
      .set({ status: 'approved', approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.workPermits.id, id));
  }

  /**
   * 危险作业票随其申请单批准自动提交，进入三级审批链
   * （申请部门主管 → EHS工程师 → 工程部经理）。
   */
  async autoSubmitFromApplication(id: string, applicant: { userId: string | null; name: string }) {
    const wp = await this.ensure(id);
    if (!wp.isHazardous) return;
    if (!['draft', 'rejected'].includes(wp.status)) return;
    // 单实体审批：部门级审核已由申请单会签（区域+部门）完成，直接进入 EHS 工程师审批，避免二次审批
    await this.db
      .update(schema.workPermits)
      .set({ status: 'ehs_reviewing', updatedAt: new Date() })
      .where(eq(schema.workPermits.id, id));
  }

  /**
   * 打印：只做计数与留痕，不参与任何流程流转。
   * 【2026-08 改造】打印原先承担「approved → printed 开工」和「生成作业码」两项职责，
   * 与业务实际脱节（现场未必打印、打印也可能反复）。现已彻底解耦：
   *   · 作业码/培训码 → 批准(approved)时生成，见 onApproved()
   *   · 开工 → 由「开始作业」按钮驱动，见 start()
   * 打印仅要求票已批准（含执行态、已归档补打），不再改变状态。
   */
  async markPrinted(id: string) {
    const wp = await this.ensure(id);
    const printable = ['approved', 'printed', 'paused', 'finished', 'completed'];
    if (!printable.includes(wp.status)) throw new BadRequestException('仅审批通过后的作业票可打印');
    if (wp.status === 'voided') throw new BadRequestException('该作业票已作废，不能打印');
    await this.db
      .update(schema.workPermits)
      .set({ printCount: sql`${schema.workPermits.printCount} + 1`, updatedAt: new Date() })
      .where(eq(schema.workPermits.id, id));
    return { success: true, status: wp.status, workCode: wp.workCode };
  }

  /**
   * 开始作业（approved → printed 执行中）。
   * 现场以此按钮宣告开工，之后每日巡检、暂停/恢复、完工均以执行态为前提；
   * 作业看板的「进行中/暂停」也由该状态驱动。
   * 状态值沿用历史的 'printed'（含义已变为"执行中"），避免改动状态机影响既有页面与统计。
   */
  async start(id: string, user: { userId: string | null; name: string }) {
    const wp = await this.ensure(id);
    if (wp.status === 'printed') return { success: true, status: 'printed', message: '该作业已在执行中' };
    if (wp.status !== 'approved') throw new BadRequestException('仅已批准的作业票可开始作业');
    // 入厂人员一级安全培训校验（常规票挂培训，未通过不得开工）
    await this.validateTraining(wp);
    const startedAt = new Date();
    await this.db
      .update(schema.workPermits)
      .set({ status: 'printed', printedAt: startedAt, updatedAt: new Date() })
      .where(eq(schema.workPermits.id, id));
    // 动火作业：开工即生成 0h/1h/3h 定时检查槽位。
    // 0h = 作业开始时检查（可立即完成）；1h/3h 槽位解锁时间 = 0h 完成后 +1h / +3h（提交时二次校验）。
    if (wp.type === 'hot_work') {
      await this.db.insert(schema.workPermitChecks).values([
        { workPermitId: id, checkerName: '系统（动火定时检查）', checkSlot: '0h', checkItems: {}, checkedAt: startedAt },
        { workPermitId: id, checkerName: '系统（动火定时检查）', checkSlot: '1h', checkItems: {} },
        { workPermitId: id, checkerName: '系统（动火定时检查）', checkSlot: '3h', checkItems: {} },
      ]);
    }
    return { success: true, status: 'printed', startedAt: startedAt.toISOString(), startedBy: user?.name || null };
  }

  // ==================== 审批路由：按风险等级自动分配审批人层级 ====================

  /** 按姓名查活跃用户（组织架构里负责人是以姓名维护的） */
  private async userByName(name?: string | null): Promise<{ id: string; name: string } | null> {
    if (!name) return null;
    const [u] = await this.db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(and(eq(schema.users.name, name), eq(schema.users.status, 'active')))
      .limit(1);
    return u ?? null;
  }

  /** 按角色 key 取一名活跃用户（可限定部门） */
  private async userByRole(roleKey: string, department?: string): Promise<{ id: string; name: string } | null> {
    const conds: any[] = [eq(schema.roles.key, roleKey), eq(schema.users.status, 'active')];
    if (department) conds.push(eq(schema.users.department, department));
    const rows = await this.db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
      .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(and(...conds))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 部门负责人（先查 department_managers 多对多，回退 departments.responsible_person） */
  private async deptManager(deptName?: string | null): Promise<{ id: string; name: string } | null> {
    if (!deptName) return null;
    const [d] = await this.db
      .select({ id: schema.departments.id, responsiblePerson: schema.departments.responsiblePerson })
      .from(schema.departments)
      .where(eq(schema.departments.name, deptName))
      .limit(1);
    if (!d) return null;
    const mgrs = await this.db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.departmentManagers)
      .innerJoin(schema.users, eq(schema.users.id, schema.departmentManagers.userId))
      .where(and(eq(schema.departmentManagers.departmentId, d.id), eq(schema.users.status, 'active')))
      .limit(1);
    if (mgrs.length) return mgrs[0];
    return this.userByName(d.responsiblePerson);
  }

  /**
   * 区域负责人：作业区域(areas.name) → 区域负责部门(areas.responsible_dept) → 该部门负责人。
   * 区域未维护或未配负责部门时返回 null，由调用方回退到申请部门负责人。
   */
  private async areaManager(areaName?: string | null): Promise<{ id: string; name: string } | null> {
    if (!areaName) return null;
    const [a] = await this.db
      .select({ responsibleDept: schema.areas.responsibleDept })
      .from(schema.areas)
      .where(eq(schema.areas.name, areaName))
      .limit(1);
    if (!a?.responsibleDept) return null;
    return this.deptManager(a.responsibleDept);
  }

  /**
   * 把审批链模板里的"角色语义"解析为具体的人。
   * 解析不到时留空（approverId=null），审批阶段仍可由具备对应权限的人处理，不阻断流程。
   */
  private async resolveApprovers(
    wp: { department?: string | null; area?: string | null },
    tpl: ReturnType<typeof chainTemplate>,
  ): Promise<ChainNode[]> {
    const EHS_DEPT = '安全环保部';
    const [ehsDept] = await this.db
      .select({ responsiblePerson: schema.departments.responsiblePerson, coordinator: schema.departments.coordinator })
      .from(schema.departments)
      .where(eq(schema.departments.name, EHS_DEPT))
      .limit(1);

    const out: ChainNode[] = [];
    for (let i = 0; i < tpl.length; i++) {
      const t = tpl[i];
      let person: { id: string; name: string } | null = null;
      switch (t.roleKey) {
        case 'area_manager':
          // 区域负责人（常规票第 1 级）：先按作业区域找到"区域负责部门"的负责人；
          // 区域未维护负责部门时，回退到申请部门负责人，再回退到任一审批人角色。
          person = await this.areaManager(wp.area);
          if (!person) person = await this.deptManager(wp.department);
          if (!person) person = await this.userByRole('approver', wp.department || undefined);
          if (!person) person = await this.userByRole('approver');
          break;
        case 'contractor_dept':
          // 承包商管理部门（常规票第 2 级）：由系统设置 approval.contractor_dept_name 指定部门，
          // 默认"设备动力部"（承包商入厂施工的归口管理部门）；再回退到任一审批人角色。
          person = await this.deptManager((await this.configValue('approval.contractor_dept_name')) || '设备动力部');
          if (!person) person = await this.userByName(await this.configValue('approval.contractor_dept_manager'));
          if (!person) person = await this.userByRole('approver');
          break;
        case 'dept_manager':
          // 申请部门主管（特殊票第 1 级）
          person = await this.deptManager(wp.department);
          if (!person) person = await this.userByRole('approver', wp.department || undefined);
          if (!person) person = await this.userByRole('approver');
          break;
        case 'ehs_engineer':
          // EHS 工程师（特殊票第 2 级）：优先安全环保部联络员，其次任一 safety 角色
          person = (await this.userByName(ehsDept?.coordinator)) || (await this.userByRole('safety', EHS_DEPT)) || (await this.userByRole('safety'));
          break;
        case 'eng_manager':
          // 工程部经理（特殊票第 3 级）：由系统设置 approval.eng_dept_name 指定部门，默认"工程部"；
          // 回退安全环保部负责人，最后回退系统管理员，保证链条不断。
          person = await this.deptManager((await this.configValue('approval.eng_dept_name')) || '工程部');
          if (!person) person = await this.userByName(await this.configValue('approval.eng_manager_name'));
          if (!person) person = (await this.userByName(ehsDept?.responsiblePerson)) || (await this.userByRole('admin'));
          break;
      }
      out.push({
        seq: i + 1,
        stage: t.stage,
        roleKey: t.roleKey,
        roleName: t.roleName,
        approverId: person?.id ?? null,
        approverName: person?.name ?? null,
        status: 'pending',
        opinion: null,
        actedAt: null,
      });
    }
    // 2026-08-22 业务调整：不再按人合并审批步骤。
    // 即使同一人兼任多级（如区域负责人=承包商管理部门），也按流程逐级走完，每级独立审批留痕。
    // 同一人可连续完成各级操作，界面会提示当前处于哪一级。
    return out.map((n, i) => ({ ...n, seq: i + 1 }));
  }

  /** 读取系统配置项（不存在返回 null） */
  private async configValue(key: string): Promise<string | null> {
    try {
      const [row] = await this.db
        .select({ value: schema.systemConfig.value })
        .from(schema.systemConfig)
        .where(eq(schema.systemConfig.key, key))
        .limit(1);
      return (row?.value as string) || null;
    } catch {
      return null;
    }
  }

  /**
   * 提交时构建审批链：按票种（常规/特殊）取固定链模板 + 自动分配各级审批人。
   * 【2026-08 改造】不再做风险分级；riskLevel 仅为兼容历史列而回填，不参与路由决策。
   */
  private async buildRouting(wp: any): Promise<{ kind: PermitKind; riskLevel: string; approvalChain: ChainNode[]; firstStatus: string }> {
    const kind = permitKind(wp);
    const chain = await this.resolveApprovers(wp, chainTemplate(kind));
    const first = nextPending(chain);
    console.log(`[approval] ${wp.permitNo || wp.id} ${describeChain(kind, chain)}`);
    return {
      kind,
      riskLevel: evaluateRiskLevel(wp), // 兼容 work_permits.risk_level 非空列
      approvalChain: chain,
      firstStatus: first ? stageToStatus(first.stage) : 'approved',
    };
  }

  /**
   * 通用推进：把链上当前 stage 的待办节点标记为已处理，并算出下一状态。
   * 兼容历史数据（无 approvalChain 的老票走旧固定三段逻辑）。
   */
  private applyChain(
    wp: any,
    stage: ChainStage,
    user: { userId: string | null; name: string },
    approve: boolean,
    opinion?: string,
    legacyNext?: string,
  ): { patch: any; nextStatus: string; nextNode: ChainNode | null } {
    const chain = (wp.approvalChain as ChainNode[] | null) || null;
    if (!chain?.length) {
      return { patch: {}, nextStatus: approve ? legacyNext || 'approved' : 'rejected', nextNode: null };
    }
    const r = advanceChain(chain, stage, user, approve, opinion);
    return { patch: { approvalChain: r.chain as any }, nextStatus: r.nextStatus, nextNode: r.nextNode };
  }

  /**
   * 生成 6 位数字作业代码，1 个月内唯一（数据库已有约束 idx_work_permits_work_code）。
   * 失败/碰撞最多重试 10 次。
   */
  private async genWorkCode(): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const dup = await this.db
        .select({ id: schema.workPermits.id })
        .from(schema.workPermits)
        .where(eq(schema.workPermits.workCode, code))
        .limit(1);
      if (!dup.length) return code;
    }
    throw new Error('作业代码生成失败，请重试');
  }

  // ======== 移动端手写签字（追加到 signatures 集合）========
  // dto: { name, role(worker/contractor/supervisor/safety), signImg(base64) }
  async addSignature(id: string, dto: { name?: string; role?: string; signImg: string }) {
    const wp = await this.ensure(id);
    if (!dto.signImg) throw new BadRequestException('签名不能为空');
    const list = (wp.signatures as Array<Record<string, any>>) || [];
    list.push({ name: dto.name || '', role: dto.role || 'worker', signImg: dto.signImg, signedAt: new Date().toISOString() });
    await this.db.update(schema.workPermits).set({ signatures: list, updatedAt: new Date() }).where(eq(schema.workPermits.id, id));
    return { success: true, count: list.length };
  }

  // ======== 二维码手机签字：生成签字令牌（单人一次性 / 多人共用）========
  // 场景：承包商等外部人员在承包商管理部门人员手机上陪同签字，或扫码后在本人手机上签字。
  async createSignToken(id: string, dto: { role?: string; signerName?: string; multi?: boolean; ttlHours?: number }) {
    const wp = await this.ensure(id);
    const { token, expiresAt } = await this.tokens.create({
      purpose: 'mobile_sign',
      targetType: 'work_permit',
      targetId: id,
      role: dto.role || 'worker',
      signerName: dto.signerName,
      multi: !!dto.multi,
      ttlHours: dto.ttlHours ?? 24,
      meta: { permitNo: wp.permitNo, typeLabel: getWorkPermitType(wp.type).label, content: wp.content || '' },
    });
    const base = appBaseUrl();
    return { token, expiresAt, url: `${base}/public/sign/${token}` };
  }

  // ======== 执行态流转：暂停 / 恢复 / 作废 / 完工 / 归档 ========
  async pause(id: string, dto: { reason?: string }, user: { userId: string; name: string; permissions?: string[] }) {
    const wp = await this.ensure(id);
    // 权限：超级管理员 / 申请人本人 / 持有对应渠道 pause 权限点的人员（安全员等现场干预角色）均可暂停
    const prefix = wp.channel === 'electronic' ? 'epermit' : 'work_permit';
    const hasPausePerm = Array.isArray(user.permissions) && user.permissions.includes(`${prefix}:pause`);
    if (!isSuperAdmin(user) && !hasPausePerm && wp.applicantId !== user.userId) {
      throw new ForbiddenException('仅管理员、申请人本人或具备暂停权限的人员可暂停该作业');
    }
    if (wp.status !== 'printed') throw new BadRequestException('仅执行中的作业票可暂停');
    // 常规票暂停前置：其下无进行中危险票（须先暂停危险作业）
    if (!wp.isHazardous) {
      const activeHazard = await this.db
        .select({ id: schema.workPermits.id, permitNo: schema.workPermits.permitNo })
        .from(schema.workPermits)
        .where(and(eq(schema.workPermits.linkedRoutineId, id), eq(schema.workPermits.status, 'printed')))
        .limit(1);
      if (activeHazard.length) {
        throw new BadRequestException(`该常规作业票下仍有进行中的危险作业票(${activeHazard[0].permitNo})，请先暂停危险作业后再暂停常规作业`);
      }
    }
    await this.db
      .update(schema.workPermits)
      .set({ status: 'paused', pausedAt: new Date(), pausedBy: user.userId, pausedByName: user.name, pauseReason: dto.reason, updatedAt: new Date() })
      .where(eq(schema.workPermits.id, id));
    return { success: true, status: 'paused' };
  }

  async resume(id: string, user: { userId: string; name: string; permissions?: string[] }) {
    const wp = await this.ensure(id);
    // 权限：超级管理员 / 申请人本人 / 持有对应渠道 pause 权限点的人员（与暂停一致）
    const prefix = wp.channel === 'electronic' ? 'epermit' : 'work_permit';
    const hasPausePerm = Array.isArray(user.permissions) && user.permissions.includes(`${prefix}:pause`);
    if (!isSuperAdmin(user) && !hasPausePerm && wp.applicantId !== user.userId) {
      throw new ForbiddenException('仅管理员、申请人本人或具备暂停权限的人员可恢复该作业');
    }
    if (wp.status !== 'paused') throw new BadRequestException('仅已暂停的作业票可恢复');
    await this.db
      .update(schema.workPermits)
      .set({ status: 'printed', updatedAt: new Date() })
      .where(eq(schema.workPermits.id, id));
    return { success: true, status: 'printed' };
  }

  async void(id: string, dto: { reason?: string; reopen?: boolean }, user: { userId: string; name: string }) {
    const wp = await this.ensure(id);
    if (wp.status === 'voided') throw new BadRequestException('该作业票已作废');
    if (wp.status === 'completed') throw new BadRequestException('已归档的作业票不可作废');
    let replacedByPermitNo: string | undefined;
    let newId: string | undefined;
    if (dto.reopen) {
      const newNo = await this.genPermitNo(wp.type);
      const [copy] = await this.db
        .insert(schema.workPermits)
        .values({
          permitNo: newNo,
          type: wp.type,
          isHazardous: wp.isHazardous,
          applicantId: wp.applicantId,
          applicantName: wp.applicantName,
          department: wp.department,
          area: wp.area,
          location: wp.location,
          content: wp.content,
          operatorNames: wp.operatorNames,
          safetyMeasures: wp.safetyMeasures,
          supervisorName: wp.supervisorName,
          supervisorContact: wp.supervisorContact,
          operatorContact: wp.operatorContact,
          status: 'draft',
        })
        .returning({ id: schema.workPermits.id, permitNo: schema.workPermits.permitNo });
      replacedByPermitNo = copy.permitNo;
      newId = copy.id;
    }
    await this.db
      .update(schema.workPermits)
      .set({ status: 'voided', voidedAt: new Date(), voidedBy: user.userId, voidedByName: user.name, voidReason: dto.reason, replacedByPermitNo, updatedAt: new Date() })
      .where(eq(schema.workPermits.id, id));
    return { success: true, status: 'voided', replacedByPermitNo, newId };
  }

  async finish(id: string) {
    const wp = await this.ensure(id);
    if (wp.status !== 'printed' && wp.status !== 'paused') throw new BadRequestException('仅执行中/暂停的作业票可标记完工');
    // P0-4：每日巡检硬强制；P2：现场签字完整性；P1-2：常规票培训
    await this.assertDailyInspections(wp, '完工');
    this.validateSignatures(wp);
    await this.validateTraining(wp);
    await this.db.update(schema.workPermits).set({ status: 'finished', finishedAt: new Date(), updatedAt: new Date() }).where(eq(schema.workPermits.id, id));
    return { success: true, status: 'finished' };
  }

  async archive(id: string) {
    const wp = await this.ensure(id);
    if (wp.status !== 'finished') throw new BadRequestException('仅完工的作业票可归档');
    // 常规票归档前置：其下无未完成危险票（非 finished/completed）
    if (!wp.isHazardous) {
      const pendingHazard = await this.db
        .select({ id: schema.workPermits.id, permitNo: schema.workPermits.permitNo, status: schema.workPermits.status })
        .from(schema.workPermits)
        .where(and(eq(schema.workPermits.linkedRoutineId, id), not(inArray(schema.workPermits.status, ['finished', 'completed', 'voided']))))
        .limit(1);
      if (pendingHazard.length) {
        throw new BadRequestException(`该常规作业票下仍有未完成的危险作业票(${pendingHazard[0].permitNo}，状态：${pendingHazard[0].status})，不得归档`);
      }
    }
    // 同 finish 的拦截集合
    await this.assertDailyInspections(wp, '归档');
    this.validateSignatures(wp);
    await this.validateTraining(wp);
    // 归档时清除作业代码（用户要求：作业结束后从作业票消除）
    await this.db.update(schema.workPermits).set({
      status: 'completed',
      archivedAt: new Date(),
      updatedAt: new Date(),
      workCode: null,
      trainingQrToken: null,
      trainingQrExpiresAt: null,
    }).where(eq(schema.workPermits.id, id));
    // P4-5：归档后预留同步飞书多维表格（未配置则 no-op，不阻断）
    this.feishu.sync('work_permit', { ...wp, status: 'completed', archivedAt: new Date().toISOString() });
    return { success: true, status: 'completed' };
  }

  /**
   * 到期自动归档（惰性检查，在列表/详情/统计入口触发）：
   * printed/paused 且已过 planEnd 的票 → 置 completed + materialMissing=true（资料缺，待补交）。
   * 危险票时间 ⊆ 常规票（提交时已校验），故危险票先到期先归档，常规票到期时其下危险票已归档。
   */
  async autoArchiveExpired() {
    const now = new Date();
    const expired = await this.db
      .select()
      .from(schema.workPermits)
      .where(and(inArray(schema.workPermits.status, ['printed', 'paused']), isNotNull(schema.workPermits.endTime), lt(schema.workPermits.endTime, now)));
    for (const wp of expired) {
      await this.db
        .update(schema.workPermits)
        .set({
          status: 'completed',
          archivedAt: new Date(),
          autoArchivedAt: new Date(),
          materialMissing: true,
          updatedAt: new Date(),
          workCode: null,
          trainingQrToken: null,
          trainingQrExpiresAt: null,
        })
        .where(eq(schema.workPermits.id, wp.id));
      this.feishu.sync('work_permit', { ...wp, status: 'completed', autoArchivedAt: new Date().toISOString() });
    }
    return { archived: expired.length };
  }

  /** 归档后补交材料：提交过程检查记录等，补交后清除「资料缺少」标签 */
  async completeMaterials(id: string, dto: { note?: string }, user: any) {
    const wp = await this.ensure(id);
    if (wp.status !== 'completed') throw new BadRequestException('仅已归档的作业票可补交材料');
    await this.addCheck(id, { checkerName: dto.note ? dto.note : (user?.name || '系统'), checkItems: { material: true }, note: dto.note }, user);
    await this.db
      .update(schema.workPermits)
      .set({ materialMissing: false, updatedAt: new Date() })
      .where(eq(schema.workPermits.id, id));
    return { success: true, materialMissing: false };
  }

  /**
   * 一次性维护：游离危险票回填关联常规票（按创建时间就近挂靠，时间范围截断到常规票范围内），幂等。
   * 仅在「危险票必须依附常规票」规则落地时执行一次，供存量数据修复。
   */
  async backfillFreeHazardLinks() {
    // 清理挂到「非执行态常规票」的错误关联（危险票只能依附已批准/执行的常规票）
    const ALLOWED_RT = ['approved', 'printed', 'paused', 'finished', 'completed'];
    const bad = await this.db
      .select()
      .from(schema.workPermits)
      .where(and(eq(schema.workPermits.isHazardous, true), isNotNull(schema.workPermits.linkedRoutineId)));
    for (const b of bad) {
      if (!b.linkedRoutineId) continue;
      const [rt] = await this.db
        .select({ status: schema.workPermits.status, isHazardous: schema.workPermits.isHazardous })
        .from(schema.workPermits)
        .where(eq(schema.workPermits.id, b.linkedRoutineId))
        .limit(1);
      if (!rt || rt.isHazardous || !ALLOWED_RT.includes(rt.status)) {
        await this.db
          .update(schema.workPermits)
          .set({ linkedRoutineId: null, linkedRoutineNo: null, updatedAt: new Date() })
          .where(eq(schema.workPermits.id, b.id));
      }
    }
    const routines = await this.db
      .select()
      .from(schema.workPermits)
      .where(and(eq(schema.workPermits.isHazardous, false), inArray(schema.workPermits.status, ALLOWED_RT)));
    if (!routines.length) return { linked: 0, message: '无可用常规票（需先有已批准/执行的常规票）' };
    routines.sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const free = await this.db
      .select()
      .from(schema.workPermits)
      .where(and(eq(schema.workPermits.isHazardous, true), isNull(schema.workPermits.linkedRoutineId)));
    let linked = 0;
    for (const wp of free) {
      const wt = new Date(wp.createdAt).getTime();
      let pick: any = routines[0];
      for (const r of routines) {
        if (new Date(r.createdAt).getTime() <= wt) pick = r;
        else break;
      }
      const patch: any = { linkedRoutineId: pick.id, linkedRoutineNo: pick.permitNo, updatedAt: new Date() };
      if (wp.endTime && pick.endTime && new Date(wp.endTime) > new Date(pick.endTime)) patch.endTime = new Date(pick.endTime);
      if (wp.startTime && pick.startTime && new Date(wp.startTime) < new Date(pick.startTime)) patch.startTime = new Date(pick.startTime);
      await this.db.update(schema.workPermits).set(patch).where(eq(schema.workPermits.id, wp.id));
      linked++;
    }
    return { linked, message: `已回填 ${linked} 张游离危险票` };
  }

  /**
   * 一次性维护：清理 ZY 旧格式历史作业票（种子遗留），保持演示数据符合新编号规则。
   * 级联删除其检查记录；不触碰新格式（GWP/HWP/...）票。
   */
  async cleanupLegacyZy() {
    const zy = await this.db
      .select({ id: schema.workPermits.id })
      .from(schema.workPermits)
      .where(ilike(schema.workPermits.permitNo, 'ZY%'));
    for (const r of zy) {
      await this.db.delete(schema.workPermitChecks).where(eq(schema.workPermitChecks.workPermitId, r.id));
      await this.db.delete(schema.workPermits).where(eq(schema.workPermits.id, r.id));
    }
    return { deleted: zy.length };
  }

  // 现场检查签字（可多次）
  async addCheck(id: string, dto: { checkerName: string; checkItems?: Record<string, boolean>; checkPhoto?: string; note?: string; checkSlot?: string }, user: any) {
    const wp = await this.ensure(id);
    if (!dto.checkerName) throw new BadRequestException('请填写检查人');
    const slot = dto.checkSlot || null;
    // 动火定时检查槽位：仅动火作业允许带槽位提交
    if (slot) {
      if (wp.type !== 'hot_work') throw new BadRequestException('仅动火作业可提交定时检查槽位');
      const slots = ['0h', '1h', '3h'];
      if (!slots.includes(slot)) throw new BadRequestException('无效的检查槽位');
      // 1h/3h：必须 0h 槽位已完成且到解锁时间（无论槽位记录是否已由系统预生成，均需校验）
      if (slot !== '0h') {
        const [h0] = await this.db
          .select({ checkedAt: schema.workPermitChecks.checkedAt })
          .from(schema.workPermitChecks)
          .where(and(eq(schema.workPermitChecks.workPermitId, id), eq(schema.workPermitChecks.checkSlot, '0h')))
          .limit(1);
        if (!h0) throw new BadRequestException('请先完成 0 小时（作业开始）检查');
        const base = new Date(h0.checkedAt);
        const hours = slot === '1h' ? 1 : 3;
        const unlockAt = new Date(base.getTime() + hours * 3600 * 1000);
        if (Date.now() < unlockAt.getTime()) {
          const mins = Math.ceil((unlockAt.getTime() - Date.now()) / 60000);
          throw new BadRequestException(`${slot} 检查需在 0 小时检查完成后 ${hours} 小时进行，还需等待 ${mins} 分钟`);
        }
      }
      // 已存在的该槽位记录（0h/1h/3h 槽位由开工时生成）
      const existing = await this.db
        .select({ id: schema.workPermitChecks.id, checkedAt: schema.workPermitChecks.checkedAt, note: schema.workPermitChecks.note })
        .from(schema.workPermitChecks)
        .where(and(eq(schema.workPermitChecks.workPermitId, id), eq(schema.workPermitChecks.checkSlot, slot)))
        .limit(1);
      if (existing.length > 0) {
        // 已有提交：更新检查人/备注/照片/完成时间（幂等重提）
        await this.db
          .update(schema.workPermitChecks)
          .set({
            checkerName: dto.checkerName,
            checkItems: dto.checkItems ?? {},
            checkPhoto: dto.checkPhoto,
            note: dto.note || existing[0].note,
            checkedAt: new Date(),
          })
          .where(eq(schema.workPermitChecks.id, existing[0].id));
        return { success: true, slot };
      }
      // 新槽位记录（正常情况下由开工生成，此处兜底）
      await this.db.insert(schema.workPermitChecks).values({
        workPermitId: id,
        checkerName: dto.checkerName,
        checkSlot: slot,
        checkItems: dto.checkItems ?? {},
        checkPhoto: dto.checkPhoto,
        note: dto.note,
      });
      return { success: true, slot };
    }
    // 非定时巡检（普通现场检查）
    await this.db.insert(schema.workPermitChecks).values({
      workPermitId: id,
      checkerName: dto.checkerName,
      checkItems: dto.checkItems ?? {},
      checkPhoto: dto.checkPhoto,
      note: dto.note,
    });
    return { success: true };
  }

  /** 作业票级现场检查记录列表（按 workPermitId） */
  async listChecks(id: string) {
    await this.ensure(id);
    const rows = await this.db
      .select()
      .from(schema.workPermitChecks)
      .where(eq(schema.workPermitChecks.workPermitId, id))
      .orderBy(desc(schema.workPermitChecks.checkedAt));
    return rows;
  }

  // ================= 现场检查 / 巡检记录（单表合并后统一挂作业票）=================

  /**
   * 危险作业提交前现场检查（原仅存在于申请单）。
   * 同时写 site_inspection 与巡检记录，保留"提交申请即产生巡检记录"的旧行为。
   */
  async saveSiteInspection(id: string, dto: { inspector?: string; result?: string; note?: string; photo?: string }) {
    const wp = await this.ensure(id);
    if (!wp.isHazardous) throw new BadRequestException('仅危险作业票需要现场检查');
    if (!dto.inspector?.trim()) throw new BadRequestException('请填写现场检查人');
    await this.db
      .update(schema.workPermits)
      .set({
        siteInspection: {
          inspector: dto.inspector,
          result: dto.result || 'normal',
          note: dto.note || '',
          submittedAt: new Date().toISOString(),
        } as any,
      })
      .where(eq(schema.workPermits.id, id));
    await this.db.insert(schema.inspectionRecords).values({
      workPermitId: id,
      inspector: dto.inspector,
      result: dto.result === 'abnormal' ? 'abnormal' : 'normal',
      note: dto.note || null,
      photo: dto.photo || null,
      source: 'manual',
    });
    return { success: true };
  }

  async listInspections(id: string) {
    await this.ensure(id);
    return this.db
      .select()
      .from(schema.inspectionRecords)
      .where(eq(schema.inspectionRecords.workPermitId, id))
      .orderBy(desc(schema.inspectionRecords.inspectedAt));
  }

  /** 上传纸质巡检记录扫描件 → OCR 回填（识别巡检人/时间，失败转人工） */
  async addInspectionByOcr(id: string, file: Express.Multer.File, user: any) {
    await this.ensure(id);
    const saved = await this.files.save(file.buffer, file.originalname, file.mimetype);
    const result = await this.ocr.recognize(file.buffer, file.mimetype);
    const f = result.fields || {};
    const inspector = f.inspector || f['巡检人'] || f.name || undefined;
    const dateStr = f.date || f['时间'] || f['日期'] || undefined;
    let inspectedAt = new Date();
    if (dateStr) {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) inspectedAt = d;
    }
    const [rec] = await this.db
      .insert(schema.inspectionRecords)
      .values({
        workPermitId: id,
        inspector: inspector || user?.name,
        result: 'normal',
        note: result.needManual ? '扫描件无法自动识别，请人工核对巡检信息' : undefined,
        photo: saved.filePath,
        source: 'ocr',
        ocrRaw: result.raw,
        inspectedAt,
        createdBy: user?.name,
      })
      .returning({ id: schema.inspectionRecords.id });
    return {
      success: true,
      id: rec.id,
      needManual: result.needManual,
      ocrFields: f,
      message: result.needManual ? '无法自动识别，已存档并转人工核对。' : '识别完成并已回填。',
    };
  }

  /** 删除巡检记录：限定必须属于该作业票，防止传任意 id 越权删除他人留痕 */
  async removeInspection(id: string, inspId: string) {
    await this.ensure(id);
    const [rec] = await this.db
      .select({ id: schema.inspectionRecords.id })
      .from(schema.inspectionRecords)
      .where(and(eq(schema.inspectionRecords.id, inspId), eq(schema.inspectionRecords.workPermitId, id)))
      .limit(1);
    if (!rec) throw new NotFoundException('巡检记录不存在或不属于该作业票');
    await this.db.delete(schema.inspectionRecords).where(eq(schema.inspectionRecords.id, inspId));
    return { success: true };
  }

  // ================= 安全交底（单表合并后挂作业票，一张票一份）=================

  async generateBriefingDraft(id: string) {
    await this.ensure(id);
    return { groups: buildBriefingTemplate() };
  }

  async upsertBriefing(id: string, dto: any) {
    await this.ensure(id);
    const patch: any = {};
    const groups = dto.groups !== undefined ? dto.groups : dto.points;
    if (groups !== undefined) patch.points = groups;
    if (dto.signatures !== undefined) patch.signatures = dto.signatures;
    if (dto.briefer !== undefined) patch.briefer = dto.briefer;
    if (dto.content !== undefined) patch.content = dto.content;
    if (dto.photos !== undefined) patch.photos = dto.photos;
    const b = await this.upsertBriefingInternal(id, patch);
    return { success: true, id: b.id };
  }

  private async upsertBriefingInternal(workPermitId: string, patch: any) {
    const [existing] = await this.db
      .select()
      .from(schema.safetyBriefings)
      .where(eq(schema.safetyBriefings.workPermitId, workPermitId))
      .limit(1);
    if (existing) {
      await this.db.update(schema.safetyBriefings).set({ ...patch, updatedAt: new Date() }).where(eq(schema.safetyBriefings.id, existing.id));
      return existing;
    }
    const [b] = await this.db
      .insert(schema.safetyBriefings)
      .values({ workPermitId, status: 'draft', ...patch })
      .returning({ id: schema.safetyBriefings.id });
    return b;
  }

  /** 现场交底提交：分组逐条勾选 + 设备工具正常/异常 + 双方手写签字 → status=done */
  async submitBriefing(id: string, dto: any) {
    await this.ensure(id);
    const groups = dto.groups !== undefined ? dto.groups : dto.points;
    if (!groups || groups.length === 0) throw new BadRequestException('交底内容为空，请先载入预设交底清单并勾选');
    for (const g of groups) {
      const items = g.items || [];
      if (g.mode === 'choice') {
        for (const it of items) {
          if (!it.status) throw new BadRequestException(`「${g.title}」中的「${it.text}」未选择 正常/异常`);
        }
      } else if (g.key === 'hazard_types') {
        if (!items.some((it: any) => it.checked)) {
          throw new BadRequestException('请在「本次涉及的危险作业」中至少勾选一项（如不涉及危险作业，请勾选「无危险作业」）');
        }
      } else if (!items.some((it: any) => it.checked)) {
        throw new BadRequestException(`「${g.title}」至少勾选一项`);
      }
    }
    const sigs: Array<Record<string, any>> = dto.signatures || [];
    const contractor = sigs.find((s) => s.role === 'contractor');
    if (!contractor || !contractor.signImg) throw new BadRequestException('请采集承包商（负责人/作业人员）手写签名');
    const workers = sigs.filter((s) => s.role === 'worker' && (s as any).signImg);
    if (workers.length < 1) throw new BadRequestException('至少采集 1 位作业人员手写签名');
    const patch: any = {
      points: groups,
      signatures: sigs,
      photos: dto.photos ?? [],
      status: 'done',
      briefedAt: new Date(),
      updatedAt: new Date(),
    };
    if (dto.briefer !== undefined) patch.briefer = dto.briefer;
    if (dto.content !== undefined) patch.content = dto.content;
    await this.upsertBriefingInternal(id, patch);
    return { success: true, status: 'done' };
  }

  async getBriefing(id: string) {
    await this.ensure(id);
    const [b] = await this.db
      .select()
      .from(schema.safetyBriefings)
      .where(eq(schema.safetyBriefings.workPermitId, id))
      .limit(1);
    return b ?? null;
  }

  /** AI 智能识别危害：按作业内容 + JSA 分析，返回建议打"推荐"标的风险文本 */
  async aiSuggestHazards(id: string) {
    const wp = await this.ensure(id);
    const jsas = Array.isArray(wp.jsas) ? wp.jsas : [];
    const candidates = buildBriefingTemplate()
      .filter((g) => ['env', 'equip', 'process'].includes(g.key))
      .flatMap((g) => g.items.map((it) => it.text))
      .filter((t) => !t.startsWith('其它'));
    const content = wp.content || wp.jobName || '';
    let hazards = await this.ai.analyzeBriefingHazards({ content, jsas, candidates });
    // AI 不可用或返回空时：按关键词从 JSA/内容匹配候选（规则兜底）
    if (!hazards || hazards.length === 0) {
      const text = [content, ...jsas.map((j: any) => `${j?.step || ''} ${j?.hazard || ''} ${j?.control || ''}`)].join(' ').toLowerCase();
      const kw: Record<string, string[]> = {
        '天气因素（风雨雪雷电等）': ['风', '雨', '雪', '雷', '天气', '高温', '低温'],
        '生物危害（虫蛇等）': ['虫', '蛇', '蚊', '生物'],
        '附近存放化学品': ['化学品', '化学', '易燃物', '危险品', '溶剂', '酸碱', '储罐', '库'],
        '交叉作业': ['交叉', '多单位', '同时作业', '相邻'],
        '照度不足': ['照明', '光线', '夜间', '黑暗'],
        '通道不顺畅': ['通道', '堵塞', '阻碍'],
        '绊倒': ['绊', '障碍物', '杂物'],
        '滑倒': ['滑', '油污', '积水', '湿滑'],
        '行走失衡（沟槽、台阶、上下站立面落差大）': ['沟槽', '台阶', '落差', '坑'],
        '设备储存的能量和压力': ['压力', '高压', '储罐', '气瓶', '能量'],
        '有害物质': ['有害', '毒', '化学', '粉尘', '烟雾', '气体'],
        '机械伤害（撞、割、挤压、缠绕、卷入）': ['机械', '切割', '卷入', '挤压', '缠绕', '转动', '设备'],
        '高温烫伤': ['高温', '烫', '热源', '蒸汽'],
        '带电体裸露（触电）': ['电', '触电', '漏电', '接线', '电气', '带电', '绝缘'],
        '登高操作': ['登高', '高处', '高空', '梯子', '脚手架', '平台'],
        '站立不稳': ['站立', '不稳'],
        '尖角利边': ['尖角', '利边', '锐边'],
        '拆装的部件不利抓握': ['抓握', '拆装', '部件'],
        '重量危害': ['重', '搬运', '吊装', '起吊', '重物'],
        '人工搬运（挤压、划伤）': ['搬运', '人工'],
        '电动工具（触电、飞出物、刺伤）': ['电动', '工具', '电钻', '砂轮', '打磨机'],
        '手动工具（砸伤、割伤、擦伤）': ['手动', '锤', '扳手', '刀具'],
        '使用登高工具': ['登高工具', '梯子', '脚手架'],
        '使用高压水枪或气体': ['高压水', '水枪', '压缩空气', '气'],
        '电气操作（线路接驳、设备安装、检修）': ['电气', '接线', '线路', '检修', '安装'],
        '切割、打磨（飞屑、断裂物飞出）': ['切割', '打磨', '飞屑', '打磨机', '切割机'],
        '物体打击（坍塌、倾倒、掉落）': ['物体打击', '坍塌', '倾倒', '掉落', '砸'],
        '用力过猛或工具使用不当，导致身体失衡、坠落': ['用力', '失衡', '坠落', '工具使用'],
        '噪声': ['噪声', '噪音', '声音'],
        '使用化学品（毒害、腐蚀、易燃）': ['化学品', '溶剂', '酸碱', '腐蚀', '易燃', '毒'],
      };
      hazards = Object.entries(kw)
        .filter(([candidate, keys]) => keys.some((k) => text.includes(k)) && candidates.includes(candidate))
        .map(([candidate]) => candidate)
        .slice(0, 12);
    }
    return { hazards, candidates };
  }

  // ================= 承包商安全培训记录（单表合并后挂作业票）=================

  private async findTraining(workPermitId: string) {
    const [row] = await this.db
      .select()
      .from(schema.workPermitTrainings)
      .where(eq(schema.workPermitTrainings.workPermitId, workPermitId))
      .limit(1);
    return row ?? null;
  }

  async upsertTraining(id: string, dto: any) {
    await this.ensure(id);
    const patch: any = { updatedAt: new Date() };
    const strFields = ['trainer', 'trainingTopics', 'testResult', 'remark'];
    for (const f of strFields) if (dto[f] !== undefined) patch[f] = dto[f];
    if (dto.traineeNames) patch.traineeNames = dto.traineeNames;
    if (dto.traineeSignatures) patch.traineeSignatures = dto.traineeSignatures;
    if (dto.trainingDate) patch.trainingDate = new Date(dto.trainingDate);
    const existing = await this.findTraining(id);
    if (existing) {
      await this.db.update(schema.workPermitTrainings).set(patch).where(eq(schema.workPermitTrainings.id, existing.id));
      return { success: true, id: existing.id };
    }
    const [t] = await this.db
      .insert(schema.workPermitTrainings)
      .values({ workPermitId: id, ...patch })
      .returning({ id: schema.workPermitTrainings.id });
    return { success: true, id: t.id };
  }

  /** 生成培训签字二维码令牌（多人共用，72 小时有效） */
  async createTrainingSignToken(id: string) {
    await this.ensure(id);
    let training = await this.findTraining(id);
    if (!training) {
      const [t] = await this.db
        .insert(schema.workPermitTrainings)
        .values({ workPermitId: id })
        .returning({ id: schema.workPermitTrainings.id });
      training = { id: t.id } as any;
    }
    const { token, expiresAt } = await this.tokens.create({
      purpose: 'mobile_sign',
      targetType: 'training',
      targetId: training.id,
      role: 'trainee',
      multi: true,
      ttlHours: 72,
    });
    return { token, expiresAt, url: `${appBaseUrl()}/public/sign/${token}` };
  }

  /** 培训人点击"完成培训签到" */
  async completeTrainingSign(id: string) {
    await this.ensure(id);
    const training = await this.findTraining(id);
    if (!training) throw new BadRequestException('尚未创建培训记录，无法完成签到');
    await this.db
      .update(schema.workPermitTrainings)
      .set({ signCompletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.workPermitTrainings.id, training.id));
    return { success: true };
  }

  // ================= 承包商协同（P0-2 / P0-3 / P1-1~P1-4 / P2-1）=================

  /**
   * P0-2 / P0-3：生成承包商填写邀请。
   * 返回 72h 令牌 + 免登录链接（前端据此渲染二维码）；邮件不可用时降级为 emailSkipped=true，
   * 由前端提示改用链接/二维码，绝不阻塞主流程。
   */
  async createContractorInvite(id: string, user: any) {
    const wp = await this.ensure(id);
    const canEditAll = isSuperAdmin(user) || (user?.permissions || []).includes('epermit:view_all');
    if (!canEditAll && wp.applicantId !== user?.userId) {
      throw new ForbiddenException('仅管理员、具备全量查看权限者或申请人本人可发送承包商邀请');
    }
    if (!['draft', 'rejected'].includes(wp.status)) throw new BadRequestException('仅草稿或已驳回状态的作业票可发送承包商填写邀请');
    const email = (wp.contractorEmail || '').trim();
    if (!email) throw new BadRequestException('请先填写承包商联系邮箱');
    const { token, expiresAt } = await this.tokens.create({
      purpose: 'contractor_fill',
      targetType: 'work_permit',
      targetId: id,
      role: 'contractor',
      multi: true,
      ttlHours: 72,
    });
    await this.db
      .update(schema.workPermits)
      .set({ contractorInviteToken: token, contractorInviteExpiresAt: expiresAt, updatedAt: new Date() })
      .where(eq(schema.workPermits.id, id));
    const url = `${appBaseUrl()}/public/contractor-fill/${token}`;
    let emailSkipped = true;
    try {
      const html = [
        `<div style="font-family:sans-serif;max-width:640px">`,
        `<h3>EHS 作业票填写邀请</h3>`,
        `<p>您好，贵单位需配合填写作业票 <b>${wp.permitNo || ''}</b> 的作业内容、施工方案与风险识别（JSA）。</p>`,
        `<p>作业名称：${wp.jobName || '—'}<br/>作业内容：${wp.content || '—'}<br/>地点：${wp.location || '—'}</p>`,
        `<p><a href="${url}" style="background:#2563eb;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">点击填写（72 小时内有效）</a></p>`,
        `<p style="color:#666;font-size:12px">若按钮无法点击，请复制以下链接到浏览器打开：<br/>${url}</p>`,
        `</div>`,
      ].join('');
      await this.email.send(email, `【EHS】作业票 ${wp.permitNo || ''} 填写邀请`, html);
      emailSkipped = false;
    } catch (e) {
      this.logger.warn(`承包商邀请邮件未发出（降级为链接/二维码）: ${(e as Error)?.message}`);
    }
    return { token, expiresAt, url, email, emailSkipped };
  }

  /** P2-1：生成危险票作业人员填写邀请（72h） */
  async createWorkerInvite(id: string, user: any) {
    const wp = await this.ensure(id);
    const email = (wp.contractorEmail || '').trim();
    if (!email) throw new BadRequestException('请先填写承包商联系邮箱');
    const { token, expiresAt } = await this.tokens.create({
      purpose: 'worker_fill',
      targetType: 'work_permit',
      targetId: id,
      role: 'worker',
      multi: true,
      ttlHours: 72,
    });
    const url = `${appBaseUrl()}/public/worker-fill/${token}`;
    let emailSkipped = true;
    try {
      await this.email.send(email, `【EHS】危险作业票 ${wp.permitNo || ''} 作业人员填写邀请`,
        `<p>请填写施工时间、作业人员、监护人、作业证书与风险识别：<br/><a href="${url}">${url}</a></p>`);
      emailSkipped = false;
    } catch (e) {
      this.logger.warn(`作业人员邀请邮件未发出（降级为链接）: ${(e as Error)?.message}`);
    }
    return { token, expiresAt, url, email, emailSkipped };
  }

  /** 按令牌取作业票（免登录页用），校验 purpose 与有效期 */
  private async wpByToken(token: string, purpose: 'contractor_fill' | 'worker_fill') {
    const t = await this.tokens.getValid(token, purpose);
    const wp = await this.ensure(t.targetId as string);
    return { t, wp };
  }

  /** P1-1：免登录页读取基本信息（只读区 + 已填内容，便于续填） */
  async getContractorFill(token: string) {
    const { wp } = await this.wpByToken(token, 'contractor_fill');
    return {
      permitNo: wp.permitNo,
      jobName: wp.jobName,
      content: wp.content,
      location: wp.location,
      area: wp.area,
      building: wp.building,
      floor: wp.floor,
      department: wp.department,
      applicantName: wp.applicantName,
      contractorUnit: wp.contractorUnit,
      contractorHead: wp.contractorHead,
      startTime: wp.startTime,
      endTime: wp.endTime,
      operatorNames: wp.operatorNames || [],
      steps: wp.steps || [],
      jsas: wp.jsas || [],
      riskHazards: wp.riskHazards || [],
      jsaAnalysisCount: wp.jsaAnalysisCount || 0,
      jsaMaxCount: 3,
      submittedAt: wp.contractorSubmittedAt,
      status: wp.status,
    };
  }

  /** P1-1：承包商保存填写内容（可多次保存，人工修订不限次） */
  async saveContractorFill(token: string, dto: any) {
    const { wp } = await this.wpByToken(token, 'contractor_fill');
    if (wp.contractorSubmittedAt) throw new BadRequestException('已提交，如需修改请联系邀请方撤回');
    const patch: any = { updatedAt: new Date() };
    if (dto.content !== undefined) patch.content = dto.content;
    if (dto.planFile !== undefined) patch.planFile = dto.planFile;
    if (dto.steps !== undefined) patch.steps = dto.steps;
    if (dto.jsas !== undefined) {
      patch.jsas = dto.jsas;
      patch.jsaModifiedRound = (wp.jsaModifiedRound || 0) + 1;
    }
    if (dto.riskHazards !== undefined) patch.riskHazards = dto.riskHazards;
    await this.db.update(schema.workPermits).set(patch).where(eq(schema.workPermits.id, wp.id));
    return { success: true };
  }

  /** P2-1：危险票作业人员填写提交 */
  async saveWorkerFill(token: string, dto: any) {
    const { wp } = await this.wpByToken(token, 'worker_fill');
    const patch: any = { updatedAt: new Date() };
    if (dto.startTime) patch.startTime = new Date(dto.startTime);
    if (dto.endTime) patch.endTime = new Date(dto.endTime);
    if (dto.operatorNames) patch.operatorNames = dto.operatorNames;
    if (dto.supervisorName !== undefined) patch.supervisorName = dto.supervisorName;
    if (dto.supervisorContact !== undefined) patch.supervisorContact = dto.supervisorContact;
    if (dto.content !== undefined) patch.content = dto.content;
    if (dto.jsas !== undefined) patch.jsas = dto.jsas;
    if (dto.riskHazards !== undefined) patch.riskHazards = dto.riskHazards;
    if (dto.startTime && dto.endTime) this.validateDuration(wp.type, patch.startTime, patch.endTime, 'update');
    await this.db.update(schema.workPermits).set(patch).where(eq(schema.workPermits.id, wp.id));
    return { success: true };
  }

  /** P2-1：免登录页读取危险票作业人员填写数据（便于续填） */
  async getWorkerFill(token: string) {
    const { wp } = await this.wpByToken(token, 'worker_fill');
    return {
      permitNo: wp.permitNo,
      jobName: wp.jobName,
      content: wp.content,
      location: wp.location,
      type: wp.type,
      contractorUnit: wp.contractorUnit,
      applicantName: wp.applicantName,
      startTime: wp.startTime,
      endTime: wp.endTime,
      operatorNames: wp.operatorNames || [],
      supervisorName: wp.supervisorName,
      supervisorContact: wp.supervisorContact,
      steps: wp.steps || [],
      jsas: wp.jsas || [],
      riskHazards: wp.riskHazards || [],
      submittedAt: wp.contractorSubmittedAt,
      status: wp.status,
    };
  }

  /** P1-1：承包商上传施工方案文件（白名单校验 + 魔数校验走 FilesService） */
  async saveContractorPlan(token: string, file: Express.Multer.File) {
    const { wp } = await this.wpByToken(token, 'contractor_fill');
    if (wp.contractorSubmittedAt) throw new BadRequestException('已提交，如需修改请联系邀请方撤回');
    if (!file?.buffer?.length) throw new BadRequestException('请选择文件');
    const { filePath, fileName } = await this.files.save(file.buffer, file.originalname || 'plan.pdf', file.mimetype);
    await this.db
      .update(schema.workPermits)
      .set({ planFile: filePath, updatedAt: new Date() })
      .where(eq(schema.workPermits.id, wp.id));
    return { filePath, fileName };
  }

  /**
   * P1-2：AI 生成 JSA（累计上限 3 次，后端强校验；人工修订不消耗次数）。
   * 以当前手工修订版为上下文续写，产出要求：规范安全术语 + 具体执行动作/量化参数。
   */
  async contractorAiJsa(token: string, dto: { steps?: string[]; content?: string }) {
    const { wp } = await this.wpByToken(token, 'contractor_fill');
    if (wp.contractorSubmittedAt) throw new BadRequestException('已提交，不可再分析');
    if ((wp.jsaAnalysisCount || 0) >= 3) {
      throw new BadRequestException('AI 分析次数已用完（3/3），可继续手工完善后提交');
    }
    const steps = (dto.steps && dto.steps.length ? dto.steps : (wp.steps || [])).map((s: any) => String(s || '').trim()).filter(Boolean);
    const content = dto.content ?? wp.content ?? '';
    if (!content && steps.length === 0) throw new BadRequestException('请先填写作业内容或作业步骤');
    const jsas = await this.ai.analyzeJsa({ content, steps, type: wp.type });
    await this.db
      .update(schema.workPermits)
      .set({
        steps,
        content,
        jsas: jsas as any,
        jsaAnalysisCount: (wp.jsaAnalysisCount || 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.workPermits.id, wp.id));
    // P1-3：JSA 生成后自动派生风险清单（危害识别单一数据流）
    const riskHazards = await this.deriveRiskHazards(wp.id);
    return { jsas, riskHazards, jsaAnalysisCount: (wp.jsaAnalysisCount || 0) + 1, jsaMaxCount: 3 };
  }

  /**
   * P1-3：风险清单自动派生（危害识别单一数据流，消除重复录入）
   * = JSA 各步 hazard 去重 ∪ AI 建议危害 ∪ measure_templates 按类型补漏的固有风险
   * 承包商只需增删/勾选，不从空白录入；checked=false 项不进审批与交底。
   */
  async deriveRiskHazards(id: string) {
    const wp = await this.ensure(id);
    const jsas = Array.isArray(wp.jsas) ? wp.jsas : [];
    const content = wp.content || wp.jobName || '';
    let aiHazards: string[] = [];
    try {
      const candidates = buildBriefingTemplate()
        .filter((g) => ['env', 'equip', 'process'].includes(g.key))
        .flatMap((g) => g.items.map((it) => it.text))
        .filter((t) => !t.startsWith('其它'));
      const res = await this.ai.analyzeBriefingHazards({ content, jsas, candidates });
      aiHazards = Array.isArray(res) ? res : [];
    } catch { aiHazards = []; }
    const jsaHazards = Array.from(new Set(jsas.map((j: any) => String(j?.hazard || '').trim()).filter(Boolean)));
    let tplRisks: string[] = [];
    try {
      const tpl = await this.db
        .select({ content: schema.measureTemplates.content })
        .from(schema.measureTemplates)
        .where(eq(schema.measureTemplates.type, wp.type))
        .limit(12);
      tplRisks = (tpl || []).map((m: any) => String(m?.content || '').trim()).filter(Boolean);
    } catch { tplRisks = []; }
    const all = Array.from(new Set([...jsaHazards, ...aiHazards, ...tplRisks]));
    const riskHazards = all.map((h) => ({
      hazard: h,
      consequence: '',
      measures: Array.from(new Set(
        jsas.filter((j: any) => String(j?.hazard || '').trim() === h).map((j: any) => String(j?.control || '').trim()).filter(Boolean),
      )),
      checked: false,
    }));
    await this.db
      .update(schema.workPermits)
      .set({ riskHazards: riskHazards as any, updatedAt: new Date() })
      .where(eq(schema.workPermits.id, id));
    return riskHazards;
  }

  /** P1-4：承包商提交（作业内容/JSA/风险清单已确认）→ 置 contractor_submitted，等待员工复核送审 */
  async submitContractorFill(token: string) {
    const { wp } = await this.wpByToken(token, 'contractor_fill');
    if (wp.contractorSubmittedAt) throw new BadRequestException('已提交，请勿重复提交');
    if (!wp.content) throw new BadRequestException('请填写作业内容');
    const jsas = Array.isArray(wp.jsas) ? wp.jsas : [];
    if (jsas.length === 0) throw new BadRequestException('请先完成风险识别（JSA）');
    const risk = Array.isArray(wp.riskHazards) ? wp.riskHazards : [];
    if (risk.length > 0 && !risk.some((r: any) => r?.checked)) {
      throw new BadRequestException('请至少勾选确认一项风险');
    }
    await this.db
      .update(schema.workPermits)
      .set({ contractorSubmittedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.workPermits.id, wp.id));
    return { success: true, submittedAt: new Date() };
  }

  // ================= 作业看板 / 年度统计（单表合并后直接统计作业票）=================

  async board(dateStr?: string, channel: 'paper' | 'electronic' = 'paper') {
    await this.autoArchiveExpired();
    const day = dateStr ? new Date(dateStr) : new Date();
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0);
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59);
    const HZ_LABEL: Record<string, string> = {
      hot_work: '动火作业',
      confined_space: '受限空间',
      high_altitude: '高处作业',
      lifting: '吊装作业',
      excavation: '挖掘作业',
      temporary_electricity: '临时用电',
      blind: '盲板抽堵',
      other: '其它危险作业',
    };
    // 临时用电有效期 ≤15 天，不强制当日；其余危险作业票须当日
    const isTodayWp = (w: any): boolean => {
      if (w.type === 'temporary_electricity') return true;
      const ps = w.startTime ? new Date(w.startTime) : null;
      const pe = w.endTime ? new Date(w.endTime) : null;
      if (ps && pe) return ps <= end && pe >= start;
      return w.status === 'printed' || w.status === 'paused';
    };
    const activeCond = and(
      eq(schema.workPermits.channel, channel),
      sql`${schema.workPermits.status} in ('printed','paused','finished')`,
    );
    const routineRows = await this.db
      .select()
      .from(schema.workPermits)
      .where(and(activeCond, eq(schema.workPermits.isHazardous, false)))
      .orderBy(desc(schema.workPermits.printedAt));
    const routineItems = routineRows.filter(isTodayWp).map((w: any) => ({
      id: w.id,
      kind: 'routine',
      permitNo: w.permitNo,
      hazards: [] as any[],
      jobName: w.jobName || w.content || '常规作业',
      projectName: w.projectName || '',
      content: w.content || '',
      location: w.location || '',
      department: w.department || '',
      applicantName: w.applicantName || '',
      operatorNames: Array.isArray(w.operatorNames) ? w.operatorNames : [],
      contractorUnit: w.contractorUnit || '',
      contractorHead: w.contractorHead || '',
      contractorPhone: w.contractorPhone || '',
      managementDept: w.managementDept || w.department || '',
      managementPerson: w.managementPerson || '',
      hazardTypeList: [] as string[],
      hazardType: null,
      hazardTypeLabel: '',
      involvesHazardous: false,
      status: w.status,
      planStart: w.startTime,
      planEnd: w.endTime,
      pausedByName: w.pausedByName,
      pauseReason: w.pauseReason,
      applicantId: w.applicantId,
    }));
    const wpRows = await this.db
      .select()
      .from(schema.workPermits)
      .where(and(activeCond, eq(schema.workPermits.isHazardous, true)))
      .orderBy(desc(schema.workPermits.printedAt));
    const hazardItems = wpRows.filter(isTodayWp).map((w: any) => {
      const label = HZ_LABEL[w.type] || w.type;
      return {
        id: w.id,
        kind: 'hazard',
        permitNo: w.permitNo,
        jobName: w.jobName || w.content || '危险作业',
        projectName: w.projectName || '',
        content: w.content || '',
        location: w.location || '',
        department: w.department || '',
        applicantName: w.applicantName || '',
        operatorNames: Array.isArray(w.operatorNames) ? w.operatorNames : [],
        contractorUnit: w.contractorUnit || '',
        contractorHead: w.contractorHead || '',
        contractorPhone: w.contractorPhone || '',
        managementDept: w.managementDept || w.department || '',
        managementPerson: w.managementPerson || '',
        hazardTypeList: [label],
        hazardType: w.type,
        hazardTypeLabel: label,
        involvesHazardous: true,
        status: w.status,
        planStart: w.startTime,
        planEnd: w.endTime,
        pausedByName: w.pausedByName,
        pauseReason: w.pauseReason,
        applicantId: w.applicantId,
        linkedRoutineId: w.linkedRoutineId,
        linkedRoutineNo: w.linkedRoutineNo,
      };
    });
    // 危险票按「依附常规票」嵌套到对应常规票卡片内（仅进行中/已暂停的）
    const hazardByRoutine = new Map<string, any[]>();
    for (const h of hazardItems) {
      if (h.status !== 'printed' && h.status !== 'paused') continue;
      const key = h.linkedRoutineId || '';
      if (!key) continue;
      if (!hazardByRoutine.has(key)) hazardByRoutine.set(key, []);
      hazardByRoutine.get(key)!.push(h);
    }
    for (const item of routineItems) item.hazards = hazardByRoutine.get(item.id) || [];
    const items = [...routineItems].sort((a, b) => {
      const ta = a.planStart ? new Date(a.planStart).getTime() : 0;
      const tb = b.planStart ? new Date(b.planStart).getTime() : 0;
      return tb - ta;
    });
    return {
      date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
      total: items.length,
      running: items.filter((a) => a.status === 'printed').length,
      paused: items.filter((a) => a.status === 'paused').length,
      items,
    };
  }

  async annualStats(yearParam?: number) {
    const year = yearParam || new Date().getFullYear();
    const yStart = new Date(year, 0, 1);
    const yEnd = new Date(year + 1, 0, 1);
    const inYear = and(gte(schema.workPermits.createdAt, yStart), lt(schema.workPermits.createdAt, yEnd));
    const wps = await this.db.select().from(schema.workPermits).where(inYear);
    const byMonth: Record<string, number> = {};
    const byDept: Record<string, number> = {};
    const byContractor: Record<string, number> = {};
    let voided = 0;
    let paused = 0;
    for (const w of wps) {
      const m = new Date(w.createdAt).getMonth() + 1;
      byMonth[m] = (byMonth[m] || 0) + 1;
      if (w.department) byDept[w.department] = (byDept[w.department] || 0) + 1;
      if (w.supervisorName) byContractor[w.supervisorName] = (byContractor[w.supervisorName] || 0) + 1;
      if (w.status === 'voided') voided++;
      if (w.pausedAt) paused++;
    }
    const byType: Record<string, number> = {};
    for (const w of wps) {
      if (!w.isHazardous) continue;
      const label = getWorkPermitType(w.type).label;
      byType[label] = (byType[label] || 0) + 1;
    }
    const inspRows = await this.db
      .select({ inspectedAt: schema.inspectionRecords.inspectedAt })
      .from(schema.inspectionRecords)
      .where(and(gte(schema.inspectionRecords.inspectedAt, yStart), sql`${schema.inspectionRecords.inspectedAt} < ${yEnd}`));
    const inspByMonth: Record<string, number> = {};
    for (const r of inspRows) {
      const m = new Date(r.inspectedAt).getMonth() + 1;
      inspByMonth[m] = (inspByMonth[m] || 0) + 1;
    }
    return {
      year,
      totalApplications: wps.length,
      totalPermits: wps.filter((w) => w.isHazardous).length,
      totalInspections: inspRows.length,
      voided,
      paused,
      byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: byMonth[i + 1] || 0 })),
      byType: Object.entries(byType).map(([type, count]) => ({ type, count })),
      byDept: Object.entries(byDept).map(([dept, count]) => ({ dept, count })).sort((a, b) => b.count - a.count),
      byContractor: Object.entries(byContractor).map(([contractor, count]) => ({ contractor, count })).sort((a, b) => b.count - a.count),
      inspByMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: inspByMonth[i + 1] || 0 })),
    };
  }

  // 列表（按权限）
  /**
   * 生命周期分类条件（电子票审批/我的电子票/台账 的 8 类卡片，与作业看板 running/paused 口径对齐）。
   * - all: 不附加状态条件（含草稿/驳回/作废，仅在「全部」可见）
   * - reviewing: 任一审核环节(pending_review/ehs_reviewing/reviewing)；excludeMySigned 时排除自己已签过的票
   * - briefing: 已打印(printed) 且现场交底未完成（safetyBriefings.briefedAt 为空）
   * - working: 已打印(printed) 且交底已完成、尚未完工
   * - in_progress: 进行中 = 交底中 + 作业中 = 全部 printed（与看板 running 一致，不含 paused）
   * - paused: 已暂停（与看板 paused 一致，不归入作业中/进行中）
   * - finished: 完工待归档(finished)
   * - archived: 已归档(completed)
   */
  private categoryConditions(category: string, user: any, excludeMySigned: boolean): any[] {
    const wp = schema.workPermits;
    const c: any[] = [];
    if (category === 'reviewing') {
      c.push(inArray(wp.status, ['pending_review', 'ehs_reviewing', 'reviewing']));
      if (excludeMySigned && user?.userId) {
        // 自己已签过任一审核环节（部门/EHS/经理）→ 从「审批中」跳出去。
        // 每个比较都加 IS NOT NULL，避免 NULL 参与 OR 使整条条件变为 NULL 而误排除。
        const me = user.userId;
        const signed = or(
          and(eq(wp.reviewerId, me), isNotNull(wp.reviewerId)),
          and(eq(wp.ehsApproverId, me), isNotNull(wp.ehsApproverId)),
          and(eq(wp.approverId, me), isNotNull(wp.approverId)),
        );
        c.push(not(signed));
      }
    } else if (category === 'briefing') {
      c.push(eq(wp.status, 'printed'));
      c.push(or(isNull(schema.safetyBriefings.workPermitId), isNull(schema.safetyBriefings.briefedAt)));
    } else if (category === 'working') {
      c.push(eq(wp.status, 'printed'));
      c.push(isNotNull(schema.safetyBriefings.briefedAt));
    } else if (category === 'in_progress') {
      c.push(eq(wp.status, 'printed'));
    } else if (category === 'paused') {
      c.push(eq(wp.status, 'paused'));
    } else if (category === 'material_missing') {
      // 待补资料：已归档但资料不全（超期自动归档等），补交后置 false
      c.push(eq(wp.status, 'completed'));
      c.push(eq(wp.materialMissing, true));
    } else if (category === 'finished') {
      c.push(eq(wp.status, 'finished'));
    } else if (category === 'archived') {
      c.push(eq(wp.status, 'completed'));
      c.push(eq(wp.materialMissing, false));
    }
    return c;
  }

  async list(params: any, user: any) {
    const page = Number(params.page ?? 1);
    const pageSize = Math.min(Number(params.pageSize ?? 20), 500);
    const offset = (page - 1) * pageSize;
    const wp = schema.workPermits;
    const where: any[] = [];
    if (params.channel && params.channel !== 'all') where.push(eq(wp.channel, params.channel));
    if (params.keyword) where.push(ilike(wp.content, `%${params.keyword}%`));
    if (params.status) where.push(eq(wp.status, params.status));
    if (params.type) where.push(eq(wp.type, params.type));
    if (params.department) where.push(eq(wp.department, params.department));
    if (params.isHazardous) where.push(eq(wp.isHazardous, params.isHazardous === 'true'));

    const canViewAll = isSuperAdmin(user) || (user.permissions || []).includes('epermit:view_all');
    if (!canViewAll) {
      where.push(eq(wp.applicantId, user.userId));
    } else if (params.scope === 'mine') {
      where.push(eq(wp.applicantId, user.userId));
    }

    const category = params.category || 'all';
    const excludeMySigned = !!params.excludeMySigned && category === 'reviewing';
    where.push(...this.categoryConditions(category, user, excludeMySigned));

    const needJoin = category === 'briefing' || category === 'working';
    const cond = where.length ? and(...where) : undefined;

    let query: any = this.db.select().from(wp);
    let countQuery: any = this.db.select({ c: count() }).from(wp);
    // rows 始终联表 safetyBriefings：前端列表/作业票管理需要 briefingDone 区分交底中/作业中
    query = query.leftJoin(schema.safetyBriefings, eq(wp.id, schema.safetyBriefings.workPermitId));
    if (needJoin) {
      // 计数查询仅在分类条件引用 briefedAt 时需要联表，避免多行 briefings 造成重复计数
      countQuery = countQuery.leftJoin(schema.safetyBriefings, eq(wp.id, schema.safetyBriefings.workPermitId));
    }

    const [raw, totalRows] = await Promise.all([
      query.where(cond).orderBy(desc(wp.createdAt)).limit(pageSize).offset(offset),
      countQuery.where(cond),
    ]);
    const base = raw.map((r: any) => ({ ...(r.work_permits || r.workPermits || r), briefingDone: !!(r.safety_briefings && r.safety_briefings.briefedAt) }));
    // 批量查票级检查数 + 签字完成态（电子现场台任务分类用）
    const ids = base.map((r: any) => r.id).filter(Boolean);
    let checkCountMap = new Map<string, number>();
    if (ids.length) {
      const cRows = await this.db
        .select({ wpId: schema.workPermitChecks.workPermitId, c: count() })
        .from(schema.workPermitChecks)
        .where(inArray(schema.workPermitChecks.workPermitId, ids))
        .groupBy(schema.workPermitChecks.workPermitId);
      checkCountMap = new Map(cRows.map((r: any) => [r.wpId, Number(r.c)]));
    }
    const rows = base.map((r: any) => ({
      ...r,
      checksCount: checkCountMap.get(r.id) || 0,
      signDone: Array.isArray(r.signatures) && r.signatures.length > 0,
    }));
    // 补 typeLabel：作业类型中文标签，前端无需再做映射
    const items = rows.map((r: any) => ({
      ...r,
      typeLabel: r.isHazardous ? (WORK_PERMIT_TYPES[r.type]?.label || r.type) : '常规作业',
    }));
    return { items, total: Number(totalRows[0]?.c ?? 0) };
  }

  async getDetail(id: string, user: any) {
    const wp = await this.ensure(id);
    const canViewAll = isSuperAdmin(user) || (user.permissions || []).includes('epermit:view_all');
    if (!canViewAll && wp.applicantId !== user.userId) throw new ForbiddenException('无权查看该作业票');
    const certs = await this.db.select().from(schema.certificateOcr).where(eq(schema.certificateOcr.workPermitId, id));
    const checks = await this.db.select().from(schema.workPermitChecks).where(eq(schema.workPermitChecks.workPermitId, id));
    const inspections = await this.db
      .select()
      .from(schema.inspectionRecords)
      .where(eq(schema.inspectionRecords.workPermitId, id))
      .orderBy(desc(schema.inspectionRecords.inspectedAt));
    // 关联承包商安全培训记录（直接挂在作业票），便于前端展示“培训已完成/缺失”
    const [training] = await this.db
      .select()
      .from(schema.workPermitTrainings)
      .where(eq(schema.workPermitTrainings.workPermitId, id))
      .limit(1);
    // 交底状态（safetyBriefings 按作业票唯一）
    const [briefing] = await this.db
      .select()
      .from(schema.safetyBriefings)
      .where(eq(schema.safetyBriefings.workPermitId, id))
      .limit(1);
    // 关联作业票：常规票→其下危险票列表；危险票→其依附的常规票（精简字段）
    let hazardPermits: any[] = [];
    let routinePermit: any = null;
    if (!wp.isHazardous) {
      const hzRows = await this.db
        .select({
          id: schema.workPermits.id,
          permitNo: schema.workPermits.permitNo,
          type: schema.workPermits.type,
          status: schema.workPermits.status,
          content: schema.workPermits.content,
          startTime: schema.workPermits.startTime,
          endTime: schema.workPermits.endTime,
          materialMissing: schema.workPermits.materialMissing,
        })
        .from(schema.workPermits)
        .where(eq(schema.workPermits.linkedRoutineId, id))
        .orderBy(desc(schema.workPermits.createdAt));
      hazardPermits = hzRows;
    } else if (wp.linkedRoutineId) {
      const [rt] = await this.db
        .select({
          id: schema.workPermits.id,
          permitNo: schema.workPermits.permitNo,
          type: schema.workPermits.type,
          status: schema.workPermits.status,
          content: schema.workPermits.content,
          startTime: schema.workPermits.startTime,
          endTime: schema.workPermits.endTime,
        })
        .from(schema.workPermits)
        .where(eq(schema.workPermits.id, wp.linkedRoutineId))
        .limit(1);
      routinePermit = rt || null;
    }
    return { ...wp, certificates: certs, checks, inspections, training, briefing, hazardPermits, routinePermit };
  }

  async myHistory(userId: string) {
    return this.db
      .select()
      .from(schema.workPermits)
      .where(eq(schema.workPermits.applicantId, userId))
      .orderBy(desc(schema.workPermits.createdAt))
      .limit(50);
  }

  async stats(channel: 'paper' | 'electronic' = 'paper') {
    const ch = eq(schema.workPermits.channel, channel);
    const byStatus = await this.db
      .select({ status: schema.workPermits.status, c: count() })
      .from(schema.workPermits)
      .where(ch)
      .groupBy(schema.workPermits.status);
    const byType = await this.db
      .select({ type: schema.workPermits.type, c: count() })
      .from(schema.workPermits)
      .where(ch)
      .groupBy(schema.workPermits.type);
    const total = await this.db.select({ c: count() }).from(schema.workPermits).where(ch);
    const pending = await this.db
      .select({ c: count() })
      .from(schema.workPermits)
      .where(and(ch, sql`${schema.workPermits.status} in ('pending_review','ehs_reviewing','reviewing')`));
    return {
      total: Number(total[0]?.c ?? 0),
      pending: Number(pending[0]?.c ?? 0),
      byStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.c) })),
      byType: byType.map((r) => ({ type: r.type, count: Number(r.c) })),
    };
  }

  /**
   * 电子票 6 类生命周期卡片计数。与 list() 共用 scope 与 category 逻辑，
   */
  /**
   * 消息中心 4 类任务计数（按当前用户过滤）
   * - approval: 在审票（pending_review/ehs_reviewing/reviewing）
   * - inspection: 动火已开工未完工（至少有 1h/3h 检查待提交）
   * - briefing: 交底中（printed 且未交底）
   * - signature: 已开工未签字（printed 且 signDone=false）
   */
  async notifications(user: any) {
    const wp = schema.workPermits;
    const base: any[] = [eq(wp.channel, 'electronic')];
    const canViewAll = isSuperAdmin(user) || (user.permissions || []).includes('epermit:view_all');
    if (!canViewAll) base.push(eq(wp.applicantId, user.userId));

    // 审批任务：所有在审票（不限 scope；admin 看全部）
    const reviewing = await this.db
      .select({ c: count() })
      .from(wp)
      .where(and(...base, inArray(wp.status, ['pending_review', 'ehs_reviewing', 'reviewing'])));

    // 交底/签字/检查任务：printed 状态的票（现场作业执行阶段）
    const printedRows = await this.db
      .select({
        id: wp.id,
        type: wp.type,
        isHazardous: wp.isHazardous,
        workPermitId: wp.id,
        signatures: wp.signatures,
      })
      .from(wp)
      .where(and(...base, eq(wp.status, 'printed')));

    // 关联交底完成时间（safetyBriefings 按 workPermitId 唯一，Map 避免 join 重复行）
    const wpIds = [...new Set(printedRows.map((r) => r.workPermitId).filter(Boolean))] as string[];
    let briefedMap = new Map<string, Date | null>();
    if (wpIds.length) {
      const bs = await this.db
        .select({ workPermitId: schema.safetyBriefings.workPermitId, briefedAt: schema.safetyBriefings.briefedAt })
        .from(schema.safetyBriefings)
        .where(inArray(schema.safetyBriefings.workPermitId, wpIds));
      briefedMap = new Map(bs.map((b) => [b.workPermitId, b.briefedAt ?? null]));
    }

    let briefing = 0;
    let signature = 0;
    let inspection = 0;
    for (const r of printedRows) {
      const sigs = Array.isArray(r.signatures) ? r.signatures : [];
      const briefed = r.workPermitId ? !!briefedMap.get(r.workPermitId) : false;
      // 交底任务：常规票未完成交底（危险票不交底，跳过）
      if (!r.isHazardous && !briefed) briefing++;
      // 签字任务：现场签字尚未完成（交底/签字签名缺失）
      if (sigs.length === 0) signature++;
      // 检查任务：危险票（现场巡检）+ 已交底的常规票（进入巡检阶段）
      if (r.isHazardous || briefed) inspection++;
    }

    // —— 隐患任务（整改 / 审核 / 验收）——
    const hz = schema.hazards;
    const canAcceptH = isSuperAdmin(user) || (user.permissions || []).includes('hazard:accept');
    const canAssignH = isSuperAdmin(user) || (user.permissions || []).includes('hazard:assign');
    const managed = Array.isArray(user.managedDepartments) ? user.managedDepartments : [];

    // 1) 待我整改：指派给我的整改任务
    const [hRect] = await this.db
      .select({ c: count() })
      .from(hz)
      .where(and(eq(hz.assigneeId, user.userId), eq(hz.status, 'assigned')));
    const hazardRectify = Number(hRect?.c ?? 0);

    // 2) 隐患审核 = 待派单（有 hazard:assign 的派单人）+ 待部门确认（责任部门负责人，或 EHS/管理员兜底）
    const hRevParts: any[] = [];
    if (canAssignH) hRevParts.push(eq(hz.status, 'pending_assign'));
    if (canAcceptH) hRevParts.push(eq(hz.status, 'rectified'));
    else if (managed.length) hRevParts.push(and(eq(hz.status, 'rectified'), inArray(hz.allocatedDepartment, managed)));
    let hazardReview = 0;
    if (hRevParts.length) {
      const [hRev] = await this.db.select({ c: count() }).from(hz).where(or(...hRevParts));
      hazardReview = Number(hRev?.c ?? 0);
    }

    // 3) 待验收：部门已确认、待 EHS 验收
    let hazardAccept = 0;
    if (canAcceptH) {
      const [hAcc] = await this.db.select({ c: count() }).from(hz).where(eq(hz.status, 'dept_confirmed'));
      hazardAccept = Number(hAcc?.c ?? 0);
    }

    return {
      approval: Number(reviewing[0]?.c ?? 0),
      inspection,
      briefing,
      signature,
      hazard_rectify: hazardRectify,
      hazard_review: hazardReview,
      hazard_accept: hazardAccept,
      total:
        Number(reviewing[0]?.c ?? 0) +
        inspection + briefing + signature +
        hazardRectify + hazardReview + hazardAccept,
    };
  }

  async categoryStats(params: any, user: any) {
    const wp = schema.workPermits;
    const base: any[] = [eq(wp.channel, params.channel || 'electronic')];
    if (params.keyword) base.push(ilike(wp.content, `%${params.keyword}%`));
    if (params.type) base.push(eq(wp.type, params.type));
    if (params.department) base.push(eq(wp.department, params.department));
    const canViewAll = isSuperAdmin(user) || (user.permissions || []).includes('epermit:view_all');
    if (!canViewAll) base.push(eq(wp.applicantId, user.userId));
    else if (params.scope === 'mine') base.push(eq(wp.applicantId, user.userId));

    // 8 类生命周期卡片（与前端 EPERMIT_CATEGORIES、作业看板 running/paused 口径一致）
    const cats = ['all', 'reviewing', 'briefing', 'working', 'in_progress', 'paused', 'material_missing', 'finished', 'archived'];
    const result: Record<string, number> = {};
    for (const cat of cats) {
      const exclude = !!params.excludeMySigned && cat === 'reviewing';
      const conds = [...base, ...this.categoryConditions(cat, user, exclude)];
      const cond = conds.length ? and(...conds) : undefined;
      const needJoin = cat === 'briefing' || cat === 'working';
      let q: any = this.db.select({ c: count() }).from(wp);
      if (needJoin) q = q.leftJoin(schema.safetyBriefings, eq(wp.id, schema.safetyBriefings.workPermitId));
      const rows = await q.where(cond);
      result[cat] = Number(rows[0]?.c ?? 0);
    }
    return result;
  }

  // 删除（仅草稿可删，避免误删流转中记录）
  async remove(id: string) {
    const wp = await this.ensure(id);
    if (wp.status !== 'draft') throw new BadRequestException('仅草稿可删除');

    // 常规票删除保护：若已有关联的危险票，必须先删危险票
    if (!wp.isHazardous) {
      const linkedHazards = await this.db
        .select({ count: count() })
        .from(schema.workPermits)
        .where(eq(schema.workPermits.linkedRoutineId, id));
      if ((linkedHazards[0]?.count ?? 0) > 0) {
        throw new BadRequestException('该常规作业票已关联危险作业票，请先删除关联的危险作业票');
      }
    }

    // 危险票删除时自动释放与常规票的绑定（常规票保留，仅解除指向关系）
    if (wp.isHazardous && wp.linkedRoutineId) {
      await this.db
        .update(schema.workPermits)
        .set({ linkedRoutineId: null, linkedRoutineNo: null })
        .where(eq(schema.workPermits.id, id));
    }

    await this.db.delete(schema.workPermits).where(eq(schema.workPermits.id, id));
    return { success: true };
  }

  // ======== 作业票：线上措施模板 ============
  // 返回按阶段(pre/during/post) 分组的勾选项（内容源自原纸质模板，已种子化到 measure_templates）
  async getMeasureTemplates(type: string) {
    const KNOWN = ['hot_work', 'high_altitude', 'confined_space', 'lifting', 'excavation', 'road_breaking', 'temporary_electricity', 'blind', 'other'];
    const t = KNOWN.includes(type) ? type : 'other';
    const rows = await this.db
      .select()
      .from(schema.measureTemplates)
      .where(eq(schema.measureTemplates.type, t))
      .orderBy(schema.measureTemplates.category, schema.measureTemplates.sort);
    const group = (cat: string) =>
      rows.filter((r) => r.category === cat).map((r) => ({ id: r.id, content: r.content, note: r.note ?? '', checked: false }));
    return {
      type: t,
      pre: group('pre'),
      during: group('during'),
      post: group('post'),
    };
  }

  // 保存作业票勾选确认的安全措施
  async saveMeasureSelections(id: string, items: Array<{ id: string; content: string; checked: boolean; note?: string }>) {
    await this.ensure(id);
    const list = (items || []).map((it) => ({
      id: it.id,
      content: it.content,
      checked: !!it.checked,
      note: it.note || '',
    }));
    await this.db.update(schema.workPermits).set({ measureSelections: list, updatedAt: new Date() }).where(eq(schema.workPermits.id, id));
    return { success: true, count: list.length };
  }

  private async ensure(id: string) {
    const [wp] = await this.db.select().from(schema.workPermits).where(eq(schema.workPermits.id, id)).limit(1);
    if (!wp) throw new NotFoundException('作业票不存在');
    return wp;
  }

  /**
   * S14：CAS 条件更新——仅当行状态仍为 expectedStatus 才执行更新（数据库原子比较-交换）。
   * 并发审批/状态变更时，后到者的 WHERE 不再匹配 → 返回 0 行 → 抛"状态已变更"，杜绝互相覆盖。
   */
  private async casUpdate(id: string, expectedStatus: string, patch: any) {
    const upd = await this.db
      .update(schema.workPermits)
      .set(patch)
      .where(and(eq(schema.workPermits.id, id), eq(schema.workPermits.status, expectedStatus)))
      .returning({ id: schema.workPermits.id });
    if (!upd.length) throw new BadRequestException('状态已变更，请刷新后重试');
  }

  // P0-4：每日巡检硬强制——自执行起始日(printedAt)起至昨日，任意日期缺巡检记录则拦截
  private async assertDailyInspections(wp: any, action: string) {
    if (!wp.printedAt) return; // 未进入执行态不强制
    const start = new Date(wp.printedAt);
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const yesterday = new Date();
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setDate(yesterday.getDate() - 1);
    if (startDay > yesterday) return; // 当天开始的作业不查
    const rows = await this.db
      .select()
      .from(schema.inspectionRecords)
      .where(eq(schema.inspectionRecords.workPermitId, wp.id));
    const covered = new Set(
      rows.map((r: any) => {
        const d = new Date(r.inspectedAt);
        return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      }),
    );
    const missing: string[] = [];
    for (let d = new Date(startDay); d <= yesterday; d.setDate(d.getDate() + 1)) {
      const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      if (!covered.has(key)) missing.push(key);
    }
    if (missing.length) {
      throw new BadRequestException(
        `无法${action}：自执行起始日（${start.toLocaleDateString('zh-CN')}）起，以下日期缺少每日巡检记录：${missing.join('、')}。请补齐巡检记录后再操作。`,
      );
    }
  }

  // P2：现场多方签字完整性校验
  private validateSignatures(wp: any) {
    const list = (wp.signatures as Array<Record<string, any>>) || [];
    const have = new Set(list.map((s) => s.role));
    const required = requiredSignRoles(wp.type, wp.isHazardous);
    const missing = required.filter((r) => !have.has(r));
    const hasWorker = have.has('worker') || have.has('contractor');
    if (!hasWorker) missing.push('作业人/承包商负责人');
    if (missing.length) {
      const labels = missing.map((m) => SIGN_ROLES[m]?.label || m).join('、');
      throw new BadRequestException(`现场签字不完整，缺少：${labels}。请通过二维码手机签字补齐后再完工/归档。`);
    }
  }

  // P1-2：常规（非危险）作业票必须关联并完成承包商安全培训记录
  private async validateTraining(wp: any) {
    if (wp.isHazardous) return; // 危险作业票由特种作业证管控，不在此强制
    const [tr] = await this.db
      .select()
      .from(schema.workPermitTrainings)
      .where(eq(schema.workPermitTrainings.workPermitId, wp.id))
      .limit(1);
    if (!tr || !tr.testResult) {
      throw new BadRequestException('该常规作业票尚未关联承包商安全培训记录，无法打印/归档。');
    }
  }

  // 驳回时通知申请人（不通知承包商）
  private async notifyRejected(wp: any, stepLabel: string, opinion?: string) {
    const to = await emailByName(this.db, wp.applicantName);
    if (!to) return;
    await this.email?.notify('work_permit_rejected', {
      permitNo: wp.permitNo,
      type: getWorkPermitType(wp.type).label,
      applicant: wp.applicantName || '',
      stepLabel,
      reason: opinion || '未填写驳回意见',
      to,
      actionUrl: `${appBaseUrl()}/${wp.channel === 'electronic' ? 'e-permits' : 'work-permits'}`,
    });
  }

  // 入场记录查询
  async entryRecords(query: any) {
    const page = Number(query.page ?? 1);
    const pageSize = Math.min(Number(query.pageSize ?? 20), 100);
    const offset = (page - 1) * pageSize;
    const er = schema.entryRegistrations;
    const wp = schema.workPermits;

    const q = query.q || '';
    const status = query.status || 'all';

    const base = this.db
      .select({
        id: er.id,
        workPermitId: er.workPermitId,
        contractorUnit: er.contractorUnit,
        workerName: er.workerName,
        workerIdCard: er.workerIdCard,
        workerPhone: er.workerPhone,
        trainingPassed: er.trainingPassed,
        gate: er.gate,
        registeredAt: er.registeredAt,
        signOutAt: er.signOutAt,
        workCode: wp.workCode,
        permitNo: wp.permitNo,
        jobName: wp.content,
        permitType: wp.type,
        isHazardous: wp.isHazardous,
        permitStatus: wp.status,
      })
      .from(er)
      .leftJoin(wp, eq(er.workPermitId, wp.id));

    const conditions: any[] = [];
    if (q) {
      conditions.push(
        or(
          ilike(er.workerName, `%${q}%`),
          ilike(er.contractorUnit, `%${q}%`),
          ilike(wp.workCode, `%${q}%`),
        ),
      );
    }
    if (status === 'in') conditions.push(sql`(${er.signOutAt} IS NULL)`);
    else if (status === 'out') conditions.push(sql`(${er.signOutAt} IS NOT NULL)`);
    if (query.workPermitId) conditions.push(eq(er.workPermitId, query.workPermitId));

    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, countRes, statRes] = await Promise.all([
      base.where(where).orderBy(desc(er.registeredAt)).limit(pageSize).offset(offset),
      this.db.select({ c: count() }).from(er).leftJoin(wp, eq(er.workPermitId, wp.id)).where(where),
      // 全局统计（不受分页/筛选影响，用于顶部指标条）
      this.db
        .select({
          total: count(),
          inPlant: sql<number>`count(*) FILTER (WHERE ${er.signOutAt} IS NULL)`,
          // todayIn: 今日入场人数（按 worker_id_card 去重，重复入场只算 1 人）
          todayIn: sql<number>`count(DISTINCT CASE WHEN ${er.registeredAt}::date = current_date THEN ${er.workerIdCard} END)`,
          todayOut: sql<number>`count(*) FILTER (WHERE ${er.signOutAt}::date = current_date)`,
        })
        .from(er),
    ]);

    const s = statRes[0] || ({} as any);
    return {
      items: rows.map((r: any) => ({ ...r, workerIdCard: this.maskIdCard(r.workerIdCard) })),
      total: Number(countRes[0]?.c ?? 0),
      stats: {
        total: Number(s.total ?? 0),
        inPlant: Number(s.inPlant ?? 0),
        todayIn: Number(s.todayIn ?? 0),
        todayOut: Number(s.todayOut ?? 0),
      },
    };
  }

  private maskIdCard(v?: string | null) {
    if (!v) return null;
    if (v.length < 8) return '****';
    return `${v.slice(0, 4)}**********${v.slice(-2)}`;
  }

  // 入场记录按 ID 离厂签出（管理后台一键签出）
  async entrySignOut(id: string) {
    const [er] = await this.db
      .select()
      .from(schema.entryRegistrations)
      .where(eq(schema.entryRegistrations.id, id))
      .limit(1);
    if (!er) throw new NotFoundException('入场记录不存在');
    if (er.signOutAt) throw new BadRequestException('该人员已离厂，无需重复签出');
    await this.db
      .update(schema.entryRegistrations)
      .set({ signOutAt: new Date() })
      .where(eq(schema.entryRegistrations.id, id));
    return { success: true, message: `${er.workerName} 离厂签出成功` };
  }


  /** 续期/重发培训二维码（任意时候可调用，仅刷新 token + 过期时间，不影响其他字段） */
  async renewTrainingQr(id: string, dto: { days?: number }) {
    const wp = await this.ensure(id);
    const days = Math.max(1, Math.min(60, Number(dto?.days) || 3));
    const token = randomUUID();
    const expires = new Date(Date.now() + days * 24 * 3600 * 1000);
    await this.db.update(schema.workPermits)
      .set({ trainingQrToken: token, trainingQrExpiresAt: expires, updatedAt: new Date() })
      .where(eq(schema.workPermits.id, id));
    return { trainingQrToken: token, trainingQrExpiresAt: expires, days };
  }

}
