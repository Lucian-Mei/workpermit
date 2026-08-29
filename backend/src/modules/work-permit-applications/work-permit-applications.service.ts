import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Inject } from '@nestjs/common';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, ilike, and, count, desc, sql, gte, lt, inArray } from 'drizzle-orm';
import * as schema from '@/database/schema';
import { EmailService } from '@/modules/email/email.service';
import { AiService } from '@/modules/ai/ai.service';
import { OcrService } from '@/modules/ocr/ocr.service';
import { FilesService } from '@/modules/files/files.service';
import { getWorkPermitType, APPLICATION_DURATION_LIMIT_HOURS, requiredSignRoles, SIGN_ROLES, permitNoPrefix } from '@/common/constants/domain';
import { isSuperAdmin } from '@/common/permissions';
import { emailByName } from '@/common/user-helper';
import { buildBriefingTemplate } from './briefing-template';
import { TokensService } from '@/modules/tokens/tokens.service';
import { appBaseUrl } from '@/common/base-url';
import { WorkPermitsService } from '@/modules/work-permits/work-permits.service';

// 交底「本次涉及的危险作业」勾选项（自由文本）→ 危险作业票 type
const HAZARD_BRIEFING_LABEL_TO_TYPE: Record<string, string> = {
  '动火作业': 'hot_work',
  '临时用电': 'temporary_electricity',
  '高空作业': 'high_altitude',
  '吊装作业': 'lifting',
  '挖掘作业': 'excavation',
  '受限空间': 'confined_space',
  '其它经评估为危险作业（如涉及以上危险作业，需另外办理《危险作业许可证》）': 'other',
};
// 需要在系统中开具《危险作业许可证》的危险作业类型
const HAZARD_PERMIT_TYPES_SET = new Set<string>([
  'hot_work', 'high_altitude', 'confined_space', 'lifting', 'excavation', 'temporary_electricity', 'blind', 'other',
]);
// 危险作业票 type → 中文展示名
const HAZARD_TYPE_LABEL: Record<string, string> = {
  hot_work: '动火作业',
  confined_space: '受限空间作业',
  high_altitude: '高处作业',
  lifting: '起重吊装作业',
  excavation: '动土作业',
  temporary_electricity: '临时用电',
  blind: '盲板抽堵作业',
  other: '其它危险作业',
};

// 计算「已勾选危险作业但尚未开具对应危险作业票」的类型列表（用于持续提醒）
function computeMissingHazardPermits(briefing: any, permitTypes: string[]): { type: string; label: string }[] {
  const hz = (briefing?.groups || []).find((g: any) => g.key === 'hazard_types');
  if (!hz) return [];
  const selected = (hz.items || [])
    .filter((it: any) => it.checked && HAZARD_BRIEFING_LABEL_TO_TYPE[it.text])
    .map((it: any) => HAZARD_BRIEFING_LABEL_TO_TYPE[it.text])
    .filter((t: string) => HAZARD_PERMIT_TYPES_SET.has(t));
  const opened = new Set(permitTypes || []);
  return selected.filter((t: string) => !opened.has(t)).map((t: string) => ({ type: t, label: HAZARD_TYPE_LABEL[t] || t }));
}

