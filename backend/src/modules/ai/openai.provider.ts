import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { AiProvider } from './ai-provider.interface';

// 统一用 OpenAI 兼容接口（DeepSeek / OpenAI / 通义千问 / 豆包 皆兼容）。
// 配置（apiKey / base / model）由 AiService 在每次调用时按“系统设置 > 环境变量”兜底传入，
// 因此可在后台界面随时切换模型与厂商，无需改代码、无需重启。
@Injectable()
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai-compatible';
  private readonly logger = new Logger(OpenAiProvider.name);

  constructor(
    private apiKey: string,
    private base: string,
    private model: string,
  ) {}

  async chat(system: string, user: string, _opts?: { mode?: any }): Promise<string> {
    if (!this.apiKey) {
      this.logger.warn('未配置 AI API Key，返回占位分析（请在系统设置中配置）');
      return '【未配置AI接口】请在“系统设置 → AI 配置”中填写 API Key 后使用 AI 分析功能。';
    }
    try {
      const resp = await axios.post(
        `${this.base}/chat/completions`,
        {
          model: this.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.3,
          max_tokens: 2000,
        },
        { headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 },
      );
      const text: string = resp.data?.choices?.[0]?.message?.content || '';
      return text.trim();
    } catch (e: any) {
      this.logger.error('AI 调用失败：' + (e?.message || e));
      return '【AI调用失败】' + (e?.message || String(e));
    }
  }

  // 流式输出：逐 token 产出，用于前端实时展示进度、提升“响应速度”体感。
  // 返回 AsyncGenerator<string>，每个 chunk 为增量文本片段。
  async *streamChat(system: string, user: string, _opts?: { mode?: any }): AsyncGenerator<string> {
    if (!this.apiKey) {
      yield '【未配置AI接口】请在“系统设置 → AI 配置”中填写 API Key 后使用 AI 分析功能。';
      return;
    }
    try {
      const resp = await axios.post(
        `${this.base}/chat/completions`,
        {
          model: this.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.3,
          max_tokens: 1000,
          stream: true,
        },
        {
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          responseType: 'stream',
          timeout: 60000,
        },
      );
      for await (const chunk of resp.data) {
        const lines = chunk
          .toString()
          .split('\n')
          .map((l: string) => l.trim())
          .filter((l: string) => l.startsWith('data:'));
        for (const line of lines) {
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta: string = json?.choices?.[0]?.delta?.content || '';
            if (delta) yield delta;
          } catch {
            /* 跳过非 JSON 行（如心跳注释） */
          }
        }
      }
    } catch (e: any) {
      this.logger.error('AI 流式调用失败：' + (e?.message || e));
      yield '\n【AI调用失败】' + (e?.message || String(e));
    }
  }
}
