import { Controller, Get, Put, Body, UseGuards, Post, BadRequestException, Inject } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { PermissionGuard } from '@/common/guards/permission.guard';
import { RequirePerms } from '@/common/decorators/permissions.decorator';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@/database/schema';

export interface AiConfigDto {
  provider?: string;
  apiKey?: string;
  apiModel?: string;
  apiBase?: string;
}

const PROVIDERS = ['deepseek', 'doubao', 'kimi', 'hunyuan', 'tongyi', 'siliconflow', 'openai', 'offline'];

const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  deepseek: 'deepseek-chat',
  doubao: 'doubao-seed-1.6-250615',
  kimi: 'moonshot-v1-8k',
  hunyuan: 'hunyuan-turbos-latest',
  tongyi: 'qwen-plus',
  siliconflow: 'deepseek-ai/DeepSeek-V3',
  openai: 'gpt-4o-mini',
  offline: 'offline',
};

@Controller('ai')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePerms('config:manage')
export class AiController {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  @Get('config')
  async getConfig() {
    const [row] = await this.db
      .select()
      .from(schema.systemConfig)
      .where(eq(schema.systemConfig.key, 'ai_config'))
      .limit(1);
    let cfg: any = {};
    try {
      cfg = row?.value ? JSON.parse(row.value) : {};
    } catch {
      cfg = {};
    }
    // 不向前端回显完整密钥，仅告知是否已配置
    return { ...cfg, apiKey: cfg.apiKey ? '******' : '', hasKey: !!cfg.apiKey };
  }

  @Put('config')
  async saveConfig(@Body() dto: AiConfigDto) {
    if (dto.provider && !PROVIDERS.includes(dto.provider.toLowerCase()))
      throw new BadRequestException('不支持的 AI 厂商');
    const [row] = await this.db
      .select()
      .from(schema.systemConfig)
      .where(eq(schema.systemConfig.key, 'ai_config'))
      .limit(1);
    let cur: any = {};
    try {
      cur = row?.value ? JSON.parse(row.value) : {};
    } catch {
      cur = {};
    }
    // 前端传 '******' 表示“不修改现有密钥”
    const next: any = { ...cur };
    if (dto.provider !== undefined) next.provider = dto.provider.toLowerCase();
    if (dto.apiModel !== undefined) next.apiModel = dto.apiModel;
    if (dto.apiBase !== undefined) next.apiBase = dto.apiBase;
    if (dto.apiKey !== undefined && dto.apiKey && dto.apiKey !== '******') next.apiKey = dto.apiKey;
    await this.db
      .insert(schema.systemConfig)
      .values({ key: 'ai_config', value: JSON.stringify(next) })
      .onConflictDoUpdate({ target: schema.systemConfig.key, set: { value: JSON.stringify(next), updatedAt: new Date() } });
    return { success: true, hasKey: !!next.apiKey };
  }

  // 验证当前配置能否连通（用一条极简请求）
  @Post('test')
  async test() {
    const [row] = await this.db
      .select()
      .from(schema.systemConfig)
      .where(eq(schema.systemConfig.key, 'ai_config'))
      .limit(1);
    let cfg: any = {};
    try {
      cfg = row?.value ? JSON.parse(row.value) : {};
    } catch {
      cfg = {};
    }
    if (!cfg.apiKey) {
      // 离线演示模式无需 Key，直接判定为可用
      if (cfg.provider === 'offline') return { ok: true, reply: '离线演示模式（无需联网/密钥）' };
      return { ok: false, error: '尚未配置 API Key' };
    }
    const { OpenAiProvider } = await import('./openai.provider');
    const baseMap: Record<string, string> = {
      deepseek: 'https://api.deepseek.com/v1',
      openai: 'https://api.openai.com/v1',
      tongyi: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      doubao: 'https://ark.cn-beijing.volcesecsp.com/api/v3',
      kimi: 'https://api.moonshot.cn/v1',
      hunyuan: 'https://api.hunyuan.cloud.tencent.com/v1',
      siliconflow: 'https://api.siliconflow.cn/v1',
    };
    const provider = cfg.provider || 'deepseek';
    const base = cfg.apiBase || baseMap[provider] || 'https://api.deepseek.com/v1';
    const model = cfg.apiModel || PROVIDER_DEFAULT_MODEL[provider] || 'deepseek-chat';
    const p = new OpenAiProvider(cfg.apiKey, base, model);
    const r = await p.chat('只回复两个字：正常', 'ping');
    return { ok: true, reply: r.slice(0, 50) };
  }
}
