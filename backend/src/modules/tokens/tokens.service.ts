import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as crypto from 'crypto';
import * as schema from '@/database/schema';

export type ActionTokenPurpose = 'email_approval' | 'mobile_sign' | 'contractor_fill' | 'worker_fill';

// 各类令牌过期提示（免登录页直接展示给用户）
const EXPIRED_MSG: Record<ActionTokenPurpose, string> = {
  email_approval: '审批链接已过期（自发出起 48 小时内有效），请登录系统处理',
  mobile_sign: '签字链接已过期，请重新生成二维码',
  contractor_fill: '填写链接已过期（自发出起 72 小时内有效），请联系邀请方重新发送邀请',
  worker_fill: '填写链接已过期（自发出起 72 小时内有效），请联系邀请方重新发送邀请',
};

export interface CreateTokenOpts {
  purpose: ActionTokenPurpose;
  targetType: 'work_permit' | 'application' | 'briefing' | 'training';
  targetId: string;
  step?: string; // review / approve_ehs / approve_mgr / approve
  role?: string; // worker / contractor / supervisor / fire_watcher / trainee ...
  signerName?: string;
  multi?: boolean; // true=多人共用（培训/交底集体扫码签字）
  meta?: Record<string, any>;
  ttlHours?: number; // 默认 48 小时
}

/**
 * 一次性动作令牌：
 * - email_approval：邮件内“同意/拒绝”按钮，48 小时过期，单次有效；
 * - mobile_sign：二维码手机签字链接，支持单人（用后作废）与多人共用（过期前可反复签字）。
 */
@Injectable()
export class TokensService {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  private gen(): string {
    return crypto.randomBytes(24).toString('hex'); // 48 位十六进制
  }

  async create(opts: CreateTokenOpts): Promise<{ token: string; expiresAt: Date }> {
    const token = this.gen();
    const ttl = opts.ttlHours ?? 48;
    const expiresAt = new Date(Date.now() + ttl * 3600 * 1000);
    await this.db.insert(schema.actionTokens).values({
      token,
      purpose: opts.purpose,
      targetType: opts.targetType,
      targetId: opts.targetId,
      step: opts.step ?? null,
      role: opts.role ?? null,
      signerName: opts.signerName ?? null,
      multi: !!opts.multi,
      meta: opts.meta ?? {},
      expiresAt,
    });
    return { token, expiresAt };
  }

  async getValid(token: string, purpose: ActionTokenPurpose) {
    const [t] = await this.db.select().from(schema.actionTokens).where(eq(schema.actionTokens.token, token)).limit(1);
    if (!t || t.purpose !== purpose) throw new NotFoundException('链接无效或已被撤销');
    if (t.usedAt && !t.multi) throw new BadRequestException('该链接已被使用，如需再次操作请联系人重新发送');
    if (new Date(t.expiresAt as any) < new Date()) {
      throw new BadRequestException(EXPIRED_MSG[purpose] || '链接已过期，请联系人重新发送');
    }
    return t;
  }

  async markUsed(id: string, usedBy?: string) {
    await this.db
      .update(schema.actionTokens)
      .set({ usedAt: new Date(), usedBy: usedBy ?? null, updatedAt: new Date() })
      .where(eq(schema.actionTokens.id, id));
  }
}
