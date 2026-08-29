import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '@/database/schema';
import * as nodemailer from 'nodemailer';
import { appBaseUrl } from '@/common/base-url';

export interface EmailConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  baseUrl?: string; // 系统访问地址，用于邮件中生成链接
}

export interface EmailTemplate {
  event: string;
  name: string; // 展示名称
  subject: string;
  body: string; // 支持 {{var}} 占位符，HTML
  vars: string[]; // 可用变量说明
}

const DEFAULT_CONFIG: EmailConfig = { enabled: false, host: '', port: 465, secure: true, user: '', pass: '', from: '', baseUrl: '' };

function baseStyle(): string {
  return `
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background: #f5f7fa; margin: 0; padding: 0; color: #334155; }
      .wrap { max-width: 640px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
      .header { background: #16a34a; padding: 24px 32px; color: #fff; }
      .header h2 { margin: 0; font-size: 18px; font-weight: 600; }
      .header p { margin: 6px 0 0; font-size: 13px; opacity: 0.9; }
      .body { padding: 28px 32px; font-size: 14px; line-height: 1.7; }
      .body p { margin: 0 0 12px; }
      .meta { background: #f8fafc; border-radius: 6px; padding: 16px; margin: 16px 0; }
      .meta-row { display: flex; margin-bottom: 8px; }
      .meta-label { color: #64748b; width: 90px; flex-shrink: 0; }
      .meta-value { color: #0f172a; font-weight: 500; }
      .btn { display: inline-block; margin: 16px 0; padding: 10px 24px; background: #16a34a; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 500; }
      .footer { padding: 16px 32px; background: #f8fafc; font-size: 12px; color: #94a3b8; text-align: center; }
      .status { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
    </style>
  `;
}

