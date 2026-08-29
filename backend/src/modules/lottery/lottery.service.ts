import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, desc } from 'drizzle-orm';
import * as schema from '@/database/schema';

export interface Prize {
  label: string;
  weight: number; // 权重，越大越容易中
}
export interface LotteryConfig {
  enabled: boolean;
  name: string;
  description?: string;
  prizes: Prize[];
}

const DEFAULT_CONFIG: LotteryConfig = {
  enabled: true, // 隐患上报抽奖默认开启
  name: '隐患上报抽奖',
  description: '提交隐患后参与抽奖，感谢您为安全贡献力量',
  prizes: [
    { label: '一等奖', weight: 1 },
    { label: '二等奖', weight: 3 },
    { label: '三等奖', weight: 6 },
    { label: '谢谢参与', weight: 90 },
  ],
};

@Injectable()
export class LotteryService {
  private readonly logger = new Logger(LotteryService.name);
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  async getConfig(): Promise<LotteryConfig> {
    const [row] = await this.db.select().from(schema.systemConfig).where(eq(schema.systemConfig.key, 'lottery_config')).limit(1);
    if (!row || !row.value) return DEFAULT_CONFIG;
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(row.value) };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  async saveConfig(cfg: Partial<LotteryConfig>) {
    const cur = await this.getConfig();
    const next = { ...cur, ...cfg };
    await this.db
      .insert(schema.systemConfig)
      .values({ key: 'lottery_config', value: JSON.stringify(next) })
      .onConflictDoUpdate({ target: schema.systemConfig.key, set: { value: JSON.stringify(next), updatedAt: new Date() } });
    return { success: true };
  }

  // 按权重抽奖，落库并返回中奖奖项
  async draw(user: any, payload?: { source?: string; refId?: string; refNo?: string }) {
    const cfg = await this.getConfig();
    if (!cfg.enabled) return { ok: false, reason: 'disabled' };
    const prizes = (cfg.prizes || []).filter((p) => p.weight > 0);
    if (prizes.length === 0) return { ok: false, reason: 'no_prize' };
    const total = prizes.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    let chosen = prizes[prizes.length - 1];
    for (const p of prizes) {
      if (r < p.weight) {
        chosen = p;
        break;
      }
      r -= p.weight;
    }
    // 落库（仅登录用户持久化，便于「我的中奖」查询）
    if (user?.userId) {
      try {
        await this.db.insert(schema.lotteryRecords).values({
          userId: user.userId,
          userName: user.name || '',
          prize: chosen.label,
          source: payload?.source || null,
          refId: payload?.refId || null,
          refNo: payload?.refNo || null,
        });
      } catch (e) {
        this.logger.warn(`抽奖落库失败：${(e as Error)?.message}`);
      }
    }
    this.logger.log(`用户 ${user?.name || '匿名'} 抽奖：${chosen.label}`);
    return { ok: true, prize: chosen.label };
  }

  // 当前用户的中奖记录（按时间倒序）
  async myRecords(userId: string) {
    if (!userId) return [];
    return this.db
      .select()
      .from(schema.lotteryRecords)
      .where(eq(schema.lotteryRecords.userId, userId))
      .orderBy(desc(schema.lotteryRecords.createdAt));
  }
}
