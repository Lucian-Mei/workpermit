import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@/database/schema';
import { AiProvider } from './ai-provider.interface';
import { OpenAiProvider } from './openai.provider';
import { OfflineProvider } from './offline.provider';
import { getWorkPermitType } from '@/common/constants/domain';

// 各厂商的 OpenAI 兼容 base（含版本路径），用户也可在界面自定义 apiBase
// 全部为 OpenAI 兼容协议，故用同一个 OpenAiProvider 即可，无需为每家写新类。
// 说明：这些厂商均提供“免费额度/免费试用”，注册后在对应控制台创建 Key 即可，
// 本系统只负责把请求发往正确地址，不存储/代管任何密钥。
const PROVIDER_BASES: Record<string, string> = {
  deepseek: 'https://api.deepseek.com/v1', // 深度求索：platform.deepseek.com 注册送免费额度
  openai: 'https://api.openai.com/v1',
  tongyi: 'https://dashscope.aliyuncs.com/compatible-mode/v1', // 通义千问：百炼平台免费额度
  doubao: 'https://ark.cn-beijing.volcesecsp.com/api/v3', // 豆包/火山方舟：注意是 volcesecsp（ec 不能少）
  kimi: 'https://api.moonshot.cn/v1', // 月之暗面 Kimi：platform.moonshot.cn 新用户免费额度
  hunyuan: 'https://api.hunyuan.cloud.tencent.com/v1', // 元宝/腾讯混元：cloud.tencent.com 混元免费额度
  siliconflow: 'https://api.siliconflow.cn/v1', // 硅基流动：一个 Key 免费调用 DeepSeek/Qwen/Kimi 等
};
const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  deepseek: 'deepseek-v4-flash',
  openai: 'gpt-4o-mini',
  tongyi: 'qwen-plus',
  doubao: 'doubao-seed-1.6-250615',
  kimi: 'moonshot-v1-8k',
  hunyuan: 'hunyuan-turbos-latest',
  siliconflow: 'deepseek-ai/DeepSeek-V3',
};

