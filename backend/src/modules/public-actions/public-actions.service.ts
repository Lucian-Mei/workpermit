import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, desc, sql, isNull } from 'drizzle-orm';
import * as schema from '@/database/schema';
import { getWorkPermitType } from '@/common/constants/domain';
import { TokensService } from '@/modules/tokens/tokens.service';
import { WorkPermitsService } from '@/modules/work-permits/work-permits.service';
import { appBaseUrl } from '@/common/base-url';

@Injectable()
export class PublicActionsService {
  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    private tokens: TokensService,
    private workPermits: WorkPermitsService,
  ) {}

  // 审批页信息（GET 展示用）
  async getApprovalInfo(token: string) {
    const t = await this.tokens.getValid(token, 'email_approval');
    const summary = await this.loadSummary(t.targetType, t.targetId);
    return { token: t.token, step: t.step, meta: t.meta, ...summary };
  }

  // 执行邮件内审批动作（同意/拒绝）——仅由 POST 触发（S09），记录操作来源
  async executeApproval(token: string, action: 'approve' | 'reject', ctx?: { ip?: string; ua?: string }) {
    const t = await this.tokens.getValid(token, 'email_approval');
    // 审计留痕：记录 UA/IP 到令牌 meta
    if (ctx?.ip || ctx?.ua) {
      const meta = { ...((t.meta as any) || {}), ip: ctx.ip || '', ua: ctx.ua || '', actedAt: new Date().toISOString() };
      await this.db.update(schema.actionTokens).set({ meta, updatedAt: new Date() }).where(eq(schema.actionTokens.id, t.id));
    }
    const approve = action === 'approve';
    const user: any = { userId: null, name: '邮件审批' };
    const opinion = approve ? '邮件审批通过' : '邮件审批拒绝';
    let status: string;
    if (t.targetType !== 'work_permit') throw new BadRequestException('无效的审批目标');
    if (t.step === 'review') status = (await this.workPermits.review(t.targetId, { approve, opinion }, user)).status;
    else if (t.step === 'approve_ehs') status = (await this.workPermits.approveEhs(t.targetId, { approve, opinion }, user)).status;
    else status = (await this.workPermits.approve(t.targetId, { approve, opinion }, user)).status;
    await this.tokens.markUsed(t.id, `邮件审批${ctx?.ip ? ` (${ctx.ip})` : ''}`);
    return { success: true, status, approved: approve };
  }

  // 签字页信息（GET 展示用）
  async getSignInfo(token: string) {
    const t = await this.tokens.getValid(token, 'mobile_sign');
    const meta = (t.meta as any) || {};
    const info: any = { token: t.token, role: t.role, signerName: t.signerName, meta, targetType: t.targetType, targetId: t.targetId };
    if (t.targetType === 'training') {
      info.title = '安全培训签字';
      info.generic = true; // 通用签字页：不提示/不要求填写受训人姓名
    }
    return info;
  }

  // 提交手机签字（base64 签名图）
  async submitSign(token: string, dto: { name?: string; role?: string; signImg?: string }) {
    if (!dto.signImg) throw new BadRequestException('请先手写签名');
    const t = await this.tokens.getValid(token, 'mobile_sign');
    // 培训通用签字：不填姓名，签完一人确认后下一人继续（多人共用令牌）。
    // targetType=training 时按 trainingId 直接写入培训记录（方案 B 单表，培训记录直接挂在 work_permits 上）。
    // 多人并发签字：用 jsonb 拼接做原子追加，避免 read-modify-write 丢更新。
    if (t.targetType === 'training') {
      const [training] = await this.db
        .select({ id: schema.workPermitTrainings.id })
        .from(schema.workPermitTrainings)
        .where(eq(schema.workPermitTrainings.id, t.targetId))
        .limit(1);
      if (!training) throw new BadRequestException('培训记录不存在或链接已失效');
      const item = { name: '', signImg: dto.signImg, signedAt: new Date().toISOString() };
      await this.db
        .update(schema.workPermitTrainings)
        .set({
          traineeSignatures: sql`COALESCE(${schema.workPermitTrainings.traineeSignatures}, '[]'::jsonb) || ${JSON.stringify([item])}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(schema.workPermitTrainings.id, t.targetId));
      await this.tokens.markUsed(t.id, '培训签字');
      return { success: true };
    }
    if (t.targetType !== 'work_permit') throw new BadRequestException('该签字令牌不适用于作业票签字');
    await this.workPermits.addSignature(t.targetId, {
      name: dto.name || t.signerName || '',
      role: dto.role || t.role || 'worker',
      signImg: dto.signImg,
    });
    await this.tokens.markUsed(t.id, dto.name || t.signerName || '手机签字');
    return { success: true };
  }

  // 读取目标作业票/申请单摘要用于页面展示
  private async loadSummary(targetType: string, targetId: string) {
    if (targetType === 'work_permit') {
      const [wp] = await this.db
        .select({ permitNo: schema.workPermits.permitNo, status: schema.workPermits.status, applicantName: schema.workPermits.applicantName, type: schema.workPermits.type })
        .from(schema.workPermits)
        .where(eq(schema.workPermits.id, targetId))
        .limit(1);
      const label = wp ? getWorkPermitType(wp.type).label : '';
      return { permitNo: wp?.permitNo, status: wp?.status, applicantName: wp?.applicantName, typeLabel: label };
    }
    throw new BadRequestException('无效的审批目标');
  }

  // 入厂核验：按 token 获取作业单信息
  async getEntryInfo(token: string) {
    const [wp] = await this.db
      .select({
        permitNo: schema.workPermits.permitNo,
        contractorUnit: schema.workPermits.contractorUnit,
        location: schema.workPermits.location,
        planStart: schema.workPermits.startTime,
      })
      .from(schema.workPermits)
      .where(eq(schema.workPermits.entryQrToken, token))
      .limit(1);
    if (!wp) throw new BadRequestException('核验链接无效或已失效');
    return wp;
  }

  // 入厂登记：获取可登记的作业任务列表（按看板QR进入）
  async getActiveApplications(token?: string) {
    const base = and(
      eq(schema.workPermits.status, 'printed'),
      eq(schema.workPermits.channel, 'electronic'),
    );
    // 培训二维码 token 绑定：扫哪张票的码，就只显示哪张票的任务（无 token 时显示全部，供看板/门卫使用）
    if (token) {
      const [wp] = await this.db
        .select({ id: schema.workPermits.id })
        .from(schema.workPermits)
        .where(eq(schema.workPermits.trainingQrToken, token))
        .limit(1);
      if (!wp?.id) return [];
      return this.db
        .select({
          id: schema.workPermits.id,
          permitNo: schema.workPermits.permitNo,
          jobName: schema.workPermits.jobName,
          contractorUnit: schema.workPermits.contractorUnit,
          location: schema.workPermits.location,
        })
        .from(schema.workPermits)
        .where(and(base, eq(schema.workPermits.id, wp.id)))
        .limit(1);
    }
    const rows = await this.db
      .select({
        id: schema.workPermits.id,
        permitNo: schema.workPermits.permitNo,
        jobName: schema.workPermits.jobName,
        contractorUnit: schema.workPermits.contractorUnit,
        location: schema.workPermits.location,
      })
      .from(schema.workPermits)
      .where(base)
      .orderBy(desc(schema.workPermits.updatedAt))
      .limit(20);
    return rows;
  }

  // 入厂登记：工人填写信息 + 培训核验（S12：培训合格身份优先按身份证号匹配）
  async workerRegister(dto: { workPermitId: string; contractorUnit: string; workerName: string; workerPhone?: string; workerIdCard?: string; signImg?: string }) {
    if (!dto.workPermitId) throw new BadRequestException('缺少作业任务');
    if (!dto.workerName?.trim()) throw new BadRequestException('请填写姓���');
    const workerName = dto.workerName.trim();
    const idCard = (dto.workerIdCard || '').trim().toUpperCase() || null;

    // 检查培训状态（优先级：身份证号 → 手机号+姓名 → 姓名兜底）
    let trainingPassed = false;
    let trainingRecordId: string | null = null;
    let recs: any[] = [];
    if (idCard) {
      recs = await this.db
        .select()
        .from(schema.trainingRecords)
        .where(and(eq(schema.trainingRecords.idCard, idCard), eq(schema.trainingRecords.passed, true)))
        .orderBy(desc(schema.trainingRecords.createdAt))
        .limit(1);
      if (recs.length > 0 && recs[0].validUntil && recs[0].validUntil > new Date()) {
        if (recs[0].name !== workerName) {
          throw new BadRequestException(`该身份证号关联的姓名为「${recs[0].name}」，请核实姓名或身份证号`);
        }
        trainingPassed = true;
        trainingRecordId = recs[0].id;
      }
    }
    if (!trainingPassed && !idCard && dto.workerPhone) {
      const phoneRecs = await this.db
        .select()
        .from(schema.trainingRecords)
        .where(and(eq(schema.trainingRecords.phone, dto.workerPhone), eq(schema.trainingRecords.name, workerName), eq(schema.trainingRecords.passed, true)))
        .orderBy(desc(schema.trainingRecords.createdAt))
        .limit(1);
      if (phoneRecs.length > 0 && phoneRecs[0].validUntil && phoneRecs[0].validUntil > new Date()) {
        trainingPassed = true;
        trainingRecordId = phoneRecs[0].id;
      }
    }
    if (!trainingPassed && !idCard) {
      const nameRecs = await this.db
        .select()
        .from(schema.trainingRecords)
        .where(and(eq(schema.trainingRecords.name, workerName), eq(schema.trainingRecords.passed, true)))
        .orderBy(desc(schema.trainingRecords.createdAt))
        .limit(1);
      if (nameRecs.length > 0 && nameRecs[0].validUntil && nameRecs[0].validUntil > new Date()) {
        trainingPassed = true;
        trainingRecordId = nameRecs[0].id;
      }
    }
    // 写入登记记录
    const ins = await this.db.insert(schema.entryRegistrations).values({
      workPermitId: dto.workPermitId,
      contractorUnit: dto.contractorUnit,
      workerName,
      workerPhone: dto.workerPhone || null,
      workerIdCard: idCard || null,
      trainingPassed,
      trainingRecordId: trainingRecordId || null,
      signImg: dto.signImg || null,
      registeredAt: new Date(),
    }).returning({ id: schema.entryRegistrations.id });
    return { id: ins[0].id, workerName, trainingPassed, needExam: !trainingPassed };
  }

  // 入厂核验：提交姓名电话，记录核验
  async submitEntry(token: string, name: string, phone?: string) {
    const [wp] = await this.db
      .select({ id: schema.workPermits.id, permitNo: schema.workPermits.permitNo })
      .from(schema.workPermits)
      .where(eq(schema.workPermits.entryQrToken, token))
      .limit(1);
    if (!wp) throw new BadRequestException('核验链接无效或已失效');
    return { success: true, name, phone, permitNo: wp.permitNo };
  }

  // ===== 作业代码入场签到 =====
  /**
   * 门卫闸口扫码入场/离场。
   * 绿色放行：作业票有效 + 培训在有效期内；红色转考：培训缺失或过期，返回 needTraining + 培训链接。
   * 注意：培训校验以身份证号为唯一键（同名工人不会互相顶替）。
   */
  async entryByCode(
    workCode: string,
    name: string,
    idCard: string,
    action: 'in' | 'out',
    gate?: string,
    phone?: string,
    confirmed?: boolean,
  ) {
    const code = String(workCode || '').trim();
    const workerName = String(name || '').trim();
    const id = String(idCard || '').trim().toUpperCase();
    const phoneNum = String(phone || '').trim();

    const [wp] = await this.db
      .select()
      .from(schema.workPermits)
      .where(eq(schema.workPermits.workCode, code))
      .limit(1);
    if (!wp) throw new BadRequestException('作业代码不存在或已过期');

    const permitInfo = {
      permitNo: wp.permitNo,
      workCode: wp.workCode,
      jobName: wp.content || '',
      type: wp.type,
      isHazardous: !!wp.isHazardous,
      startTime: wp.startTime,
      endTime: wp.endTime,
    };

    if (!['printed', 'paused'].includes(wp.status))
      throw new BadRequestException('当前作业票状态不允许签到（需已下达且未结束）');

    // 作业时间窗校验：超期作业票不得放行
    const now = new Date();
    if (wp.endTime && new Date(wp.endTime) < now)
      throw new BadRequestException('作业票已超过计划结束时间，禁止入场，请办理延期');

    if (action === 'in') {
      // 1) 重复签到拦截：同一票同一身份证仍在厂内
      const [active] = await this.db
        .select({ id: schema.entryRegistrations.id, registeredAt: schema.entryRegistrations.registeredAt })
        .from(schema.entryRegistrations)
        .where(
          and(
            eq(schema.entryRegistrations.workPermitId, wp.id),
            eq(schema.entryRegistrations.workerIdCard, id),
            isNull(schema.entryRegistrations.signOutAt),
          ),
        )
        .limit(1);
      if (active) {
        return {
          ok: false,
          action: 'in',
          reason: `${workerName} 已在厂内（${new Date(active.registeredAt).toLocaleString('zh-CN')} 入场），请勿重复签到`,
          permit: permitInfo,
        };
      }

      // 2) 今日再次入场确认：同票同身份证今天已有签出记录 → 需前端二次确认，避免误操作
      if (!confirmed) {
        const [todayOut] = await this.db
          .select({ signOutAt: schema.entryRegistrations.signOutAt })
          .from(schema.entryRegistrations)
          .where(
            and(
              eq(schema.entryRegistrations.workPermitId, wp.id),
              eq(schema.entryRegistrations.workerIdCard, id),
              sql`${schema.entryRegistrations.signOutAt}::date = current_date`,
            ),
          )
          .orderBy(desc(schema.entryRegistrations.signOutAt))
          .limit(1);
        if (todayOut?.signOutAt) {
          return {
            ok: false,
            action: 'in',
            needConfirm: true,
            lastSignOutAt: new Date(todayOut.signOutAt).toISOString(),
            reason: `${workerName} 今日已于 ${new Date(todayOut.signOutAt).toLocaleString('zh-CN')} 签出，请确认是否需要再次入场`,
            permit: permitInfo,
          };
        }
      }

      // 3) 培训校验（身份证唯一键，有效期内的 exam_passed）
      const [rec] = await this.db
        .select({ step: schema.trainingAttempts.step, attemptedAt: schema.trainingAttempts.attemptedAt })
        .from(schema.trainingAttempts)
        .where(
          and(
            eq(schema.trainingAttempts.workerIdCard, id),
            eq(schema.trainingAttempts.step, 'exam_passed'),
            sql`${schema.trainingAttempts.attemptedAt} > now() - interval '90 days'`,
          ),
        )
        .orderBy(desc(schema.trainingAttempts.attemptedAt))
        .limit(1);
      if (!rec) {
        const base = appBaseUrl();
        return {
          ok: false,
          action: 'in',
          needTraining: true,
          reason: '培训未通过或已超过 90 天有效期，禁止入场，请先完成一级安全培训考试',
          trainingUrl: wp.trainingQrToken ? `${base}/training/exam?token=${wp.trainingQrToken}` : `${base}/training`,
          permit: permitInfo,
        };
      }

      // 3) 放行并登记
      await this.db.insert(schema.entryRegistrations).values({
        workPermitId: wp.id,
        contractorUnit: wp.department || '',
        workerName,
        workerIdCard: id,
        workerPhone: phoneNum || null,
        trainingPassed: true,
        gate: gate || null,
        registeredAt: now,
      } as any);

      const validUntil = new Date(new Date(rec.attemptedAt).getTime() + 90 * 24 * 3600 * 1000);
      return {
        ok: true,
        action: 'in',
        message: `${workerName} 入场签到成功，准予作业`,
        worker: { name: workerName, idCard: this.maskId(id) },
        permit: permitInfo,
        trainingValidUntil: validUntil.toISOString(),
      };
    }

    // ===== 离场签出：必须命中"在厂中"的记录，否则明确报错 =====
    const [openRec] = await this.db
      .select({ id: schema.entryRegistrations.id })
      .from(schema.entryRegistrations)
      .where(
        and(
          eq(schema.entryRegistrations.workPermitId, wp.id),
          eq(schema.entryRegistrations.workerIdCard, id),
          isNull(schema.entryRegistrations.signOutAt),
        ),
      )
      .orderBy(desc(schema.entryRegistrations.registeredAt))
      .limit(1);
    if (!openRec) {
      return {
        ok: false,
        action: 'out',
        reason: `未找到 ${workerName} 在该作业票下的在厂记录，无法签出`,
        permit: permitInfo,
      };
    }
    await this.db
      .update(schema.entryRegistrations)
      .set({ signOutAt: now })
      .where(eq(schema.entryRegistrations.id, openRec.id));
    return {
      ok: true,
      action: 'out',
      message: `${workerName} 离厂签出成功`,
      worker: { name: workerName, idCard: this.maskId(id) },
      permit: permitInfo,
    };
  }

  /**
   * 离厂签出（不依赖作业代码）：
   * 按「姓名 + 身份证/手机号」匹配在厂记录（sign_out_at IS NULL）。
   * - 提供身份证 → 姓名+身份证精确匹配；无命中再试姓名+手机号；仍无则按姓名兜底
   * - 多条同名在厂记录 → 要求补充身份证号确认身份
   * - 0 条 → 报错提示核对姓名
   * 签出成功返回带日期的签出凭证（供门卫核验放行，含姓名/掩码身份证/时间/作业票号）。
   */
  async entrySignout(name: string, idCard?: string, phone?: string) {
    const workerName = String(name || '').trim();
    const id = String(idCard || '').trim().toUpperCase();
    const phoneNum = String(phone || '').trim();

    const openBase = () => [
      eq(schema.entryRegistrations.workerName, workerName),
      isNull(schema.entryRegistrations.signOutAt),
    ];
    const orderByDesc = desc(schema.entryRegistrations.registeredAt);

    let recs: any[] = [];
    // 1) 提供了身份证 → 必须精确命中（身份证用于确认身份，不匹配即报错，不做姓名兜底）
    if (id) {
      recs = await this.db
        .select()
        .from(schema.entryRegistrations)
        .where(and(...openBase(), eq(schema.entryRegistrations.workerIdCard, id)))
        .orderBy(orderByDesc)
        .limit(5);
      if (recs.length === 0) {
        return {
          ok: false,
          action: 'out',
          reason: `未找到与身份证号匹配的 ${workerName} 在厂记录，请核对身份证号`,
        };
      }
    } else {
      // 2) 未给身份证：先按 姓名+手机号 匹配
      if (phoneNum) {
        recs = await this.db
          .select()
          .from(schema.entryRegistrations)
          .where(and(...openBase(), eq(schema.entryRegistrations.workerPhone, phoneNum)))
          .orderBy(orderByDesc)
          .limit(5);
      }
      // 3) 姓名兜底（重名时多条 → 提示补身份证）
      if (recs.length === 0) {
        recs = await this.db
          .select()
          .from(schema.entryRegistrations)
          .where(and(...openBase()))
          .orderBy(orderByDesc)
          .limit(10);
      }
    }

    if (recs.length === 0) {
      return {
        ok: false,
        action: 'out',
        reason: `未找到 ${workerName} 的在厂记录，请核对姓名是否正确，或补充身份证号`,
      };
    }
    // 多条同名在厂记录：需身份证确认
    if (recs.length > 1 && !id) {
      return {
        ok: false,
        action: 'out',
        needIdCard: true,
        count: recs.length,
        reason: `存在 ${recs.length} 条同名在厂记录，请补充身份证号以确认身份`,
      };
    }

    const rec = recs[0];
    const now = new Date();
    await this.db
      .update(schema.entryRegistrations)
      .set({ signOutAt: now })
      .where(eq(schema.entryRegistrations.id, rec.id));

    // 取作业票精简信息（凭证展示用）
    let permit: any = null;
    if (rec.workPermitId) {
      const [wp] = await this.db
        .select({
          permitNo: schema.workPermits.permitNo,
          workCode: schema.workPermits.workCode,
          content: schema.workPermits.content,
          department: schema.workPermits.department,
          location: schema.workPermits.location,
        })
        .from(schema.workPermits)
        .where(eq(schema.workPermits.id, rec.workPermitId))
        .limit(1);
      if (wp) permit = wp;
    }

    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    return {
      ok: true,
      action: 'out',
      message: `${workerName} 离厂签出成功`,
      signOutAt: now.toISOString(),
      signOutTime: fmt(now),
      worker: {
        name: rec.workerName,
        idCard: this.maskId(rec.workerIdCard),
        phone: rec.workerPhone || '',
      },
      permit,
    };
  }

  private maskId(idCard: string) {
    if (!idCard || idCard.length < 8) return '****';
    return `${idCard.slice(0, 4)}**********${idCard.slice(-2)}`;
  }

  // ===== 培训公开端点 =====
  async getTrainingInfo(token: string) {
    const [wp] = await this.db
      .select({
        id: schema.workPermits.id,
        content: schema.workPermits.content,
        type: schema.workPermits.type,
        workCode: schema.workPermits.workCode,
        trainingQrExpiresAt: schema.workPermits.trainingQrExpiresAt,
      })
      .from(schema.workPermits)
      .where(eq(schema.workPermits.trainingQrToken, token))
      .limit(1);
    if (!wp) throw new BadRequestException('培训二维码无效或已过期');
    if (wp.trainingQrExpiresAt && new Date(wp.trainingQrExpiresAt) < new Date())
      throw new BadRequestException('培训二维码已过期（有效期3天）');
    return {
      ok: true,
      workCode: wp.workCode,
      jobName: wp.content || '',
      type: wp.type,
      studySections: [
        { title: '1. 作业场所安全须知', text: '了解作业区域的危险源、安全通道、应急集合点。禁止进入非授权区域。' },
        { title: '2. 个人防护装备（PPE）', text: '进入生产区域必须佩戴安全帽、安全鞋；特定区域需耳塞、护目镜、防护手套。' },
        { title: '3. 作业风险与控制', text: '涉及风险包括：火灾、触电、物体打击、高处坠落。必须遵守作业票安全措施。' },
        { title: '4. 应急程序', text: '紧急情况：立即停止作业 → 撤离到最近集合点 → 点名确认 → 报告上级。火警119，急救120。' },
        { title: '5. 禁止行为', text: '禁止携带火种进入禁火区、禁止无证操作特种设备、禁止在作业区域吸烟、禁止擅自拆除安全设施。' },
      ],
      passScore: 80,
      questionCount: 5,
      needExamToken: true,
    };
  }

  async startTrainingExam(token: string, name: string, idCard: string) {
    this.cleanupExamStore();
    // 检查 today 尝试次数
    const today = new Date().toISOString().slice(0, 10);
    const [cnt] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.trainingAttempts)
      .where(
        and(
          eq(schema.trainingAttempts.workerIdCard, idCard),
          sql`${schema.trainingAttempts.attemptedAt}::date = ${today}::date`,
        ),
      );
    if ((cnt?.n || 0) >= 3) throw new BadRequestException('今日考试次数已达上限（3次）');

    // 生成试卷 token（存入内存）
    const examToken = crypto.randomUUID();
    const questions = this.generateExam();
    examStore.set(examToken, { name, idCard, questions, token, createdAt: Date.now() });

    await this.db.insert(schema.trainingAttempts).values({
      workPermitId: null as any,
      workerName: name,
      workerIdCard: idCard,
      step: 'exam_started',
      score: null,
      attemptedAt: new Date(),
    });
    // 暂时不关联 workPermitId（提交后补）
    return { ok: true, examToken, questions, totalQuestions: questions.length };
  }

  async submitTrainingExam(qrToken: string, examToken: string, name: string, idCard: string, answers: Record<string, string>) {
    this.cleanupExamStore();
    const entry = examStore.get(examToken);
    if (!entry || Date.now() - entry.createdAt > 1800_000)
      throw new BadRequestException('考试已超时（30分钟），请重新开始');

    let correct = 0;
    const results = entry.questions.map((q: any, i: number) => {
      const userAns = answers[String(i)] || '';
      const isRight = userAns === q.answer;
      if (isRight) correct++;
      return { question: q.question, yourAnswer: userAns, correctAnswer: q.answer, correct: isRight };
    });
    const score = Math.round((correct / entry.questions.length) * 100);
    const passed = score >= 80;

    // 找 work_permit_id
    const [wp] = await this.db
      .select({ id: schema.workPermits.id })
      .from(schema.workPermits)
      .where(eq(schema.workPermits.trainingQrToken, qrToken))
      .limit(1);

    await this.db.insert(schema.trainingAttempts).values({
      workPermitId: wp?.id || null,
      workerName: name,
      workerIdCard: idCard,
      step: passed ? 'exam_passed' : 'exam_failed',
      score,
      attemptedAt: new Date(),
    });

    examStore.delete(examToken);
    return { ok: true, score, passed, results, totalQuestions: entry.questions.length, correct };
  }

  // S11：惰性清理过期考试会话（30 分钟超时），防止内存无限增长
  private cleanupExamStore() {
    const now = Date.now();
    for (const [k, v] of examStore) {
      if (now - v.createdAt > 30 * 60 * 1000) examStore.delete(k);
    }
  }

  private generateExam(): Array<{ question: string; options: string[]; answer: string }> {    const bank = [
      { question: '安全帽的正确佩戴方式是？', options: ['A. 帽沿朝后', 'B. 帽沿朝前，系紧下颚带', 'C. 不需要系带', 'D. 扣在头上即可'], answer: 'B' },
      { question: '进入作业区域前最重要的是？', options: ['A. 直接开始作业', 'B. 了解安全出口和应急集合点', 'C. 找个凉快的地方', 'D. 记下编号'], answer: 'B' },
      { question: '发现安全隐患时应首先？', options: ['A. 忽略', 'B. 自己处理', 'C. 立即报告并停止作业', 'D. 继续作业'], answer: 'C' },
      { question: '动火现场必须配备？', options: ['A. 零食', 'B. 有效灭火器', 'C. 充电器', 'D. 手机'], answer: 'B' },
      { question: '高处作业必须？', options: ['A. 不系安全绳', 'B. 穿拖鞋', 'C. 系好安全绳固定牢固', 'D. 站在不稳固物上'], answer: 'C' },
      { question: '受限空间最重要措施？', options: ['A. 快速作业', 'B. 气体检测和通风', 'C. 多带人', 'D. 听音乐'], answer: 'B' },
      { question: '发生火灾时应？', options: ['A. 拍照', 'B. 立即撤离并报警', 'C. 抢救财物', 'D. 继续作业'], answer: 'B' },
      { question: '厂区必须佩戴的PPE？', options: ['A. 安全帽和安全鞋', 'B. 运动鞋', 'C. 凉鞋', 'D. 不需要'], answer: 'A' },
      { question: '临时用电装置内架空高度？', options: ['A. 1m', 'B. 1.5m', 'C. 2.5m', 'D. 5m'], answer: 'C' },
      { question: '起重吊装风力几级停止？', options: ['A. 4级', 'B. 5级', 'C. 6级', 'D. 8级'], answer: 'C' },
    ];
    return bank.sort(() => Math.random() - 0.5).slice(0, 5);
  }
}

// 内存暂存试卷（避免额外建表）
const examStore = new Map<string, { name: string; idCard: string; questions: any[]; token: string; createdAt: number }>();
