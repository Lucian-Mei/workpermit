import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Inject } from '@nestjs/common';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, ilike, and, count, desc, or, gte, sql, inArray } from 'drizzle-orm';
import * as schema from '@/database/schema';
import { AiService } from '@/modules/ai/ai.service';
import { EmailService } from '@/modules/email/email.service';
import { LotteryService } from '@/modules/lottery/lottery.service';
import { isSuperAdmin } from '@/common/permissions';
import { appBaseUrl } from '@/common/base-url';

export interface HazardInput {
  building?: string;
  floor?: string;
  location?: string;
  area?: string;
  department?: string;
  description?: string;
  suggestAction?: string; // 整改建议（建议措施），登录上报必填
  photos?: string[];
  submitterName?: string; // 免登录上报填写姓名
  isAnonymous?: boolean;
  captchaId?: string; // 免登录上报验证码
  captchaAnswer?: number;
}

@Injectable()
export class HazardsService {
  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    private ai: AiService,
    private email: EmailService,
    private lottery: LotteryService,
  ) {}

  // 生成隐患编号：HZ-{YYYY}{NNNN}（按年度累计 4 位流水）
  private async genHazardNo(): Promise<string> {
    const now = new Date();
    const year = String(now.getFullYear());
    const prefix = `HZ-${year}`;
    const like = `${prefix}%`;
    const rows = await this.db
      .select({ no: schema.hazards.hazardNo })
      .from(schema.hazards)
      .where(ilike(schema.hazards.hazardNo, like))
      .orderBy(desc(schema.hazards.hazardNo))
      .limit(1);
    let seq = 1;
    if (rows.length) {
      const num = parseInt(rows[0].no.slice(prefix.length), 10);
      if (!isNaN(num)) seq = num + 1;
    }
    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  // 微信免登录上报（公开接口，含验证码 + 多重限流，防恶意填报）
  async createAnonymous(input: HazardInput, ip: string) {
    // 1) 验证码校验（一次性，防机器人批量提交）
    if (!this.verifyCaptcha(input.captchaId, input.captchaAnswer)) {
      throw new BadRequestException('验证码错误或已过期，请刷新后重试');
    }
    if (!input.description && !input.location) throw new BadRequestException('请填写隐患描述或位置');
    if (!input.photos || input.photos.length === 0) throw new BadRequestException('请至少上传一张现场照片');
    if (input.photos.length > 6) throw new BadRequestException('最多上传 6 张照片');
    const submitterName = input.submitterName?.trim() || '匿名';

    // 2) 多重限流：同一 IP 1 分钟内最多 10 条、1 小时内最多 30 条
    const oneMinAgo = new Date(Date.now() - 60 * 1000);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [cntMin, cntHour] = await Promise.all([
      this.db.select({ c: count() }).from(schema.submissionLog).where(and(eq(schema.submissionLog.clientIp, ip), gte(schema.submissionLog.submittedAt, oneMinAgo))),
      this.db.select({ c: count() }).from(schema.submissionLog).where(and(eq(schema.submissionLog.clientIp, ip), gte(schema.submissionLog.submittedAt, oneHourAgo))),
    ]);
    if (Number(cntMin?.[0]?.c ?? 0) >= 10) throw new BadRequestException('操作过于频繁，请 1 分钟后再试');
    if (Number(cntHour?.[0]?.c ?? 0) >= 30) throw new BadRequestException('今日提交过多，请稍后再试');

    const [log] = await this.db
      .insert(schema.submissionLog)
      .values({ clientIp: ip, kind: 'hazard' })
      .returning({ id: schema.submissionLog.id });
    const [h] = await this.db
      .insert(schema.hazards)
      .values({
        hazardNo: await this.genHazardNo(),
        submitterName,
        isAnonymous: true,
        building: input.building,
        floor: input.floor,
        location: input.location,
        area: input.area,
        department: input.department,
        photos: input.photos ?? [],
        description: input.description,
        suggestAction: input.suggestAction?.trim() || null,
        status: 'pending_assign',
      })
      .returning({ id: schema.hazards.id, hazardNo: schema.hazards.hazardNo });
    void log;
    await this.email
      ?.notify('hazard_submitted', {
        hazardNo: h.hazardNo,
        submitter: submitterName || '',
        location: input.location || '',
        riskLevel: '',
        description: input.description || '',
        actionUrl: `${appBaseUrl()}/hazards`,
        perms: ['hazard:assign', 'hazard:view_all'],
      })
      ;
    // 提交后抽奖（如已启用）
    const lottery = await this.lottery.draw({ name: submitterName }).catch(() => null);
    return { id: h.id, hazardNo: h.hazardNo, message: '上报成功，可在登录后查看历史。', lottery };
  }

  // ========== 轻量验证码（内存态，防恶意批量填报） ==========
  // key: 验证码ID -> { a, b, answer, expire }
  private captchas = new Map<string, { a: number; b: number; answer: number; expire: number }>();

  issueCaptcha(): { id: string; a: number; b: number } {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const a = Math.floor(Math.random() * 9) + 1;
    const b = Math.floor(Math.random() * 9) + 1;
    this.captchas.set(id, { a, b, answer: a + b, expire: Date.now() + 5 * 60 * 1000 });
    // 顺手清理过期项
    for (const [k, v] of this.captchas) if (v.expire < Date.now()) this.captchas.delete(k);
    return { id, a, b };
  }

  verifyCaptcha(id?: string, answer?: number): boolean {
    if (!id || answer === undefined) return false;
    const rec = this.captchas.get(id);
    if (!rec) return false;
    this.captchas.delete(id); // 一次性
    return rec.expire >= Date.now() && rec.answer === Number(answer);
  }

  // 登录用户上报（提报人姓名默认可编辑，缺省回退为登录人姓名）
  async createByUser(input: HazardInput, user: { userId: string; name: string; department?: string }) {
    if (!input.description && !input.location) throw new BadRequestException('请填写隐患描述或位置');
    if (!input.suggestAction?.trim()) throw new BadRequestException('请填写整改建议（建议措施）');
    if (!input.photos || input.photos.length === 0) throw new BadRequestException('请至少上传一张现场照片');
    const submitterName = (input.submitterName && input.submitterName.trim()) || user.name;
    const [h] = await this.db
      .insert(schema.hazards)
      .values({
        hazardNo: await this.genHazardNo(),
        submitterUserId: user.userId,
        submitterName,
        isAnonymous: false,
        building: input.building,
        floor: input.floor,
        location: input.location,
        area: input.area,
        department: input.department || user.department,
        photos: input.photos ?? [],
        description: input.description,
        suggestAction: input.suggestAction?.trim(),
        status: 'pending_assign',
      })
      .returning({ id: schema.hazards.id, hazardNo: schema.hazards.hazardNo });
    await this.email
      ?.notify('hazard_submitted', {
        hazardNo: h.hazardNo,
        submitter: user.name,
        location: input.location || '',
        riskLevel: '',
        description: input.description || '',
        actionUrl: `${appBaseUrl()}/hazards`,
        perms: ['hazard:assign', 'hazard:view_all'],
      })
      ;
    // 提交后抽奖（如已启用），中奖记录关联本隐患
    const lottery = await this.lottery
      .draw(user, { source: 'hazard', refId: h.id, refNo: h.hazardNo })
      .catch(() => null);
    return { id: h.id, hazardNo: h.hazardNo, lottery };
  }

  // AI 分析（不落库，返回结构化结果供前端确认填表）
  async analyze(input: { description: string; location?: string; hazardType?: string }) {
    return this.ai.analyzeHazard(input);
  }

  // AI 分析（流式，逐 token 产出）
  analyzeHazardStream(input: { description: string; location?: string; hazardType?: string }) {
    return this.ai.analyzeHazardStream(input);
  }

  // 免登录也支持 AI 分析（界面与登录填报一致），但按 IP 限流防滥用（1 分钟最多 10 次）
  async assertAiRateLimit(ip: string) {
    const oneMinAgo = new Date(Date.now() - 60 * 1000);
    const [cnt] = await this.db
      .select({ c: count() })
      .from(schema.submissionLog)
      .where(and(eq(schema.submissionLog.clientIp, ip), eq(schema.submissionLog.kind, 'ai'), gte(schema.submissionLog.submittedAt, oneMinAgo)));
    if (Number(cnt?.[0]?.c ?? 0) >= 10) throw new BadRequestException('AI 分析过于频繁，请 1 分钟后再试');
    await this.db.insert(schema.submissionLog).values({ clientIp: ip, kind: 'ai' });
  }

  // 审批人/安全员把 AI 分析结果应用到某条隐患
  async applyAi(id: string, fields: Record<string, any>) {
    await this.ensure(id);
    const patch: any = { updatedAt: new Date() };
    if (fields.aiDescription !== undefined) patch.aiDescription = fields.aiDescription;
    if (fields.aiCategory !== undefined) patch.aiCategory = fields.aiCategory;
    if (fields.aiRiskLevel !== undefined) patch.aiRiskLevel = fields.aiRiskLevel;
    if (fields.aiRegulation !== undefined) patch.aiRegulation = fields.aiRegulation;
    if (fields.aiSuggestion !== undefined) patch.aiSuggestion = fields.aiSuggestion;
    if (fields.aiRootCause !== undefined) patch.aiRootCause = fields.aiRootCause;
    if (fields.ai5Why !== undefined) patch.ai5Why = fields.ai5Why;
    if (fields.aiControlMeasures !== undefined) patch.aiControlMeasures = fields.aiControlMeasures;
    if (fields.riskLevel !== undefined) patch.riskLevel = fields.riskLevel;
    if (fields.categoryApproved !== undefined) patch.categoryApproved = fields.categoryApproved;
    await this.db.update(schema.hazards).set(patch).where(eq(schema.hazards.id, id));
    return { success: true };
  }

  // 记录隐患处理过程
  private async logActivity(
    hazardId: string,
    operator: { userId?: string; name?: string },
    action: string,
    fromStatus?: string,
    toStatus?: string,
    comment?: string,
    payload?: Record<string, any>,
  ) {
    await this.db.insert(schema.hazardActivities).values({
      hazardId,
      operatorId: operator.userId || null,
      operatorName: operator.name || '系统',
      action,
      fromStatus: fromStatus || null,
      toStatus: toStatus || null,
      comment: comment || null,
      payload: payload || {},
    });
  }

  // 按风险等级自动计算默认整改期限（固定映射，2026-08 移除 risk_levels 配置表后改为常量）
  private defaultDeadlineByRisk(riskLevel?: string): Date {
    const level = riskLevel || 'low';
    const days = level === 'critical' ? 1 : level === 'high' ? 3 : level === 'medium' ? 7 : 30;
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  // 派单
  async assign(
    id: string,
    dto: {
      assignedDeptId?: string;
      allocatedDepartment?: string;
      assigneeId?: string;
      assigneeName?: string;
      deadline?: string;
      riskLevel?: string;
    },
    user: any,
  ) {
    const h = await this.loadCtx(id);
    if (!h) throw new NotFoundException('隐患不存在');

    let deptName = dto.allocatedDepartment;
    let deptId = dto.assignedDeptId;

    // 兼容旧数据：如果只有部门名称，则反查部门ID
    if (!deptId && deptName) {
      const [d] = await this.db
        .select({ id: schema.departments.id })
        .from(schema.departments)
        .where(eq(schema.departments.name, deptName))
        .limit(1);
      if (d) deptId = d.id;
    }

    // 如果只有部门ID，反查部门名称
    if (deptId && !deptName) {
      const [d] = await this.db
        .select({ name: schema.departments.name })
        .from(schema.departments)
        .where(eq(schema.departments.id, deptId))
        .limit(1);
      if (d) deptName = d.name;
    }

    if (!deptId && !deptName) throw new BadRequestException('请选择责任部门');
    if (!dto.assigneeId && !dto.assigneeName?.trim()) throw new BadRequestException('请选择整改负责人');

    const risk = dto.riskLevel || h.riskLevel || 'low';
    const deadline = dto.deadline
      ? new Date(dto.deadline)
      : this.defaultDeadlineByRisk(risk);

    const patch: any = {
      status: 'assigned',
      allocatedDepartment: deptName,
      assignedDeptId: deptId,
      assigneeId: dto.assigneeId || null,
      assigneeName: dto.assigneeName?.trim() || h.assigneeName || '',
      riskLevel: risk,
      deadline,
      updatedAt: new Date(),
    };

    await this.db.update(schema.hazards).set(patch).where(eq(schema.hazards.id, id));
    await this.logActivity(
      id,
      user,
      'assign',
      h.status,
      'assigned',
      `派单至 ${deptName} / ${patch.assigneeName}`,
      { deptId, deptName, assigneeId: dto.assigneeId, assigneeName: patch.assigneeName, deadline, riskLevel: risk },
    );

    if (h) {
      await this.email
        ?.notify('hazard_assigned', {
          hazardNo: h.hazardNo,
          assignee: patch.assigneeName || '',
          location: h.location || '',
          riskLevel: risk || '',
          deadline: deadline.toISOString(),
          actionUrl: `${appBaseUrl()}/hazards/${h.id}`,
          perms: ['hazard:view_all'],
        })
        ;
    }
    return { success: true };
  }

  // 整改
  async rectify(
    id: string,
    dto: { rectificationDesc?: string; rectificationFiles?: string[]; rectificationDate?: string },
    user: any,
  ) {
    const h = await this.loadCtx(id);
    if (!h) throw new NotFoundException('隐患不存在');
    if (!dto.rectificationDesc?.trim()) throw new BadRequestException('请填写整改说明');
    if (!dto.rectificationFiles || dto.rectificationFiles.length === 0) throw new BadRequestException('请上传整改附件作为证据');
    if (!dto.rectificationDate) throw new BadRequestException('请填写整改完成日期');

    await this.db
      .update(schema.hazards)
      .set({
        status: 'rectified',
        rectificationDesc: dto.rectificationDesc.trim(),
        rectificationFiles: dto.rectificationFiles,
        rectificationDate: new Date(dto.rectificationDate),
        updatedAt: new Date(),
      })
      .where(eq(schema.hazards.id, id));

    await this.logActivity(
      id,
      user,
      'rectify',
      h.status,
      'rectified',
      dto.rectificationDesc.trim(),
      { rectificationDate: dto.rectificationDate, files: dto.rectificationFiles },
    );

    if (h) {
      await this.email
        ?.notify('hazard_rectified', {
          hazardNo: h.hazardNo,
          assignee: h.assigneeName || '',
          rectificationDesc: dto.rectificationDesc || '',
          actionUrl: `${appBaseUrl()}/hazards/${h.id}`,
          perms: ['hazard:dept_review', 'hazard:view_all'],
        })
        ;
    }
    return { success: true };
  }

  // 整改人员转发给部门内其他人员
  async forward(id: string, dto: { assigneeId?: string; assigneeName?: string; reason?: string }, user: any) {
    const h = await this.loadCtx(id);
    if (!h) throw new NotFoundException('隐患不存在');
    if (h.status !== 'assigned') throw new BadRequestException('仅整改中的任务可转发');

    // 操作人必须是当前整改负责人，或管理员/EHS
    const isAssignee = h.assigneeId && h.assigneeId === user.userId;
    const isAdmin = isSuperAdmin(user) || (user.permissions || []).includes('hazard:assign');
    if (!isAssignee && !isAdmin) throw new ForbiddenException('无权限：仅当前整改负责人或管理员可转发');

    if (!dto.assigneeId && !dto.assigneeName?.trim()) throw new BadRequestException('请选择新的整改负责人');

    await this.db
      .update(schema.hazards)
      .set({
        assigneeId: dto.assigneeId || null,
        assigneeName: dto.assigneeName?.trim() || '',
        updatedAt: new Date(),
      })
      .where(eq(schema.hazards.id, id));

    await this.logActivity(
      id,
      user,
      'forward',
      h.status,
      h.status,
      dto.reason || `转发给 ${dto.assigneeName?.trim() || ''}`,
      { newAssigneeId: dto.assigneeId, newAssigneeName: dto.assigneeName?.trim() },
    );
    return { success: true };
  }

  // 整改人员退回给管理人员（重新派单）
  async returnToManager(id: string, dto: { reason?: string }, user: any) {
    const h = await this.loadCtx(id);
    if (!h) throw new NotFoundException('隐患不存在');
    if (h.status !== 'assigned') throw new BadRequestException('仅整改中的任务可退回');

    const isAssignee = h.assigneeId && h.assigneeId === user.userId;
    const isAdmin = isSuperAdmin(user) || (user.permissions || []).includes('hazard:assign');
    if (!isAssignee && !isAdmin) throw new ForbiddenException('无权限：仅当前整改负责人或管理员可退回');
    if (!dto.reason?.trim()) throw new BadRequestException('请填写退回原因');

    await this.db
      .update(schema.hazards)
      .set({
        status: 'pending_assign',
        assigneeId: null,
        assigneeName: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.hazards.id, id));

    await this.logActivity(id, user, 'return', h.status, 'pending_assign', dto.reason.trim(), {});
    return { success: true };
  }

  // 部门负责人审核确认：整改完成后，须部门负责人确认，方可流转至 EHS 验收
  async deptReview(
    id: string,
    dto: { result: 'confirm' | 'reject'; rejectReason?: string; comment?: string },
    user: any,
  ) {
    const h = await this.loadCtx(id);
    if (!h) throw new BadRequestException('隐患不存在');
    if (h.status !== 'rectified') throw new BadRequestException('当前状态无需部门确认（仅「待部门确认」可操作）');

    // 数据级授权：必须是该隐患责任部门的负责人；EHS/管理员（持 hazard:accept）作为兜底，避免流程卡死
    const isManager = Array.isArray(user.managedDepartments) && user.managedDepartments.includes(h.allocatedDepartment);
    const isEhs = Array.isArray(user.permissions) && user.permissions.includes('hazard:accept');
    if (!isManager && !isEhs) {
      throw new ForbiddenException('无权限：仅责任部门负责人或隐患管理员可审核确认');
    }

    if (dto.result === 'confirm') {
      await this.db
        .update(schema.hazards)
        .set({ status: 'dept_confirmed', updatedAt: new Date() })
        .where(eq(schema.hazards.id, id));
      await this.logActivity(id, user, 'dept_review', h.status, 'dept_confirmed', dto.comment || '确认通过，流转至 EHS 验收', {});
      if (h) {
        await this.email
          ?.notify('hazard_dept_confirmed', {
            hazardNo: h.hazardNo,
            department: h.allocatedDepartment || '',
            actionUrl: `${appBaseUrl()}/hazards/${h.id}`,
            perms: ['hazard:accept', 'hazard:view_all'],
          })
          ;
      }
    } else {
      if (!dto.rejectReason?.trim()) throw new BadRequestException('请填写驳回原因');
      await this.db
        .update(schema.hazards)
        .set({
          status: 'rejected',
          acceptanceResult: 'fail',
          rejectionReason: dto.rejectReason,
          updatedAt: new Date(),
        })
        .where(eq(schema.hazards.id, id));
      await this.logActivity(
        id,
        user,
        'dept_review',
        h.status,
        'rejected',
        [dto.rejectReason, dto.comment].filter(Boolean).join('；'),
        {},
      );
      if (h) {
        await this.email
          ?.notify('hazard_rejected', {
            hazardNo: h.hazardNo,
            assignee: h.assigneeName || '',
            reason: dto.rejectReason || '',
            actionUrl: `${appBaseUrl()}/hazards/${h.id}`,
            perms: ['hazard:rectify', 'hazard:view_all'],
          })
          ;
      }
    }
    return { success: true };
  }

  // 验收（仅部门已确认、流转至 EHS 的隐患可验收）
  async accept(
    id: string,
    dto: { result: 'pass' | 'fail'; rejectionReason?: string; comment?: string },
    user: any,
  ) {
    const h = await this.loadCtx(id);
    if (!h) throw new NotFoundException('隐患不存在');
    if (h?.status !== 'dept_confirmed') {
      throw new BadRequestException('请先由部门负责人审核确认，尚未流转至验收环节');
    }
    if (dto.result === 'pass') {
      await this.db
        .update(schema.hazards)
        .set({ status: 'accepted', acceptanceResult: 'pass', updatedAt: new Date() })
        .where(eq(schema.hazards.id, id));
      await this.logActivity(id, user, 'accept', h.status, 'accepted', dto.comment || '验收通过', {});
      if (h) {
        await this.email
          ?.notify('hazard_accepted', { hazardNo: h.hazardNo, actionUrl: `${appBaseUrl()}/hazards/${h.id}`, perms: ['hazard:view_all'] })
          ;
      }
    } else {
      if (!dto.rejectionReason?.trim()) throw new BadRequestException('请填写不通过原因');
      await this.db
        .update(schema.hazards)
        .set({
          status: 'rejected',
          acceptanceResult: 'fail',
          rejectionReason: dto.rejectionReason,
          updatedAt: new Date(),
        })
        .where(eq(schema.hazards.id, id));
      await this.logActivity(
        id,
        user,
        'accept',
        h.status,
        'rejected',
        [dto.rejectionReason, dto.comment].filter(Boolean).join('；'),
        {},
      );
      if (h) {
        await this.email
          ?.notify('hazard_rejected', {
            hazardNo: h.hazardNo,
            assignee: h.assigneeName || '',
            reason: dto.rejectionReason || '',
            actionUrl: `${appBaseUrl()}/hazards/${h.id}`,
            perms: ['hazard:rectify', 'hazard:view_all'],
          })
          ;
      }
    }
    return { success: true };
  }

  // 管理员直接归档（已完成）
  async archive(id: string, dto: { reason?: string }, user: any) {
    const h = await this.loadCtx(id);
    if (!h) throw new NotFoundException('隐患不存在');
    if (!isSuperAdmin(user) && !(user.permissions || []).includes('hazard:archive')) {
      throw new ForbiddenException('无权限：仅管理员可直接归档隐患');
    }
    await this.db
      .update(schema.hazards)
      .set({
        status: 'archived',
        archivedReason: dto.reason || null,
        archivedAt: new Date(),
        archivedByName: user.name || '',
        updatedAt: new Date(),
      })
      .where(eq(schema.hazards.id, id));
    await this.logActivity(id, user, 'archive', h.status, 'archived', dto.reason || '管理员直接归档', {});
    return { success: true };
  }

  // 撤销
  async cancel(id: string, user: any) {
    const h = await this.loadCtx(id);
    if (!h) throw new NotFoundException('隐患不存在');
    if (['accepted', 'archived'].includes(h.status)) throw new BadRequestException('已验收/已归档的隐患不可撤销');
    await this.db.update(schema.hazards).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(schema.hazards.id, id));
    await this.logActivity(id, user, 'cancel', h.status, 'cancelled', '', {});
    return { success: true };
  }

  // 部门内用户列表（用于转发选择）
  async departmentUsers(departmentId: string) {
    const [dept] = await this.db
      .select({ name: schema.departments.name })
      .from(schema.departments)
      .where(eq(schema.departments.id, departmentId))
      .limit(1);
    if (!dept) return [];
    const rows = await this.db
      .select({ id: schema.users.id, name: schema.users.name, username: schema.users.username })
      .from(schema.users)
      .where(and(eq(schema.users.department, dept.name), eq(schema.users.status, 'active')))
      .orderBy(schema.users.name);
    return rows;
  }

  // 列表（按权限过滤）
  async list(params: any, user: any) {
    const page = Number(params.page ?? 1);
    const pageSize = Math.min(Number(params.pageSize ?? 20), 100);
    const offset = (page - 1) * pageSize;
    const where: any[] = [];
    if (params.keyword) where.push(ilike(schema.hazards.description, `%${params.keyword}%`));
    if (params.status) where.push(eq(schema.hazards.status, params.status));
    if (params.riskLevel) where.push(eq(schema.hazards.riskLevel, params.riskLevel));
    if (params.department) where.push(eq(schema.hazards.allocatedDepartment, params.department));

    const scope = params.scope; // 'department' | undefined
    const canViewAll = isSuperAdmin(user) || (user.permissions || []).includes('hazard:view_all');
    const canViewDepartment = (user.permissions || []).includes('hazard:view_department');
    const managed = user.managedDepartments || [];

    if (!canViewAll) {
      const ownCond = or(
        eq(schema.hazards.submitterUserId, user.userId),
        and(eq(schema.hazards.isAnonymous, true), eq(schema.hazards.submitterName, user.name)),
      );
      if (scope === 'department' && canViewDepartment && managed.length) {
        // 部门隐患：只看负责部门
        where.push(inArray(schema.hazards.allocatedDepartment, managed));
      } else if (canViewDepartment && managed.length) {
        // 普通列表：自己 + 负责部门
        where.push(or(ownCond, inArray(schema.hazards.allocatedDepartment, managed)));
      } else {
        // 仅自己
        where.push(ownCond);
      }
    } else if (scope === 'mine') {
      // 「我的」强制只看自己提交/匿名的，不受 view_all 影响（admin 走这里也只看自己）
      const ownCond = or(
        eq(schema.hazards.submitterUserId, user.userId),
        and(eq(schema.hazards.isAnonymous, true), eq(schema.hazards.submitterName, user.name)),
      );
      where.push(ownCond);
    } else if (scope === 'department' && managed.length) {
      // 超管看部门隐患也按部门过滤，但通常超管有 view_all，所以这里主要给测试用
      where.push(inArray(schema.hazards.allocatedDepartment, managed));
    }

    // 消息中心「隐患整改」直达：只看指派给我的整改任务（整改人视角）
    if (params.scope === 'assigned') {
      where.push(eq(schema.hazards.assigneeId, user.userId));
    }

    const cond = where.length ? and(...where) : undefined;
    const [rows, totalRows] = await Promise.all([
      this.db.select().from(schema.hazards).where(cond).orderBy(desc(schema.hazards.createdAt)).limit(pageSize).offset(offset),
      this.db.select({ c: count() }).from(schema.hazards).where(cond),
    ]);
    return { items: rows, total: Number(totalRows[0]?.c ?? 0) };
  }

  async getDetail(id: string, user: any) {
    const [h] = await this.db.select().from(schema.hazards).where(eq(schema.hazards.id, id)).limit(1);
    if (!h) throw new NotFoundException('隐患不存在');
    const canViewAll = isSuperAdmin(user) || (user.permissions || []).includes('hazard:view_all');
    const canViewDepartment = (user.permissions || []).includes('hazard:view_department');
    const managed = user.managedDepartments || [];
    const isOwn = h.submitterUserId === user.userId || (h.isAnonymous && h.submitterName === user.name);
    const isDepartment = canViewDepartment && h.allocatedDepartment && managed.includes(h.allocatedDepartment);
    if (!canViewAll && !isOwn && !isDepartment) throw new ForbiddenException('无权查看该隐患');

    const activities = await this.db
      .select()
      .from(schema.hazardActivities)
      .where(eq(schema.hazardActivities.hazardId, id))
      .orderBy(schema.hazardActivities.createdAt);

    // 兼容旧数据：当 hazard_activities 表无记录但隐患已被处理，按 h 字段合成虚拟活动（让拆分卡片立即可见）
    let finalActivities = activities;
    if (activities.length === 0 && h.status && h.status !== 'pending_assign') {
      finalActivities = this.synthesizeActivitiesFromHazard(h);
    }

    return { ...h, activities: finalActivities };
  }

  /** 从 h 字段按状态时间线合成虚拟活动（仅在 hazard_activities 为空时使用） */
  private synthesizeActivitiesFromHazard(h: any): any[] {
    const out: any[] = [];
    const baseTs = h.createdAt ? new Date(h.createdAt).getTime() : Date.now();
    const day = 86400000;
    const tsAfter = (n: number) => new Date(baseTs + n * day).toISOString();

    if (h.assigneeName && h.allocatedDepartment) {
      out.push({
        action: 'assign',
        operatorName: h.submitterName || '派单人',
        createdAt: tsAfter(0),
        comment: '',
        payload: { allocatedDepartment: h.allocatedDepartment, assigneeName: h.assigneeName },
      });
    }
    if (h.rectificationDesc) {
      out.push({
        action: 'rectify',
        operatorName: h.assigneeName || '整改人',
        createdAt: tsAfter(1),
        comment: h.rectificationDesc,
        payload: { rectificationDesc: h.rectificationDesc },
      });
    }
    if (['dept_confirmed', 'accepted', 'rejected', 'archived'].includes(h.status) && h.assigneeName) {
      out.push({
        action: 'dept_review',
        operatorName: '部门负责人',
        createdAt: tsAfter(2),
        comment: h.acceptanceResult === 'fail' ? '审核通过，转 EHS 验收' : '审核通过，转 EHS 验收',
        payload: { result: 'pass' },
      });
    }
    if (h.acceptanceResult || h.status === 'accepted' || h.status === 'rejected') {
      out.push({
        action: 'accept',
        operatorName: h.archivedByName || 'EHS 验收人',
        createdAt: tsAfter(3),
        comment: h.acceptanceResult === 'fail' ? `验收不通过：${h.rejectionReason || ''}` : '验收通过',
        payload: { result: h.acceptanceResult || 'pass', rejectionReason: h.rejectionReason || '' },
      });
    }
    if (h.status === 'cancelled') {
      out.push({
        action: 'cancel',
        operatorName: '管理员',
        createdAt: tsAfter(1),
        comment: '该隐患经核实后撤销（历史数据未记录原因）',
        payload: { reason: '该隐患经核实后撤销' },
      });
    }
    if (h.status === 'archived' && h.archivedAt) {
      out.push({
        action: 'archive',
        operatorName: h.archivedByName || '管理员',
        createdAt: h.archivedAt,
        comment: h.archivedReason || '已归档',
        payload: { reason: h.archivedReason || '' },
      });
    }
    return out;
  }

  // 部门隐患统计（仅状态，用于卡片）
  async departmentStats(user: any) {
    // 系统管理员（超级管理员）看全厂
    if (isSuperAdmin(user)) {
      const byStatus = await this.db
        .select({ status: schema.hazards.status, c: count() })
        .from(schema.hazards)
        .groupBy(schema.hazards.status);
      const total = await this.db
        .select({ c: count() })
        .from(schema.hazards);
      return {
        total: Number(total[0]?.c ?? 0),
        byStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.c) })),
      };
    }
    const managed = user.managedDepartments || [];
    if (!managed.length) return { total: 0, byStatus: [] };
    const byStatus = await this.db
      .select({ status: schema.hazards.status, c: count() })
      .from(schema.hazards)
      .where(inArray(schema.hazards.allocatedDepartment, managed))
      .groupBy(schema.hazards.status);
    const total = await this.db
      .select({ c: count() })
      .from(schema.hazards)
      .where(inArray(schema.hazards.allocatedDepartment, managed));
    return {
      total: Number(total[0]?.c ?? 0),
      byStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.c) })),
    };
  }

  async myHistory(userId: string) {
    return this.db
      .select()
      .from(schema.hazards)
      .where(eq(schema.hazards.submitterUserId, userId))
      .orderBy(desc(schema.hazards.createdAt))
      .limit(50);
  }

  // 看板统计
  async stats() {
    const byStatus = await this.db
      .select({ status: schema.hazards.status, c: count() })
      .from(schema.hazards)
      .groupBy(schema.hazards.status);
    const byRisk = await this.db
      .select({ riskLevel: schema.hazards.riskLevel, c: count() })
      .from(schema.hazards)
      .groupBy(schema.hazards.riskLevel);
    const total = await this.db.select({ c: count() }).from(schema.hazards);
    const open = await this.db
      .select({ c: count() })
      .from(schema.hazards)
      .where(sql`${schema.hazards.status} in ('pending_assign','assigned','rectified','dept_confirmed')`);
    return {
      total: Number(total[0]?.c ?? 0),
      open: Number(open[0]?.c ?? 0),
      byStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.c) })),
      byRisk: byRisk.map((r) => ({ riskLevel: r.riskLevel, count: Number(r.c) })),
    };
  }

  private async ensure(id: string) {
    const [h] = await this.db.select({ id: schema.hazards.id }).from(schema.hazards).where(eq(schema.hazards.id, id)).limit(1);
    if (!h) throw new NotFoundException('隐患不存在');
  }

  private async loadCtx(id: string) {
    const [h] = await this.db
      .select({
        id: schema.hazards.id,
        hazardNo: schema.hazards.hazardNo,
        location: schema.hazards.location,
        riskLevel: schema.hazards.riskLevel,
        submitterName: schema.hazards.submitterName,
        submitterUserId: schema.hazards.submitterUserId,
        assigneeName: schema.hazards.assigneeName,
        assigneeId: schema.hazards.assigneeId,
        status: schema.hazards.status,
        allocatedDepartment: schema.hazards.allocatedDepartment,
        assignedDeptId: schema.hazards.assignedDeptId,
      })
      .from(schema.hazards)
      .where(eq(schema.hazards.id, id))
      .limit(1);
    return h;
  }
}