// AI 服务：隐患分析、作业票风险分析、提交后复核。
// 提示词从 system_config 读取；厂商/Key/模型从 system_config(ai_config) 读取，环境变量兜底，
// 因此可在后台“系统设置 → AI 配置”随时切换，无需改代码、无需重启。
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    private cfg: ConfigService,
  ) {}

  // 运行时解析当前生效的 AI 配置（界面设置优先，环境变量兜底）
  private async getProvider(): Promise<AiProvider> {
    let saved: any = {};
    try {
      const [row] = await this.db
        .select()
        .from(schema.systemConfig)
        .where(eq(schema.systemConfig.key, 'ai_config'))
        .limit(1);
      if (row?.value) saved = JSON.parse(row.value);
    } catch {
      /* ignore */
    }
    const provider = (saved.provider || this.cfg.get<string>('AI_PROVIDER') || 'deepseek').toLowerCase();
    const apiKey = saved.apiKey || this.cfg.get<string>('AI_API_KEY') || '';
    const model =
      saved.apiModel || this.cfg.get<string>('AI_MODEL') || PROVIDER_DEFAULT_MODEL[provider] || 'deepseek-chat';
    const base =
      saved.apiBase || PROVIDER_BASES[provider] || this.cfg.get<string>('AI_API_BASE') || 'https://api.deepseek.com/v1';
    // 离线演示模式：不依赖任何外部 Key，直接规则生成，方便无密钥时体验 AI 流程
    if (provider === 'offline' || provider === 'offline') return new OfflineProvider();
    return new OpenAiProvider(apiKey, base, model);
  }

  private async getPrompt(key: string, fallback: string): Promise<string> {
    const row = await this.db.select().from(schema.systemConfig).where(eq(schema.systemConfig.key, key)).limit(1);
    return row[0]?.value || fallback;
  }

  // ========== 隐患 AI 分析 ==========
  async analyzeHazard(input: {
    description: string;
    location?: string;
    hazardType?: string;
  }): Promise<Record<string, any>> {
    const sys = await this.getPrompt(
      'ai_prompt_hazard',
      '你是企业 EHS（环境、健康、安全）安全专家。请根据隐患描述，给出专业分析。',
    );
    const user = [
      `隐患描述：${input.description || '（空）'}`,
      `位置：${input.location || '（未知）'}`,
      `类型：${input.hazardType || '（未指定）'}`,
      '',
      '请严格按下面的 JSON 格式返回（不要加多余说明）：',
      '{',
      '  "aiDescription": "对隐患的归纳描述",',
      '  "aiCategory": "隐患类别",',
      '  "aiRiskLevel": "低风险 | 一般风险 | 较大风险 | 重大风险",',
      '  "aiRegulation": "关联的法规/标准条款（如 GB6441、安全生产法 等）",',
      '  "aiSuggestion": "整改建议",',
      '  "aiRootCause": "可能根本原因",',
      '  "ai5Why": "用 5Why 方法推演根因",',
      '  "aiControlMeasures": "控制措施建议"',
      '}',
    ].join('\n');

    const text = await (await this.getProvider()).chat(sys, user, { mode: 'hazard' });
    return this.parseJson(text);
  }

  // 交底风险智能识别：根据作业内容 + JSA 危害/控制措施，
  // 从给定风险词汇表（申请单三组）中挑选最相关项，返回建议打"推荐"标的风险文本列表。
  async analyzeBriefingHazards(input: { content?: string; jsas?: Array<{ step?: string; hazard?: string; control?: string }>; candidates: string[] }): Promise<string[]> {
    const sys = '你是企业 EHS 安全专家。根据作业内容和 JSA（工作安全分析）识别本次作业可能涉及的危害因素，从给定候选清单中选出最相关项。';
    const user = [
      `作业内容：${input.content || '（空）'}`,
      '',
      'JSA 分析：',
      (input.jsas || []).map((j, i) => `  ${i + 1}. 步骤[${j.step || ''}] 危害[${j.hazard || ''}] 措施[${j.control || ''}]`).join('\n') || '  （无）',
      '',
      '候选风险清单：',
      input.candidates.map((c) => `  - ${c}`).join('\n'),
      '',
      '请从候选清单中挑选 3~12 个与本次作业最相关的风险项，严格返回 JSON 字符串数组，例如：["天气因素（风雨雪雷电等）","机械伤害"]。只返回数组，不要其它文字。',
    ].join('\n');
    try {
      const text = await (await this.getProvider()).chat(sys, user, { mode: 'hazard' });
      const arr = this.parseJson(text);
      if (Array.isArray(arr)) {
        const valid = new Set(input.candidates);
        return arr.filter((x: any) => typeof x === 'string' && valid.has(x));
      }
    } catch {
      /* AI 失败返回空，前端静默 */
    }
    return [];
  }

  // 流式隐患分析：逐 token 产出，供前端实时渲染进度。
  // 若当前 provider 不支持流式，则退化为一次性返回全文。
  async *analyzeHazardStream(input: {
    description: string;
    location?: string;
    hazardType?: string;
  }): AsyncGenerator<string> {
    const sys = await this.getPrompt(
      'ai_prompt_hazard',
      '你是企业 EHS（环境、健康、安全）安全专家。请根据隐患描述，给出专业分析。',
    );
    const user = [
      `隐患描述：${input.description || '（空）'}`,
      `位置：${input.location || '（未知）'}`,
      `类型：${input.hazardType || '（未指定）'}`,
      '',
      '请严格按下面的 JSON 格式返回（不要加多余说明）：',
      '{',
      '  "aiDescription": "对隐患的归纳描述",',
      '  "aiCategory": "隐患类别",',
      '  "aiRiskLevel": "低风险 | 一般风险 | 较大风险 | 重大风险",',
      '  "aiRegulation": "关联的法规/标准条款（如 GB6441、安全生产法 等）",',
      '  "aiSuggestion": "整改建议",',
      '  "aiRootCause": "可能根本原因",',
      '  "ai5Why": "用 5Why 方法推演根因",',
      '  "aiControlMeasures": "控制措施建议"',
      '}',
    ].join('\n');
    const provider = await this.getProvider();
    const anyProvider = provider as any;
    if (typeof anyProvider.streamChat === 'function') {
      let full = '';
      for await (const chunk of anyProvider.streamChat(sys, user, { mode: 'hazard' })) {
        full += chunk;
        yield chunk;
      }
      // 末尾追加一个完成标记，便于前端识别（非 JSON 内容，解析时忽略）
      yield '\n__AI_DONE__';
      void full;
    } else {
      const text = await provider.chat(sys, user, { mode: 'hazard' });
      yield text;
      yield '\n__AI_DONE__';
    }
  }

  // ========== 作业票：申请时风险分析 ==========
  async analyzeWorkPermitRisk(input: {
    type: string;
    content: string;
    location?: string;
    startTime?: string;
    endTime?: string;
  }): Promise<{ riskAnalysis: string; suggestions: string[] }> {
    const t = getWorkPermitType(input.type);
    const sys = await this.getPrompt(
      'ai_prompt_work_permit',
      '你是企业 EHS 安全专家，擅长作业危险性分析（JSA）。请分析作业风险并给出防护措施。',
    );
    const user = [
      `作业类型：${t.label}${t.isHazardous ? '（危险作业）' : ''}`,
      `作业内容：${input.content || '（空）'}`,
      `地点：${input.location || '（未知）'}`,
      `时间：${input.startTime || '-'} ~ ${input.endTime || '-'}`,
      '',
      '请返回两部分：',
      '1) 风险分析（分段说明主要危险有害因素）；',
      '2) 防护措施清单（用“- ”开头的多条建议，可被直接填入安全措施表）。',
    ].join('\n');

    const text = await (await this.getProvider()).chat(sys, user, { mode: 'work_risk' });
    return this.splitRiskAndMeasures(text);
  }

  // ========== 作业票：JSA 工作安全分析（按作业步骤逐一分析危害与措施）==========
  // 接收作业内容 + 作业步骤，逐步骤分析，返回 [{step, hazard, control}]；
  // 用户在作业票页可编辑后保存（落库到 work_permits.jsas）。
  async analyzeJsa(input: {
    content?: string;
    steps?: string[];
    type?: string;
  }): Promise<Array<{ step: string; hazard: string; control: string; risk?: string }>> {
    const sys = await this.getPrompt(
      'ai_prompt_jsa',
      [
        '你是企业 EHS（环境、健康、安全）安全工程师，精通工作安全分析（JSA）。',
        '请基于作业内容和每个作业步骤，进行严格、具体、可执行的 JSA 分析。',
        '',
        '【对每一个步骤，必须满足】',
        '1. 危害描述：与该步骤的动作、操作对象、作业环境直接关联，30 字以内，精简到位。',
        '   严禁「其他安全隐患」「管理或防护不到位」「一般事故」等笼统/模板化表述。',
        '2. 风险等级：从「低」「中」「高」「重大」四选一，基于后果严重性与发生概率综合判定。',
        '3. 控制措施：具体可执行的动作（如「挂锁挂牌后使用验电笔逐相验电，确认无电压」），30 字以内。',
        '   严禁「明确整改责任人与期限」「制定并落实控制措施」「完成后验收闭环」等模板话术。',
        '4. 每个步骤至少识别 1 个危害；同一步骤有多个危害时，拆成多行（step 相同，各占一行）。',
        '5. 所有步骤必须逐一分析，不允许遗漏任何一步。',
      ].join('\n'),
    );
    const stepsText = (input.steps || [])
      .map((s, i) => `${i + 1}. ${s}`)
      .join('\n');
    const user = [
      `作业类型：${input.type || '常规作业'}`,
      `作业内容：${input.content || '（空）'}`,
      `作业步骤：\n${stepsText || '（未填写具体步骤）'}`,
      '',
      '严格按下面的 JSON 数组格式返回（不要加任何多余说明文字，只要 JSON 数组）：',
      '[',
      '  {"step":"步骤1内容","hazard":"危害描述（≤30字）","risk":"高","control":"控制措施（≤30字）"},',
      '  {"step":"步骤1内容","hazard":"同一步骤的第2个危害","risk":"中","control":"对应的控制措施"},',
      '  {"step":"步骤2内容","hazard":"危害描述","risk":"低","control":"控制措施"}',
      ']',
    ].join('\n');
    const text = await (await this.getProvider()).chat(sys, user, { mode: 'jsa' });
    return this.parseJsaArray(text);
  }

  private parseJsaArray(text: string): Array<{ step: string; hazard: string; control: string; risk?: string }> {
    try {
      const m = text.match(/\[[\s\S]*\]/);
      if (m) {
        const arr = JSON.parse(m[0]);
        if (Array.isArray(arr)) {
          return arr
            .map((x: any) => ({
              step: String(x.step ?? '').trim(),
              hazard: String(x.hazard ?? '').trim(),
              control: String(x.control ?? '').trim(),
              risk: String(x.risk ?? '').trim(),
            }))
            .filter((x) => x.step);
        }
      }
    } catch {
      /* ignore */
    }
    return [];
  }

  // ========== 作业票：提交后后台复核 ==========
  async reviewWorkPermitAfterSubmit(input: {
    type: string;
    content: string;
    measures: string[];
    ocrSummary?: string;
  }): Promise<{ extraRisks: string; measuresAdequate: string }> {
    const t = getWorkPermitType(input.type);
    const sys = '你是资深 EHS 审核专家，负责在作业票提交后做最终风险复核。';
    const user = [
      `作业类型：${t.label}${t.isHazardous ? '（危险作业）' : ''}`,
      `作业内容：${input.content || '（空）'}`,
      `申请人已填写的安全措施：${(input.measures || []).join('；') || '（无）'}`,
      `相关证件 OCR 摘要：${input.ocrSummary || '（无）'}`,
      '',
      '请回答两点：',
      '1) 是否还存在申请人未考虑到的其他风险？（如有，列出）',
      '2) 已填写的防护措施是否到位？还缺什么？（给出明确结论）',
    ].join('\n');

    const text = await (await this.getProvider()).chat(sys, user, { mode: 'work_review' });
    return {
      extraRisks: text,
      measuresAdequate: text,
    };
  }

  // ========== 安全交底：生成交底要点草稿 ==========
  // 根据申请单作业概况 + 涉及的危险作业类型，生成现场安全交底要点清单（每条一行）。
  async generateSafetyBriefing(input: {
    jobName?: string;
    content?: string;
    location?: string;
    hazardTypes?: string[]; // 危险作业类型 label 列表
  }): Promise<{ points: string[]; raw: string }> {
    const sys =
      '你是企业 EHS 安全专家，负责班前/作业前现场安全交底。请针对具体作业，生成简明可勾选的安全交底要点。';
    const user = [
      `作业名称：${input.jobName || '（未填）'}`,
      `作业内容：${input.content || '（空）'}`,
      `作业地点：${input.location || '（未知）'}`,
      `涉及危险作业：${(input.hazardTypes || []).join('、') || '无（普通作业）'}`,
      '',
      '请只输出安全交底要点清单，每条一行、用“- ”开头，覆盖：危险有害因素告知、个体防护、应急处置、监护要求、作业禁令等。不要输出其他说明文字。',
    ].join('\n');
    const text = await (await this.getProvider()).chat(sys, user, { mode: 'work_risk' });
    const points = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[-*]\s+/.test(l) || /^\d+[.、]\s+/.test(l))
      .map((l) => l.replace(/^([-*]\s+|\d+[.、]\s+)/, '').trim())
      .filter(Boolean);
    return { points, raw: text };
  }

  // ---- 工具：尽力把模型输出解析成 JSON ----
  private parseJson(text: string): Record<string, any> {
    try {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
    } catch {
      /* ignore */
    }
    return { raw: text };
  }

  private splitRiskAndMeasures(text: string): { riskAnalysis: string; suggestions: string[] } {
    const suggestions: string[] = [];
    const lines = text.split('\n');
    let riskPart: string[] = [];
    let inMeasures = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^[-*]\s+/.test(trimmed) || /^\d+[.、]\s+/.test(trimmed)) {
        inMeasures = true;
        suggestions.push(trimmed.replace(/^([-*]\s+|\d+[.、]\s+)/, ''));
      } else if (inMeasures) {
        // 措施里换行的补充说明
        if (trimmed) suggestions[suggestions.length - 1] += ' ' + trimmed;
      } else {
        riskPart.push(trimmed);
      }
    }
    return { riskAnalysis: riskPart.join('\n').trim(), suggestions };
  }
}