@Injectable()
export class WorkPermitApplicationsService {
  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    private email: EmailService,
    private ai: AiService,
    private ocr: OcrService,
    private files: FilesService,
    private tokens: TokensService,
    private workPermits: WorkPermitsService,
  ) {}

  // ======== 作业申请单作业周期硬拦截：≤7 天 ========
  private validatePlanWindow(planStart?: Date | string | null, planEnd?: Date | string | null, ctx: 'submit' | 'update' = 'update') {
    const s = planStart ? new Date(planStart) : null;
    const e = planEnd ? new Date(planEnd) : null;
    if (!s || !e) {
      if (ctx === 'submit') throw new BadRequestException('请填写计划开始时间与计划结束时间');
      return;
    }
    if (e <= s) throw new BadRequestException('计划结束时间必须晚于计划开始时间');
    const hours = (e.getTime() - s.getTime()) / 36e5;
    if (hours > APPLICATION_DURATION_LIMIT_HOURS + 1e-6) {
      throw new BadRequestException(
        `作业申请单的作业周期不得超过 7 天（当前填写约 ${Math.ceil(hours / 24)} 天）。请缩短作业周期；工期确需超过 7 天的，应分期办理作业申请。`,
      );
    }
  }

  // ======== 每日巡检硬强制：printed 之日起，每个已过日历日必须至少 1 条巡检记录 ========
  private async assertDailyInspections(app: any, action: string) {
    if (!app.printedAt) return;
    const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const recs = await this.db
      .select({ at: schema.inspectionRecords.inspectedAt })
      .from(schema.inspectionRecords)
      .where(eq(schema.inspectionRecords.applicationId, app.id));
    const covered = new Set(recs.map((r) => dayKey(new Date(r.at))));
    const start = new Date(app.printedAt);
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const today = new Date();
    const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const missing: string[] = [];
    for (let d = new Date(startDay); d < todayDay; d.setDate(d.getDate() + 1)) {
      if (!covered.has(dayKey(d))) missing.push(dayKey(d));
    }
    if (missing.length > 0) {
      throw new BadRequestException(
        `无法${action}：作业执行期间每日巡检未完成，缺少巡检记录的日期：${missing.join('、')}。请在“巡检记录”中补登（可回填巡检时间）后重试。`,
      );
    }
  }

  // P1-2：常规（非危险）作业申请单必须录入并完成承包商安全培训记录
  private async validateTraining(app: any) {
    if (app.involvesHazardous) return; // 含危险作业的申请单由危险作业票管控
    if (!app.trainingId) {
      throw new BadRequestException('该常规作业申请单尚未录入承包商安全培训记录，无法完工/归档。');
    }
    const [tr] = await this.db
      .select()
      .from(schema.workPermitTrainings)
      .where(eq(schema.workPermitTrainings.id, app.trainingId))
      .limit(1);
    if (!tr || !tr.testResult) {
      throw new BadRequestException('承包商安全培训记录未完成（缺少考核结果），无法完工/归档。');
    }
  }

  // 校验作业票现场多方签字完整性（与 WorkPermitsService.validateSignatures 同逻辑）
  private validateWorkPermitSignatures(wp: any) {
    const list = (wp.signatures as Array<Record<string, any>>) || [];
    const have = new Set(list.map((s) => s.role));
    const required = requiredSignRoles(wp.type, wp.isHazardous);
    const missing = required.filter((r) => !have.has(r));
    const hasWorker = have.has('worker') || have.has('contractor');
    if (!hasWorker) missing.push('作业人/承包商负责人');
    if (missing.length) {
      const labels = missing.map((m) => SIGN_ROLES[m]?.label || m).join('、');
      throw new BadRequestException(`关联危险作业票(${wp.permitNo})现场签字不完整，缺少：${labels}。请通过二维码手机签字补齐后再归档。`);
    }
  }

  // 审批步骤邮件（含同意/拒绝按钮，48 小时有效）
  private async sendStepApprovalMail(app: any, step: 'review' | 'approve') {
    try {
      const prefix = app.channel === 'electronic' ? 'epermit' : 'work_permit';
      const stepMeta = step === 'review'
        ? { label: '区域部门审核', perms: [`${prefix}:review`] }
        : { label: '部门负责人审批', perms: [`${prefix}:approve_mgr`, `${prefix}:approve`] };
      const { token } = await this.tokens.create({
        purpose: 'email_approval',
        targetType: 'application',
        targetId: app.id,
        step,
        meta: { permitNo: app.permitNo, channel: app.channel },
        ttlHours: 48,
      });
      const base = appBaseUrl();
      const approvalPage = `${base}/public/approval/${token}`;
      await this.email?.notify('work_permit_step_approval', {
        permitNo: app.permitNo,
        type: '作业申请单',
        applicant: app.applicantName || '',
        location: app.location || '',
        stepLabel: stepMeta.label,
        approveUrl: `${approvalPage}?action=approve`,
        rejectUrl: `${approvalPage}?action=reject`,
        actionUrl: `${base}/${app.channel === 'electronic' ? 'e-applications' : 'work-permit-applications'}`,
        perms: stepMeta.perms,
      });
    } catch {
      /* 邮件失败不阻断业务 */
    }
  }

  // 驳回时通知申请人（按名查邮箱，不通知承包商）
  private async notifyRejected(app: any, stepLabel: string, opinion?: string) {
    const to = await emailByName(this.db, app.applicantName);
    if (!to) return;
    await this.email?.notify('work_permit_rejected', {
      permitNo: app.permitNo,
      type: '作业申请单',
      applicant: app.applicantName || '',
      stepLabel,
      reason: opinion || '未填写驳回意见',
      to,
      actionUrl: `${appBaseUrl()}/${app.channel === 'electronic' ? 'e-applications' : 'work-permit-applications'}`,
    });
  }

  private async genNo(): Promise<string> {
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    // 申请单编号：SQ-YYYYMM-NNNN（与作业票 GWP- 前缀区分，统一带横线）
    const prefix = `SQ-${ym}-`;
    const like = `${prefix}%`;
    const rows = await this.db
      .select({ no: schema.workPermitApplications.permitNo })
      .from(schema.workPermitApplications)
      .where(ilike(schema.workPermitApplications.permitNo, like))
      .orderBy(desc(schema.workPermitApplications.permitNo))
      .limit(1);
    let seq = 1;
    if (rows.length) {
      const n = parseInt(rows[0].no.slice(prefix.length), 10);
      if (!isNaN(n)) seq = n + 1;
    }
    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  // 创建作业申请单草稿
  // channel: 'paper' 纸质申请单（原流程）/ 'electronic' 电子化申请单（移动端优先）
  async createDraft(dto: any, user: { userId: string; name: string; department?: string }, channel: 'paper' | 'electronic' = 'paper') {
    const vals: any = {
      permitNo: await this.genNo(),
      applicantId: user.userId,
      applicantName: user.name,
      department: dto.department || user.department,
      channel,
      status: 'draft',
    };
    const strFields = ['building', 'floor', 'area', 'location', 'jobName', 'content', 'supervisorName', 'contractorUnit', 'contractorHead', 'contractorPhone', 'operatorCount', 'materialsList', 'equipmentList', 'managementDept', 'managementPerson'];
    for (const f of strFields) if (dto[f] !== undefined) vals[f] = dto[f];
    if (dto.planStart) vals.planStart = new Date(dto.planStart);
    if (dto.planEnd) vals.planEnd = new Date(dto.planEnd);
    if (dto.operatorNames) vals.operatorNames = dto.operatorNames;
    if (typeof dto.involvesHazardous === 'boolean') vals.involvesHazardous = dto.involvesHazardous;
    if (dto.permitType !== undefined) vals.permitType = dto.permitType;
    if (dto.type !== undefined) vals.type = dto.type;
    if (dto.jsas !== undefined) vals.jsas = dto.jsas;
    if (dto.safetyMeasures !== undefined) vals.safetyMeasures = dto.safetyMeasures;
    if (dto.linkedRoutineId !== undefined) {
      vals.linkedRoutineId = dto.linkedRoutineId;
      vals.linkedRoutineNo = dto.linkedRoutineNo || null;
    }
    if (dto.expectedOperatorCount !== undefined) {
      const n = Number(dto.expectedOperatorCount);
      vals.expectedOperatorCount = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
    const [app] = await this.db
      .insert(schema.workPermitApplications)
      .values(vals)
      .returning({ id: schema.workPermitApplications.id, permitNo: schema.workPermitApplications.permitNo });
    return app;
  }

  // 更新申请单基础信息
  async update(id: string, dto: any, user: any) {
    await this.ensure(id);
    const patch: any = { updatedAt: new Date() };
    const strFields = ['department', 'building', 'floor', 'area', 'location', 'jobName', 'content', 'supervisorName', 'supervisorContact', 'contractorUnit', 'contractorHead', 'contractorPhone', 'operatorCount', 'materialsList', 'equipmentList', 'managementDept', 'managementPerson'];
    for (const f of strFields) if (dto[f] !== undefined) patch[f] = dto[f];
    if (dto.planStart) patch.planStart = new Date(dto.planStart);
    if (dto.planEnd) patch.planEnd = new Date(dto.planEnd);
    if (dto.operatorNames) patch.operatorNames = dto.operatorNames;
    if (typeof dto.involvesHazardous === 'boolean') patch.involvesHazardous = dto.involvesHazardous;
    // ===== 统一申请入口（P0 重构）：类型 / JSA / 安全措施 / 关联常规票 =====
    if (dto.permitType !== undefined) patch.permitType = dto.permitType;
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.jsas !== undefined) patch.jsas = dto.jsas;
    if (dto.safetyMeasures !== undefined) patch.safetyMeasures = dto.safetyMeasures;
    if (dto.linkedRoutineId !== undefined) {
      patch.linkedRoutineId = dto.linkedRoutineId;
      patch.linkedRoutineNo = dto.linkedRoutineNo || null;
    }
    // 演示/管理端：直接绑定培训记录 ID（前台 UI 暂未提供培训创建入口）
    if (dto.trainingId !== undefined) patch.trainingId = dto.trainingId || null;
    if (dto.expectedOperatorCount !== undefined) {
      const n = Number(dto.expectedOperatorCount);
      patch.expectedOperatorCount = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
    // 危险作业票提交前置：新波监护人 + 承包商监护人 签名
    if (Array.isArray(dto.guardianSignatures)) {
      patch.guardianSignatures = dto.guardianSignatures.map((g: any) => ({
        role: g.role === 'contractor_guardian' ? 'contractor_guardian' : 'company_guardian',
        name: String(g.name || '').slice(0, 100),
        signImg: g.signImg || null,
        signedAt: g.signedAt || new Date().toISOString(),
      }));
    }
    // 作业周期硬拦截：填写即校验（提交时再次校验）
    const app0 = await this.ensure(id);
    const ns = patch.planStart ?? app0.planStart;
    const ne = patch.planEnd ?? app0.planEnd;
    if (ns && ne) this.validatePlanWindow(ns, ne, 'update');
    await this.db.update(schema.workPermitApplications).set(patch).where(eq(schema.workPermitApplications.id, id));
    return { success: true };
  }

  // 承包商安全培训记录 upsert（随申请单）
  async upsertTraining(id: string, dto: any) {
    const app = await this.ensure(id);
    const patch: any = { updatedAt: new Date() };
    const strFields = ['trainer', 'trainingTopics', 'testResult', 'remark'];
    for (const f of strFields) if (dto[f] !== undefined) patch[f] = dto[f];
    if (dto.traineeNames) patch.traineeNames = dto.traineeNames;
    if (dto.traineeSignatures) patch.traineeSignatures = dto.traineeSignatures;
    if (dto.trainingDate) patch.trainingDate = new Date(dto.trainingDate);
    if (app.trainingId) {
      await this.db.update(schema.workPermitTrainings).set(patch).where(eq(schema.workPermitTrainings.id, app.trainingId));
      return { success: true, id: app.trainingId };
    }
    const [t] = await this.db
      .insert(schema.workPermitTrainings)
      .values({ applicationId: id, ...patch })
      .returning({ id: schema.workPermitTrainings.id });
    await this.db.update(schema.workPermitApplications).set({ trainingId: t.id, updatedAt: new Date() }).where(eq(schema.workPermitApplications.id, id));
    return { success: true, id: t.id };
  }

  // 作业票：培训手写签字（移动端采集 base64 签名图）
  // 追加式：同名替换、否则追加，支持多名受训人各自在手机上手写签字。
  async signTraining(id: string, dto: { name?: string; signImg: string; trainer?: string; trainingTopics?: string; traineeNames?: string[]; testResult?: string }) {
    const app = await this.ensure(id);
    if (!dto.signImg) throw new BadRequestException('签名不能为空');
    const sig = { name: dto.name || '', signImg: dto.signImg, signedAt: new Date().toISOString() };
    const existing = app.trainingId
      ? ((await this.db.select().from(schema.workPermitTrainings).where(eq(schema.workPermitTrainings.id, app.trainingId)).limit(1))[0] ?? null)
      : null;
    const list: Array<Record<string, any>> = Array.isArray(existing?.traineeSignatures) ? (existing.traineeSignatures as any[]) : [];
    const idx = list.findIndex((s) => (s.name || '') === sig.name);
    if (idx >= 0) list[idx] = sig;
    else list.push(sig);
    const patch: any = {
      traineeSignatures: list,
      updatedAt: new Date(),
    };
    if (dto.trainer !== undefined) patch.trainer = dto.trainer;
    if (dto.trainingTopics !== undefined) patch.trainingTopics = dto.trainingTopics;
    if (dto.traineeNames) patch.traineeNames = dto.traineeNames;
    if (dto.testResult !== undefined) patch.testResult = dto.testResult;
    if (app.trainingId) {
      await this.db.update(schema.workPermitTrainings).set(patch).where(eq(schema.workPermitTrainings.id, app.trainingId));
      return { success: true, id: app.trainingId };
    }
    const [t] = await this.db
      .insert(schema.workPermitTrainings)
      .values({ applicationId: id, ...patch })
      .returning({ id: schema.workPermitTrainings.id });
    await this.db.update(schema.workPermitApplications).set({ trainingId: t.id, updatedAt: new Date() }).where(eq(schema.workPermitApplications.id, id));
    return { success: true, id: t.id };
  }

  // 生成培训签字二维码令牌（多人共用，72 小时有效）。被培训人扫码进入通用签字页（不填姓名）手写签名。
  async createTrainingSignToken(appId: string) {
    const app = await this.ensure(appId);
    let trainingId = app.trainingId;
    if (!trainingId) {
      const [t] = await this.db
        .insert(schema.workPermitTrainings)
        .values({ applicationId: appId })
        .returning({ id: schema.workPermitTrainings.id });
      await this.db.update(schema.workPermitApplications).set({ trainingId: t.id, updatedAt: new Date() }).where(eq(schema.workPermitApplications.id, appId));
      trainingId = t.id;
    }
    const { token, expiresAt } = await this.tokens.create({
      purpose: 'mobile_sign',
      targetType: 'training',
      targetId: trainingId,
      role: 'trainee',
      multi: true,
      ttlHours: 72,
    });
    const base = appBaseUrl();
    return { token, expiresAt, url: `${base}/public/sign/${token}` };
  }

  // 培训人点击“完成培训签到”
  async completeTrainingSign(appId: string) {
    const app = await this.ensure(appId);
    if (!app.trainingId) throw new BadRequestException('尚未创建培训记录，无法完成签到');
    await this.db
      .update(schema.workPermitTrainings)
      .set({ signCompletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.workPermitTrainings.id, app.trainingId));
    return { success: true };
  }



  // 提交申请单 → 立即转为作业票（进入「常规/危险作业管理」审批），申请单销毁（converted，列表不再显示）
  async submit(id: string, user: any) {
    const app = await this.ensure(id);
    if (!app.content) throw new BadRequestException('请填写作业内容');
    // 作业人：仅危险作业必填；常规作业不要求（常规票仅填预计作业人数）。
    // 以 permitType 为准（草稿期间 involvesHazardous 可能被危险票创建逻辑误置，permitType 更可靠）。
    const isHazardSubmit = app.permitType === 'special' || (app.permitType !== 'routine' && app.involvesHazardous);
    if (isHazardSubmit && (!app.operatorNames || app.operatorNames.length === 0)) {
      throw new BadRequestException('请填写作业人');
    }
    // 作业申请单作业周期硬拦截：≤7 天，提交时强制校验
    this.validatePlanWindow(app.planStart, app.planEnd, 'submit');
    // 危险申请单：时间范围必须 ⊆ 关联常规票覆盖范围（危险票依附常规票，归档不会晚于常规票）
    if (app.involvesHazardous && app.linkedRoutineId) {
      const [rt] = await this.db.select().from(schema.workPermits).where(eq(schema.workPermits.id, app.linkedRoutineId)).limit(1);
      if (rt && rt.startTime && rt.endTime && app.planStart && app.planEnd) {
        if (new Date(app.planStart) < new Date(rt.startTime) || new Date(app.planEnd) > new Date(rt.endTime)) {
          throw new BadRequestException(
            `危险作业时间范围须在关联常规作业票(${rt.permitNo})覆盖范围内（${new Date(rt.startTime).toLocaleString('zh-CN', { hour12: false })} ~ ${new Date(rt.endTime).toLocaleString('zh-CN', { hour12: false })}）`,
          );
        }
      }
    }
    // 危险作业票的现场检查/监护人签名等前置：已由 work_permits.submit 统一校验（作业票层），此处不再重复。
    // 提交即换正式号：SQ 草稿号 → {类型前缀}-{年月}-{流水}（按分类重计流水，不沿用 SQ 流水）。
    if (app.permitNo && /^SQ-/.test(app.permitNo)) {
      const formalType = app.involvesHazardous ? app.type || 'other' : 'routine';
      app.permitNo = await this.genFormalNo(formalType);
      await this.db
        .update(schema.workPermitApplications)
        .set({ permitNo: app.permitNo, updatedAt: new Date() })
        .where(eq(schema.workPermitApplications.id, id));
    }
    // 提交即作业票：自动创建对应 work_permits 票（幂等），并立即提交（进入审批链）。
    // 申请单本身标记 converted（销毁：列表/详情不再展示，工作流由作业票接管）。
    const wpId = await this.ensureWorkPermitFromApplication(app, id);
    if (wpId) {
      try {
        await this.workPermits.submit(wpId, user);
      } catch (e: any) {
        // 作业票提交失败（如危险作业缺证书/关联票）时，申请单回滚为草稿，让用户补全后重试
        await this.db
          .update(schema.workPermitApplications)
          .set({ status: 'draft', updatedAt: new Date() })
          .where(eq(schema.workPermitApplications.id, id));
        throw e;
      }
    }
    await this.db
      .update(schema.workPermitApplications)
      .set({ status: 'converted', updatedAt: new Date() })
      .where(eq(schema.workPermitApplications.id, id));
    // 自动带出申请单第3步预设交底清单（挂该作业单，现场无需点击即可见）
    await this.ensureBriefingDraft(id);
    return { success: true, converted: true };
  }

  /** 提交即建票：申请单提交后立即生成对应作业票（幂等，已有则跳过）。返回 wpId。 */
  private async ensureWorkPermitFromApplication(app: any, appId: string): Promise<string | null> {
    const [ex] = await this.db
      .select({ id: schema.workPermits.id })
      .from(schema.workPermits)
      .where(eq(schema.workPermits.applicationId, appId))
      .limit(1);
    if (ex) return ex.id;
    const type = app.type || (app.involvesHazardous ? 'other' : 'routine');
    // 依附常规票：申请单若只带 linkedRoutineId，回填常规票编号（一单一号贯穿）
    let linkedId: string | null = app.linkedRoutineId || null;
    let linkedNo: string | null = app.linkedRoutineNo || null;
    if (linkedId && !linkedNo) {
      const [rt] = await this.db
        .select({ permitNo: schema.workPermits.permitNo })
        .from(schema.workPermits)
        .where(eq(schema.workPermits.id, linkedId))
        .limit(1);
      if (rt) linkedNo = rt.permitNo;
    }
    const [wp] = await this.db
      .insert(schema.workPermits)
      .values({
        permitNo: app.permitNo,
        type,
        isHazardous: !!app.involvesHazardous,
        applicationId: appId,
        applicantId: app.applicantId,
        applicantName: app.applicantName,
        department: app.department,
        building: app.building,
        floor: app.floor,
        area: app.area,
        location: app.location,
        content: app.content || app.jobName || '',
        startTime: app.planStart,
        endTime: app.planEnd,
        operatorNames: app.operatorNames,
        supervisorName: app.supervisorName,
        supervisorContact: app.supervisorContact,
        expectedOperatorCount: app.expectedOperatorCount,
        linkedRoutineId: linkedId,
        linkedRoutineNo: linkedNo,
        channel: 'electronic',
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: schema.workPermits.id });
    return wp?.id ?? null;
  }

  /**
   * 生成提交后的正式编号：{类型前缀}-{YYYYMM}-{4位月流水}。
   * 与 work_permits 表统一计流水（申请单换号后，批准生成的作业票沿用同号，保证两表不重复）。
   * 常规 → GWP；危险 → 按具体类型 HWP/CSE/LFP/EXP…（前缀表见 domain.ts）。
   */
  private async genFormalNo(type: string): Promise<string> {
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prefix = `${permitNoPrefix(type)}-${ym}-`;
    const [appRows, wpRows] = await Promise.all([
      this.db
        .select({ no: schema.workPermitApplications.permitNo })
        .from(schema.workPermitApplications)
        .where(ilike(schema.workPermitApplications.permitNo, `${prefix}%`))
        .orderBy(desc(schema.workPermitApplications.permitNo))
        .limit(1),
      this.db
        .select({ no: schema.workPermits.permitNo })
        .from(schema.workPermits)
        .where(ilike(schema.workPermits.permitNo, `${prefix}%`))
        .orderBy(desc(schema.workPermits.permitNo))
        .limit(1),
    ]);
    let seq = 1;
    for (const r of [appRows[0], wpRows[0]]) {
      if (r) {
        const n = parseInt(r.no.slice(prefix.length), 10);
        if (!isNaN(n)) seq = Math.max(seq, n + 1);
      }
    }
    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  // 部门审核（安全员）
  // 并行会签：区域负责人审批
  async review(id: string, dto: { approve: boolean; opinion?: string }, user: { userId: string; name: string }) {
    const app = await this.ensure(id);
    if (app.status !== 'pending_review') throw new BadRequestException('当前状态不可审核');
    if (!dto.approve) {
      await this.db.update(schema.workPermitApplications).set({ status: 'rejected', areaApprovalOpinion: dto.opinion, updatedAt: new Date() }).where(eq(schema.workPermitApplications.id, id));
      await this.notifyRejected(app, '区域负责人审核', dto.opinion);
      return { success: true, status: 'rejected' };
    }
    // 标记区域负责人已通过
    const patch: any = { areaApproverId: user.userId, areaApproverName: user.name, areaApprovalOpinion: dto.opinion, areaApprovedAt: new Date(), updatedAt: new Date() };
    // 状态推进：两端会签（区域→部门）
    // - 区域负责人已通过、部门未通过 → 状态推进到 reviewing（让 canApprove 决定可走 approve 接口）
    // - 部门也已通过 → 状态进入 approved
    if (app.deptApprovedAt) {
      patch.status = 'approved';
      patch.approvedAt = new Date();
    } else {
      patch.status = 'reviewing';
    }
    if (patch.status === 'approved') {
      await this.onApproved(app, id);
    }
    await this.db.update(schema.workPermitApplications).set(patch).where(eq(schema.workPermitApplications.id, id));
    return { success: true, status: patch.status, approvedBy: 'area' };
  }

  // 并行会签：承包商管理部门审批
  async approve(id: string, dto: { approve: boolean; opinion?: string }, user: { userId: string; name: string }) {
    const app = await this.ensure(id);
    // 区域负责人已通过 → 状态必为 reviewing 或 approved（如果部门先批也允许）
    if (!['pending_review', 'reviewing', 'approved'].includes(app.status)) {
      throw new BadRequestException('当前状态不可批准');
    }
    if (!dto.approve) {
      await this.db.update(schema.workPermitApplications).set({ status: 'rejected', deptApprovalOpinion: dto.opinion, updatedAt: new Date() }).where(eq(schema.workPermitApplications.id, id));
      await this.notifyRejected(app, '承包商管理部门审批', dto.opinion);
      return { success: true, status: 'rejected' };
    }
    // 标记管理部门已通过
    const patch: any = { deptApproverId: user.userId, deptApproverName: user.name, deptApprovalOpinion: dto.opinion, deptApprovedAt: new Date(), updatedAt: new Date() };
    // 检查区域负责人是否已通过
    if (app.areaApprovedAt) {
      patch.status = 'approved';
      patch.approvedAt = new Date();
      await this.onApproved(app, id);
    } else {
      // 极端：部门先于区域负责人批准，状态保留 reviewing 等区域负责人会签
      patch.status = 'reviewing';
    }
    await this.db.update(schema.workPermitApplications).set(patch).where(eq(schema.workPermitApplications.id, id));
    return { success: true, status: patch.status, approvedBy: 'dept' };
  }

  /** 两边都通过时：常规申请单生成入厂核验二维码；并自动推进对应作业票（申请后转化为作业票） */
  private async onApproved(app: any, id: string) {
    // 入厂核验二维码：仅常规作业申请单需要（危险作业票随常规票入厂，不单独生成）
    if (!app.involvesHazardous) {
      const crypto = await import('crypto');
      const token = crypto.randomBytes(24).toString('hex');
      const baseUrl = appBaseUrl();
      const qrUrl = `${baseUrl}/public/entry/${token}`;
      await this.db
        .update(schema.workPermitApplications)
        .set({ entryQrToken: token, entryQrUrl: qrUrl, approvedAt: new Date() })
        .where(eq(schema.workPermitApplications.id, id));
      this.email?.notify('work_permit_approved', {
        permitNo: app.permitNo,
        type: '作业申请单',
        applicant: app.applicantName || '',
        to: null,
        actionUrl: qrUrl,
        perms: ['epermit:view_all'],
      }).catch(() => {});
      this.email?.notify('work_permit_approved', {
        permitNo: app.permitNo,
        type: '作业申请单',
        applicant: app.applicantName || '',
        to: null,
        actionUrl: qrUrl,
        perms: ['epermit:view_all'],
      }).catch(() => {});
    }
    // 自动转化：申请单批准 → 对应作业票推进（常规自动批准；特殊进入三级审批）
    await this.promoteWorkPermits(app, id);
  }

  /** 申请单批准时，把已创建的作业票（申请时同步生成草稿）推进到正确状态 */
  private async promoteWorkPermits(app: any, appId: string) {
    const wps = await this.db
      .select()
      .from(schema.workPermits)
      .where(eq(schema.workPermits.applicationId, appId));
    for (const wp of wps) {
      // JSA 与安全措施从申请单同步到作业票（申请单为填写来源）
      const patch: any = {};
      if (app.jsas?.length) patch.jsas = app.jsas;
      if (app.safetyMeasures?.length) {
        patch.measureSelections = (app.safetyMeasures || []).map((m: any, i: number) => ({
          id: m.id || `m${i}`,
          content: m.content,
          checked: !!m.checked,
          note: m.note,
        }));
      }
      // 常规票沿用申请单正式编号（申请单提交时已从 SQ 换成 GWP 正式号，一单一号贯穿）
      if (!wp.isHazardous && app.permitNo && !/^SQ\d/.test(app.permitNo)) {
        patch.permitNo = app.permitNo;
      }
      if (Object.keys(patch).length) {
        await this.db.update(schema.workPermits).set(patch).where(eq(schema.workPermits.id, wp.id));
      }
      if (wp.isHazardous) {
        // 危险作业票：随申请单批准自动提交，进入三级审批链
        await this.workPermits.autoSubmitFromApplication(wp.id, { userId: app.applicantId, name: app.applicantName });
      } else {
        // 常规作业票：随申请单批准自动批准 + 生成作业码/培训码
        await this.workPermits.autoApproveFromApplication(wp.id);
      }
    }
  }

  // ================= 安全交底（挂作业申请单，一张申请单一份）=================

  // 载入申请单第3步预设交底清单（依据模板，无 AI）。返回分组勾选项。
  // 标记打印（状态推进到 printed）
  async markPrinted(id: string) {
    const app = await this.ensure(id);
    if (app.status !== 'approved') throw new BadRequestException('仅已批准的申请单可打印');
    const patch: any = { printCount: (app.printCount || 0) + 1, status: 'printed', updatedAt: new Date() };
    if (!app.printedAt) {
      patch.printedAt = new Date();
    }
    await this.db.update(schema.workPermitApplications).set(patch).where(eq(schema.workPermitApplications.id, id));
    // 首次打印时，同步把已批准的关联危险作业票推进到执行态
    if (app.status === 'approved') {
      await this.db
        .update(schema.workPermits)
        .set({ status: 'printed', printedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schema.workPermits.applicationId, id), eq(schema.workPermits.status, 'approved')));
    }
    return { success: true, status: app.status === 'approved' ? 'printed' : app.status };
  }

  async generateBriefingDraft(id: string) {
    await this.ensure(id);
    return { groups: buildBriefingTemplate() };
  }

  // 提交申请单时自动创建交底草稿并带出申请单第3步预设清单（现场免点击即可见）
  private async ensureBriefingDraft(applicationId: string) {
    const [ex] = await this.db
      .select({ id: schema.safetyBriefings.id })
      .from(schema.safetyBriefings)
      .where(eq(schema.safetyBriefings.applicationId, applicationId))
      .limit(1);
    if (ex) return;
    await this.db.insert(schema.safetyBriefings).values({
      applicationId,
      status: 'draft',
      points: buildBriefingTemplate() as any,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // 交底记录 upsert（线上预填：编辑分组要点/交底人/补充说明/双方签字）
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

  private async upsertBriefingInternal(applicationId: string, patch: any) {
    const [existing] = await this.db.select().from(schema.safetyBriefings).where(eq(schema.safetyBriefings.applicationId, applicationId)).limit(1);
    if (existing) {
      await this.db.update(schema.safetyBriefings).set({ ...patch, updatedAt: new Date() }).where(eq(schema.safetyBriefings.id, existing.id));
      return existing;
    }
    const [b] = await this.db
      .insert(schema.safetyBriefings)
      .values({ applicationId, status: 'draft', ...patch })
      .returning({ id: schema.safetyBriefings.id });
    return b;
  }

  // 现场交底提交：分组逐条勾选确认 + 设备工具正常/异常 + 双方手写签字 → status=done
  async submitBriefing(
    id: string,
    dto: {
      groups?: any[]; // 兼容旧 points
      points?: any[];
      briefer?: string;
      content?: string;
      photos?: string[];
      signatures?: Array<Record<string, any>>; // [{role:'dept'|'contractor', name?, signImg}]
    },
  ) {
    await this.ensure(id);
    const groups = dto.groups !== undefined ? dto.groups : dto.points;
    if (!groups || groups.length === 0) throw new BadRequestException('交底内容为空，请先载入预设交底清单并勾选');
    // 逐组校验：choice 组（设备工具检查）须选正常/异常；check 组中
    // 危险作业至少勾 1 项；风险/措施组（智能匹配）至少勾 1 项（不强制全勾）。
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
      } else {
        if (!items.some((it: any) => it.checked)) {
          throw new BadRequestException(`「${g.title}」至少勾选一项`);
        }
      }
    }
    // 现场签字：承包商 1 人 + 作业人员 ≥ 1 人（多人）
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
    const [b] = await this.db.select().from(schema.safetyBriefings).where(eq(schema.safetyBriefings.applicationId, id)).limit(1);
    return b ?? null;
  }

  // AI 智能识别危害：根据作业内容 + JSA 分析，返回建议打"推荐"标的风险文本
  async aiSuggestHazards(id: string) {
    const app = await this.ensure(id);
    const jsas = Array.isArray(app.jsas) ? app.jsas : [];
    const candidates = buildBriefingTemplate()
      .filter((g) => ['env', 'equip', 'process'].includes(g.key))
      .flatMap((g) => g.items.map((it) => it.text))
      .filter((t) => !t.startsWith('其它'));
    const content = app.content || app.jobName || '';
    let hazards = await this.ai.analyzeBriefingHazards({
      content,
      jsas,
      candidates,
    });
    // AI 通道不可用（offline/无 key）或返回空时：规则兜底——按关键词从 JSA/内容匹配候选
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

  // ================= 巡检记录（挂作业申请单，计入统计，支持 OCR 回填）=================

  // 手工新增巡检记录（现场拍照上传）
  async addInspection(id: string, dto: { workPermitId?: string; inspector?: string; result?: string; note?: string; photo?: string; inspectedAt?: string }, user: any) {
    await this.ensure(id);
    const [rec] = await this.db
      .insert(schema.inspectionRecords)
      .values({
        applicationId: id,
        workPermitId: dto.workPermitId || null,
        inspector: dto.inspector || user?.name,
        result: dto.result === 'abnormal' ? 'abnormal' : 'normal',
        note: dto.note,
        photo: dto.photo,
        source: 'manual',
        inspectedAt: dto.inspectedAt ? new Date(dto.inspectedAt) : new Date(),
        createdBy: user?.name,
      })
      .returning({ id: schema.inspectionRecords.id });
    return { success: true, id: rec.id };
  }

  // 上传纸质巡检记录扫描件 → OCR 回填（识别巡检人/时间，失败转人工）
  async addInspectionByOcr(id: string, file: Express.Multer.File, user: any) {
    await this.ensure(id);
    const saved = await this.files.save(file.buffer, file.originalname, file.mimetype);
    const result = await this.ocr.recognize(file.buffer, file.mimetype);
    const f = result.fields || {};
    // 尽力从 OCR 字段解析巡检人与时间
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
        applicationId: id,
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

  async listInspections(id: string) {
    await this.ensure(id);
    return this.db
      .select()
      .from(schema.inspectionRecords)
      .where(eq(schema.inspectionRecords.applicationId, id))
      .orderBy(desc(schema.inspectionRecords.inspectedAt));
  }

  async removeInspection(inspId: string) {
    await this.db.delete(schema.inspectionRecords).where(eq(schema.inspectionRecords.id, inspId));
    return { success: true };
  }

  // ================= 执行态流转：暂停 / 恢复 / 作废 / 完工 / 归档 =================

  // 暂停（仅 EHS/管理员，work_permit:pause）
  async pause(id: string, dto: { reason?: string }, user: { userId: string; name: string }) {
    const app = await this.ensure(id);
    // 权限：管理员（超级管理员）可暂停任意作业；其他人员仅能暂停本人申请的作业
    if (!isSuperAdmin(user) && app.applicantId !== user.userId) {
      throw new ForbiddenException('仅管理员或申请人本人可暂停该作业');
    }
    if (app.status !== 'printed') throw new BadRequestException('仅执行中的作业可暂停');
    await this.db
      .update(schema.workPermitApplications)
      .set({ status: 'paused', pausedAt: new Date(), pausedBy: user.userId, pausedByName: user.name, pauseReason: dto.reason, updatedAt: new Date() })
      .where(eq(schema.workPermitApplications.id, id));
    return { success: true, status: 'paused' };
  }

  // 恢复（仅 EHS/管理员）
  async resume(id: string, user: { userId: string; name: string }) {
    const app = await this.ensure(id);
    // 权限：管理员（超级管理员）可恢复任意作业；其他人员仅能恢复本人申请的作业
    if (!isSuperAdmin(user) && app.applicantId !== user.userId) {
      throw new ForbiddenException('仅管理员或申请人本人可恢复该作业');
    }
    if (app.status !== 'paused') throw new BadRequestException('仅已暂停的作业可恢复');
    await this.db
      .update(schema.workPermitApplications)
      .set({ status: 'printed', updatedAt: new Date() })
      .where(eq(schema.workPermitApplications.id, id));
    return { success: true, status: 'printed' };
  }

  // 作废（仅 EHS/管理员，work_permit:void）；留痕，可选重开新票号
  async void(id: string, dto: { reason?: string; reopen?: boolean }, user: { userId: string; name: string }) {
    const app = await this.ensure(id);
    if (app.status === 'voided') throw new BadRequestException('该作业申请单已作废');
    if (app.status === 'completed') throw new BadRequestException('已归档的作业不可作废');
    let replacedByPermitNo: string | undefined;
    let newId: string | undefined;
    if (dto.reopen) {
      const newNo = await this.genNo();
      const [copy] = await this.db
        .insert(schema.workPermitApplications)
        .values({
          permitNo: newNo,
          applicantId: app.applicantId,
          applicantName: app.applicantName,
          department: app.department,
          area: app.area,
          location: app.location,
          jobName: app.jobName,
          content: app.content,
          planStart: app.planStart,
          planEnd: app.planEnd,
          operatorNames: app.operatorNames,
          supervisorName: app.supervisorName,
          supervisorContact: app.supervisorContact,
          operatorContact: app.operatorContact,
          involvesHazardous: app.involvesHazardous,
          status: 'draft',
        })
        .returning({ id: schema.workPermitApplications.id, permitNo: schema.workPermitApplications.permitNo });
      replacedByPermitNo = copy.permitNo;
      newId = copy.id;
    }
    await this.db
      .update(schema.workPermitApplications)
      .set({ status: 'voided', voidedAt: new Date(), voidedBy: user.userId, voidedByName: user.name, voidReason: dto.reason, replacedByPermitNo, updatedAt: new Date() })
      .where(eq(schema.workPermitApplications.id, id));
    return { success: true, status: 'voided', replacedByPermitNo, newId };
  }

  // 完工（现场作业结束，待归档）
  async finish(id: string) {
    const app = await this.ensure(id);
    if (app.status !== 'printed' && app.status !== 'paused') throw new BadRequestException('仅执行中/暂停的作业可标记完工');
    // P0-4 每日巡检硬强制：printed 起缺巡检次日禁流转
    await this.assertDailyInspections(app, '完工');
    // P1-2：常规作业申请单须完成承包商安全培训
    await this.validateTraining(app);
    await this.db.update(schema.workPermitApplications).set({ status: 'finished', finishedAt: new Date(), updatedAt: new Date() }).where(eq(schema.workPermitApplications.id, id));
    return { success: true, status: 'finished' };
  }

  // 归档（完工后电子留档 + 纸质回传扫描已齐）
  async archive(id: string) {
    const app = await this.ensure(id);
    if (app.status !== 'finished') throw new BadRequestException('仅完工的作业可归档');
    // P0-4 每日巡检硬强制：printed 起缺巡检次日禁流转
    await this.assertDailyInspections(app, '归档');
    // P1-2：常规作业申请单须完成承包商安全培训
    await this.validateTraining(app);
    await this.db.update(schema.workPermitApplications).set({ status: 'completed', archivedAt: new Date(), updatedAt: new Date() }).where(eq(schema.workPermitApplications.id, id));
    // 关联危险作业票一并归档（逐张校验签字完整性）
    const permits = await this.db
      .select()
      .from(schema.workPermits)
      .where(and(eq(schema.workPermits.applicationId, id), sql`${schema.workPermits.status} in ('printed','paused','finished')`));
    for (const wp of permits) {
      // 校验现场多方签字完整性
      this.validateWorkPermitSignatures(wp);
      // 完工 → 归档
      await this.db.update(schema.workPermits).set({ status: 'completed', archivedAt: new Date(), updatedAt: new Date() }).where(eq(schema.workPermits.id, wp.id));
    }
    return { success: true, status: 'completed' };
  }

  // 今日是否进行判定的人工覆盖（EHS/现场）
  async setDailyOverride(id: string, dto: { override: 'active' | 'inactive' | null }) {
    await this.ensure(id);
    await this.db.update(schema.workPermitApplications).set({ dailyOverride: dto.override ?? null, updatedAt: new Date() }).where(eq(schema.workPermitApplications.id, id));
    return { success: true };
  }

  // ================= 看板：今日在做什么 / 按天回看 =================
  // 判定规则：dailyOverride 优先（active/inactive）；否则按计划时间自动（planStart<=当天结束 且 planEnd>=当天开始）。
  // 仅纳入执行态(printed/paused)与目标日在计划区间内的作业。
  async board(dateStr?: string, channel: 'paper' | 'electronic' = 'paper') {
    await this.workPermits.autoArchiveExpired(); // 看板加载前先做超期自动归档
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
    const isTodayApp = (a: any): boolean => {
      if (a.dailyOverride === 'active') return true;
      if (a.dailyOverride === 'inactive') return false;
      const ps = a.planStart ? new Date(a.planStart) : null;
      const pe = a.planEnd ? new Date(a.planEnd) : null;
      if (ps && pe) return ps <= end && pe >= start;
      return a.status === 'printed' || a.status === 'paused';
    };
    const isTodayWp = (w: any): boolean => {
      // 临时用电危险作业票有效期 ≤15 天，不强制当日；其余危险作业票须当日
      if (w.type === 'temporary_electricity') return true;
      const ps = w.startTime ? new Date(w.startTime) : null;
      const pe = w.endTime ? new Date(w.endTime) : null;
      if (ps && pe) return ps <= end && pe >= start;
      return w.status === 'printed' || w.status === 'paused';
    };

    // ① 常规作业票（work_permits, isHazardous=false）——看板主卡片；承包商信息从关联申请单补充
    const routineRows = await this.db
      .select({
        wp: schema.workPermits,
        app: schema.workPermitApplications,
      })
      .from(schema.workPermits)
      .leftJoin(schema.workPermitApplications, eq(schema.workPermits.applicationId, schema.workPermitApplications.id))
      .where(
        and(
          eq(schema.workPermits.channel, channel),
          eq(schema.workPermits.isHazardous, false),
          sql`${schema.workPermits.status} in ('printed','paused','finished')`,
        ),
      )
      .orderBy(desc(schema.workPermits.printedAt));
    const routineItems = routineRows
      .filter((r) => isTodayWp(r.wp))
      .map((r) => {
        const w = r.wp;
        const app = r.app;
        return {
          id: w.id,
          kind: 'routine',
          permitNo: w.permitNo,
          hazards: [] as any[],
          jobName: app?.jobName || w.content || '常规作业',
          projectName: app?.projectName || '',
          content: w.content || app?.content || '',
          location: w.location || app?.location || '',
          department: w.department || app?.department || '',
          applicantName: w.applicantName || app?.applicantName || '',
          operatorNames: Array.isArray(w.operatorNames) ? w.operatorNames : Array.isArray(app?.operatorNames) ? app.operatorNames : [],
          contractorUnit: app?.contractorUnit || '',
          contractorHead: app?.contractorHead || '',
          contractorPhone: app?.contractorPhone || '',
          managementDept: app?.managementDept || w.department || '',
          managementPerson: app?.managementPerson || '',
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
        };
      });

    // ② 危险作业票（workPermits 子票，isHazardous）：按作业属性分类型，检查内容随类型
    const wpRows = await this.db
      .select({
        wp: schema.workPermits,
        app: schema.workPermitApplications,
      })
      .from(schema.workPermits)
      .leftJoin(schema.workPermitApplications, eq(schema.workPermits.applicationId, schema.workPermitApplications.id))
      .where(
        and(
          eq(schema.workPermits.channel, channel),
          eq(schema.workPermits.isHazardous, true),
          sql`${schema.workPermits.status} in ('printed','paused','finished')`,
        ),
      )
      .orderBy(desc(schema.workPermits.printedAt));
    const hazardItems = wpRows
      .filter((r) => isTodayWp(r.wp))
      .map((r) => {
        const w = r.wp;
        const app = r.app;
        const label = HZ_LABEL[w.type] || w.type;
        return {
          id: w.id,
          kind: 'hazard',
          permitNo: w.permitNo,
          jobName: app?.jobName || w.content || '危险作业',
          projectName: app?.projectName || '',
          content: w.content || '',
          location: w.location || app?.location || '',
          department: w.department || app?.department || '',
          applicantName: w.applicantName || app?.applicantName || '',
          operatorNames: Array.isArray(w.operatorNames) ? w.operatorNames : [],
          contractorUnit: app?.contractorUnit || '',
          contractorHead: app?.contractorHead || '',
          contractorPhone: app?.contractorPhone || '',
          managementDept: app?.managementDept || w.department || '',
          managementPerson: app?.managementPerson || '',
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

    // ③ 看板只展示常规作业票；危险票按「依附常规票」嵌套到对应常规票卡片内（linkedRoutineId 匹配常规票 id）
    // 仅嵌套进行中/已暂停（printed/paused）危险票；finished/completed 危险票不嵌套
    const hazardByRoutine = new Map<string, any[]>();
    for (const h of hazardItems) {
      if (h.status !== 'printed' && h.status !== 'paused') continue;
      const key = h.linkedRoutineId || '';
      if (!key) continue;
      if (!hazardByRoutine.has(key)) hazardByRoutine.set(key, []);
      hazardByRoutine.get(key)!.push(h);
    }
    for (const item of routineItems) {
      item.hazards = hazardByRoutine.get(item.id) || [];
    }
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

  async list(params: any, user: any) {
    const page = Number(params.page ?? 1);
    const pageSize = Math.min(Number(params.pageSize ?? 20), 100);
    const offset = (page - 1) * pageSize;
    const where: any[] = [];
    where.push(eq(schema.workPermitApplications.channel, params.channel || 'paper'));
    // 【提交即转作业票】申请单列表只展示草稿（draft）；已提交的申请单（converted）不在列表出现，
    // 审批/执行全部在「常规/危险作业管理」的作业票上进行。
    where.push(eq(schema.workPermitApplications.status, 'draft'));
    if (params.keyword) where.push(ilike(schema.workPermitApplications.content, `%${params.keyword}%`));
    if (params.department) where.push(eq(schema.workPermitApplications.department, params.department));
    if (params.involvesHazardous) where.push(eq(schema.workPermitApplications.involvesHazardous, params.involvesHazardous === 'true'));
    const canViewAll = isSuperAdmin(user) || (user.permissions || []).includes('epermit:view_all');
    if (!canViewAll) where.push(eq(schema.workPermitApplications.applicantId, user.userId));
    else if (params.scope === 'mine') where.push(eq(schema.workPermitApplications.applicantId, user.userId));
    const cond = where.length ? and(...where) : undefined;
    const [rows, totalRows] = await Promise.all([
      this.db.select().from(schema.workPermitApplications).where(cond).orderBy(desc(schema.workPermitApplications.createdAt)).limit(pageSize).offset(offset),
      this.db.select({ c: count() }).from(schema.workPermitApplications).where(cond),
    ]);
    const ids = rows.map((r: any) => r.id);
    let items: any[] = rows;
    if (ids.length) {
      const [briefings, permits] = await Promise.all([
        this.db.select().from(schema.safetyBriefings).where(inArray(schema.safetyBriefings.applicationId, ids)),
        this.db
          .select({ applicationId: schema.workPermits.applicationId, type: schema.workPermits.type })
          .from(schema.workPermits)
          .where(inArray(schema.workPermits.applicationId, ids)),
      ]);
      const bfMap = new Map<string, any>();
      briefings.forEach((b: any) => bfMap.set(b.applicationId, b));
      const wpMap = new Map<string, string[]>();
      permits.forEach((p: any) => {
        if (!wpMap.has(p.applicationId)) wpMap.set(p.applicationId, []);
        wpMap.get(p.applicationId)!.push(p.type);
      });
      items = rows.map((a: any) => ({
        ...a,
        missingHazardPermits: computeMissingHazardPermits(bfMap.get(a.id) ?? null, wpMap.get(a.id) ?? []),
      }));
    } else {
      items = rows.map((a: any) => ({ ...a, missingHazardPermits: [] }));
    }
    return { items, total: Number(totalRows[0]?.c ?? 0) };
  }

  async getDetail(id: string, user: any) {
    const app = await this.ensure(id);
    const canViewAll = isSuperAdmin(user) || (user.permissions || []).includes('epermit:view_all');
    if (!canViewAll && app.applicantId !== user.userId) throw new ForbiddenException('无权查看该作业申请单');
    const training = app.trainingId
      ? ((await this.db.select().from(schema.workPermitTrainings).where(eq(schema.workPermitTrainings.id, app.trainingId)).limit(1))[0] ?? null)
      : null;
    const workPermits = await this.db.select().from(schema.workPermits).where(eq(schema.workPermits.applicationId, id));
    const [briefing] = await this.db.select().from(schema.safetyBriefings).where(eq(schema.safetyBriefings.applicationId, id)).limit(1);
    const inspections = await this.db
      .select()
      .from(schema.inspectionRecords)
      .where(eq(schema.inspectionRecords.applicationId, id))
      .orderBy(desc(schema.inspectionRecords.inspectedAt));
    return { ...app, training, workPermits, briefing: briefing ?? null, inspections, missingHazardPermits: computeMissingHazardPermits(briefing, workPermits.map((w: any) => w.type)) };
  }

  async myHistory(userId: string) {
    return this.db
      .select()
      .from(schema.workPermitApplications)
      .where(eq(schema.workPermitApplications.applicantId, userId))
      .orderBy(desc(schema.workPermitApplications.createdAt))
      .limit(50);
  }

  async stats(channel: 'paper' | 'electronic' = 'paper') {
    const ch = eq(schema.workPermitApplications.channel, channel);
    const byStatus = await this.db
      .select({ status: schema.workPermitApplications.status, c: count() })
      .from(schema.workPermitApplications)
      .where(ch)
      .groupBy(schema.workPermitApplications.status);
    const total = await this.db.select({ c: count() }).from(schema.workPermitApplications).where(ch);
    const pending = await this.db
      .select({ c: count() })
      .from(schema.workPermitApplications)
      .where(and(ch, sql`${schema.workPermitApplications.status} in ('pending_review','reviewing')`));
    return {
      total: Number(total[0]?.c ?? 0),
      pending: Number(pending[0]?.c ?? 0),
      byStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.c) })),
    };
  }

  // ================= 年度统计（多维）=================
  // 今年作业票数 / 可记录巡检次数，按类型/月份/部门/承包商，含作废/暂停次数
  async annualStats(yearParam?: number) {
    const year = yearParam || new Date().getFullYear();
    const yStart = new Date(year, 0, 1);
    const yEnd = new Date(year + 1, 0, 1);
    const inYear = and(gte(schema.workPermitApplications.createdAt, yStart), lt(schema.workPermitApplications.createdAt, yEnd));

    const apps = await this.db.select().from(schema.workPermitApplications).where(inYear);
    // 按月
    const byMonth: Record<string, number> = {};
    // 按部门
    const byDept: Record<string, number> = {};
    // 按承包商（监护人/负责人 supervisorName 近似）
    const byContractor: Record<string, number> = {};
    let voided = 0;
    let paused = 0;
    for (const a of apps) {
      const m = new Date(a.createdAt).getMonth() + 1;
      byMonth[m] = (byMonth[m] || 0) + 1;
      if (a.department) byDept[a.department] = (byDept[a.department] || 0) + 1;
      if (a.supervisorName) byContractor[a.supervisorName] = (byContractor[a.supervisorName] || 0) + 1;
      if (a.status === 'voided') voided++;
      if (a.pausedAt) paused++;
    }
    // 危险作业票按类型
    const permits = await this.db
      .select({ type: schema.workPermits.type })
      .from(schema.workPermits)
      .innerJoin(schema.workPermitApplications, eq(schema.workPermits.applicationId, schema.workPermitApplications.id))
      .where(inYear);
    const byType: Record<string, number> = {};
    for (const p of permits) {
      const label = getWorkPermitType(p.type).label;
      byType[label] = (byType[label] || 0) + 1;
    }
    // 巡检次数
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
      totalApplications: apps.length,
      totalPermits: permits.length,
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

  async remove(id: string) {
    const app = await this.ensure(id);
    if (app.status !== 'draft') throw new BadRequestException('仅草稿可删除');
    await this.db.delete(schema.workPermitApplications).where(eq(schema.workPermitApplications.id, id));
    return { success: true };
  }

  private async ensure(id: string) {
    const [app] = await this.db.select().from(schema.workPermitApplications).where(eq(schema.workPermitApplications.id, id)).limit(1);
    if (!app) throw new NotFoundException('作业申请单不存在');
    return app;
  }
}