export const DEFAULT_TEMPLATES: EmailTemplate[] = [
  {
    event: 'hazard_submitted',
    name: '隐患提交',
    subject: '【EHS】新隐患上报待处理：{{hazardNo}}',
    body: `<p>您好，</p>
<p>系统收到一条新的隐患上报，请及时派单处理。</p>
<div class="meta">
  <div class="meta-row"><div class="meta-label">隐患编号</div><div class="meta-value">{{hazardNo}}</div></div>
  <div class="meta-row"><div class="meta-label">上报人</div><div class="meta-value">{{submitter}}</div></div>
  <div class="meta-row"><div class="meta-label">位置</div><div class="meta-value">{{location}}</div></div>
  <div class="meta-row"><div class="meta-label">风险等级</div><div class="meta-value">{{riskLevel}}</div></div>
  <div class="meta-row"><div class="meta-label">隐患描述</div><div class="meta-value">{{description}}</div></div>
</div>
<a class="btn" href="{{actionUrl}}" target="_blank">登录系统处理</a>
<p>如链接无法点击，请复制：{{actionUrl}}</p>`,
    vars: ['hazardNo', 'submitter', 'location', 'riskLevel', 'description', 'actionUrl'],
  },
  {
    event: 'hazard_assigned',
    name: '任务分配',
    subject: '【EHS】隐患已派单：{{hazardNo}}',
    body: `<p>您好 {{assignee}}，</p>
<p>您被指派为隐患 <b>{{hazardNo}}</b> 的整改责任人，请在整改期限内完成整改并提交。</p>
<div class="meta">
  <div class="meta-row"><div class="meta-label">隐患编号</div><div class="meta-value">{{hazardNo}}</div></div>
  <div class="meta-row"><div class="meta-label">位置</div><div class="meta-value">{{location}}</div></div>
  <div class="meta-row"><div class="meta-label">风险等级</div><div class="meta-value">{{riskLevel}}</div></div>
  <div class="meta-row"><div class="meta-label">整改期限</div><div class="meta-value">{{deadline}}</div></div>
</div>
<a class="btn" href="{{actionUrl}}" target="_blank">查看详情并整改</a>`,
    vars: ['hazardNo', 'assignee', 'location', 'riskLevel', 'deadline', 'actionUrl'],
  },
  {
    event: 'hazard_rectified',
    name: '整改完成',
    subject: '【EHS】隐患已整改待验收：{{hazardNo}}',
    body: `<p>您好，</p>
<p>隐患 <b>{{hazardNo}}</b> 已由 <b>{{assignee}}</b> 提交整改，请您及时验收。</p>
<div class="meta">
  <div class="meta-row"><div class="meta-label">隐患编号</div><div class="meta-value">{{hazardNo}}</div></div>
  <div class="meta-row"><div class="meta-label">整改人</div><div class="meta-value">{{assignee}}</div></div>
  <div class="meta-row"><div class="meta-label">整改说明</div><div class="meta-value">{{rectificationDesc}}</div></div>
</div>
<a class="btn" href="{{actionUrl}}" target="_blank">前往验收</a>`,
    vars: ['hazardNo', 'assignee', 'rectificationDesc', 'actionUrl'],
  },
  {
    event: 'hazard_accepted',
    name: '验收通过',
    subject: '【EHS】隐患验收通过：{{hazardNo}}',
    body: `<p>您好，</p>
<p>隐患 <b>{{hazardNo}}</b> 已验收通过，整改闭环完成。</p>
<p>感谢您配合 EHS 管理工作，共同守护安全生产。</p>
<a class="btn" href="{{actionUrl}}" target="_blank">查看详情</a>`,
    vars: ['hazardNo', 'actionUrl'],
  },
  {
    event: 'hazard_rejected',
    name: '整改驳回',
    subject: '【EHS】隐患验收不通过：{{hazardNo}}',
    body: `<p>您好 {{assignee}}，</p>
<p>隐患 <b>{{hazardNo}}</b> 验收未通过，请按以下原因重新整改后提交。</p>
<div class="meta">
  <div class="meta-row"><div class="meta-label">隐患编号</div><div class="meta-value">{{hazardNo}}</div></div>
  <div class="meta-row"><div class="meta-label">驳回原因</div><div class="meta-value">{{reason}}</div></div>
</div>
<a class="btn" href="{{actionUrl}}" target="_blank">重新整改</a>`,
    vars: ['hazardNo', 'assignee', 'reason', 'actionUrl'],
  },
  {
    event: 'work_permit_submitted',
    name: '作业票提交',
    subject: '【EHS】新作业票待审核：{{permitNo}}',
    body: `<p>您好，</p>
<p>收到新的作业票申请，请您及时审核。</p>
<div class="meta">
  <div class="meta-row"><div class="meta-label">作业票号</div><div class="meta-value">{{permitNo}}</div></div>
  <div class="meta-row"><div class="meta-label">作业类型</div><div class="meta-value">{{type}}</div></div>
  <div class="meta-row"><div class="meta-label">申请人</div><div class="meta-value">{{applicant}}</div></div>
  <div class="meta-row"><div class="meta-label">区域/位置</div><div class="meta-value">{{location}}</div></div>
</div>
<a class="btn" href="{{actionUrl}}" target="_blank">登录系统审核</a>`,
    vars: ['permitNo', 'type', 'applicant', 'location', 'actionUrl'],
  },
  {
    event: 'work_permit_approved',
    name: '作业票批准',
    subject: '【EHS】作业票已批准：{{permitNo}}',
    body: `<p>您好 {{applicant}}，</p>
<p>您的作业票 <b>{{permitNo}}</b>（{{type}}）已批准，可以按计划作业。</p>
<p>请注意现场安全措施落实，危险作业请携带相关证件。</p>
<a class="btn" href="{{actionUrl}}" target="_blank">查看作业票</a>`,
    vars: ['permitNo', 'type', 'applicant', 'actionUrl'],
  },
  {
    event: 'work_permit_step_approval',
    name: '作业票步骤审批',
    subject: '【EHS】待您审批：{{permitNo}}（{{stepLabel}}）',
    body: `<p>您好，</p>
<p>有一张作业票进入您负责的审批环节，请及时处理。</p>
<div class="meta">
  <div class="meta-row"><div class="meta-label">作业票号</div><div class="meta-value">{{permitNo}}</div></div>
  <div class="meta-row"><div class="meta-label">作业类型</div><div class="meta-value">{{type}}</div></div>
  <div class="meta-row"><div class="meta-label">申请人</div><div class="meta-value">{{applicant}}</div></div>
  <div class="meta-row"><div class="meta-label">区域/位置</div><div class="meta-value">{{location}}</div></div>
  <div class="meta-row"><div class="meta-label">当前环节</div><div class="meta-value">{{stepLabel}}</div></div>
</div>
<p>点击以下按钮即可在浏览器中完成审批（链接自发出起 48 小时内有效，单次有效）：</p>
<p>
  <a class="btn" href="{{approveUrl}}" target="_blank" style="background:#16a34a;">同意</a>
  &nbsp;
  <a class="btn" href="{{rejectUrl}}" target="_blank" style="background:#dc2626;">拒绝</a>
</p>
<p style="color:#94a3b8;font-size:12px;">如按钮无法点击，请复制以下链接到浏览器：<br/>同意：{{approveUrl}}<br/>拒绝：{{rejectUrl}}</p>
<p><a href="{{actionUrl}}" target="_blank">或登录系统查看详情</a></p>`,
    vars: ['permitNo', 'type', 'applicant', 'location', 'stepLabel', 'approveUrl', 'rejectUrl', 'actionUrl'],
  },
  {
    event: 'work_permit_rejected',
    name: '作业票审批驳回',
    subject: '【EHS】作业审批未通过：{{permitNo}}',
    body: `<p>您好 {{applicant}}，</p>
<p>您的作业票 <b>{{permitNo}}</b>（{{type}}）在「{{stepLabel}}」环节未通过审批。</p>
<div class="meta">
  <div class="meta-row"><div class="meta-label">作业票号</div><div class="meta-value">{{permitNo}}</div></div>
  <div class="meta-row"><div class="meta-label">作业类型</div><div class="meta-value">{{type}}</div></div>
  <div class="meta-row"><div class="meta-label">未过环节</div><div class="meta-value">{{stepLabel}}</div></div>
  <div class="meta-row"><div class="meta-label">驳回意见</div><div class="meta-value">{{reason}}</div></div>
</div>
<a class="btn" href="{{actionUrl}}" target="_blank">登录系统查看并修改</a>`,
    vars: ['permitNo', 'type', 'applicant', 'stepLabel', 'reason', 'actionUrl'],
  },
];

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  async getConfig(): Promise<EmailConfig> {
    const [row] = await this.db.select().from(schema.systemConfig).where(eq(schema.systemConfig.key, 'email_config')).limit(1);
    if (!row || !row.value) return DEFAULT_CONFIG;
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(row.value) };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  async saveConfig(cfg: Partial<EmailConfig>) {
    const cur = await this.getConfig();
    const next = { ...cur, ...cfg };
    await this.db
      .insert(schema.systemConfig)
      .values({ key: 'email_config', value: JSON.stringify(next) })
      .onConflictDoUpdate({ target: schema.systemConfig.key, set: { value: JSON.stringify(next), updatedAt: new Date() } });
    return { success: true };
  }

  async getTemplates(): Promise<EmailTemplate[]> {
    const [row] = await this.db.select().from(schema.systemConfig).where(eq(schema.systemConfig.key, 'email_templates')).limit(1);
    if (!row || !row.value) return DEFAULT_TEMPLATES;
    try {
      const parsed = JSON.parse(row.value);
      // 兼容旧版：如果缺失 name/vars，自动补全
      return parsed.map((t: any) => {
        const def = DEFAULT_TEMPLATES.find((d) => d.event === t.event);
        return { name: def?.name || t.event, vars: def?.vars || [], ...def, ...t };
      });
    } catch {
      return DEFAULT_TEMPLATES;
    }
  }

  async saveTemplates(tpls: EmailTemplate[]) {
    await this.db
      .insert(schema.systemConfig)
      .values({ key: 'email_templates', value: JSON.stringify(tpls) })
      .onConflictDoUpdate({ target: schema.systemConfig.key, set: { value: JSON.stringify(tpls), updatedAt: new Date() } });
    return { success: true };
  }

  // 取得拥有某权限的用户的邮箱（去重）
  async emailsByPerm(perm: string): Promise<string[]> {
    const [sub, act] = perm.split(':');
    const rows = await this.db
      .selectDistinct({ email: schema.users.email })
      .from(schema.users)
      .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
      .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.roles.id))
      .innerJoin(schema.permissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
      .where(and(eq(schema.permissions.subject, sub), eq(schema.permissions.action, act), eq(schema.users.status, 'active')));
    return rows.map((r) => r.email).filter((e): e is string => !!e);
  }

  async test(to: string) {
    // 测试发送不受“是否启用”开关限制，便于先验证 SMTP 配置
    return this.send(to, '【EHS】邮件通知测试', '<p>这是一封来自 EHS 管理系统的测试邮件，说明 SMTP 配置正确。</p>', { force: true });
  }

  async send(to: string, subject: string, html: string, opts?: { force?: boolean }) {
    const cfg = await this.getConfig();
    if (!opts?.force && !cfg.enabled) {
      this.logger.warn('邮件未启用，跳过发送');
      return { skipped: true, reason: 'disabled' };
    }
    if (!cfg.host || !cfg.user) {
      this.logger.warn('SMTP 未配置完整，跳过发送');
      return { skipped: true, reason: 'no_config' };
    }
    try {
      const transport = nodemailer.createTransport({
        host: cfg.host,
        port: Number(cfg.port),
        secure: cfg.secure,
        auth: { user: cfg.user, pass: cfg.pass },
      });
      await transport.sendMail({ from: cfg.from || cfg.user, to, subject, html });
      this.logger.log(`邮件已发送至 ${to}`);
      return { success: true };
    } catch (e: any) {
      this.logger.error(`邮件发送失败：${e?.message}`);
      return { success: false, error: e?.message };
    }
  }

  // 事件通知：根据模板 + 收件人权限/指定邮箱发送
  // ctx.cc：额外抄送邮箱列表（如常规作业票批准后抄送 EHS 存档），与 to/perms 去重后合并发送
  async notify(event: string, ctx: Record<string, any> & { to?: string; cc?: string[]; perms?: string[] }) {
    const cfg = await this.getConfig();
    // 未启用时直接跳过，避免无意义的模板/收件人查询（也规避 PGlite 单连接下的后台并发查询）
    if (!cfg.enabled) return { skipped: true, reason: 'disabled' };
    const tpls = await this.getTemplates();
    const tpl = tpls.find((t) => t.event === event);
    if (!tpl) return { skipped: true, reason: 'no_template' };
    const baseUrl = cfg.baseUrl || appBaseUrl();
    const recipients = new Set<string>();
    if (ctx.to) recipients.add(ctx.to);
    if (Array.isArray(ctx.cc)) ctx.cc.filter(Boolean).forEach((e) => recipients.add(e));
    if (ctx.perms) {
      for (const p of ctx.perms) (await this.emailsByPerm(p)).forEach((e) => recipients.add(e));
    }
    if (recipients.size === 0) return { skipped: true, reason: 'no_recipient' };
    const subject = fill(tpl.subject, { ...ctx, baseUrl });
    const body = fill(tpl.body, { ...ctx, baseUrl, actionUrl: ctx.actionUrl || `${baseUrl}/hazards` });
    const html = `<!DOCTYPE html><html><head>${baseStyle()}</head><body>
      <div class="wrap">
        <div class="header"><h2>EHS 安全管理系统</h2><p>邮件通知</p></div>
        <div class="body">${body}</div>
        <div class="footer">本邮件由 EHS 安全管理系统自动发送，请勿直接回复。</div>
      </div>
    </body></html>`;
    const results = [];
    for (const to of recipients) results.push(await this.send(to, subject, html));
    return { sent: [...recipients], results };
  }
}

function fill(tpl: string, ctx: Record<string, any>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (ctx[k] !== undefined && ctx[k] !== null ? String(ctx[k]) : ''));
}
