import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { AiProvider } from './ai-provider.interface';

// DeepSeek（OpenAI 兼容接口）。要换其他家，把 base/mode/key 改掉即可。
// 用法示例：
//   AI_PROVIDER=deepseek
//   AI_API_KEY=sk-xxx
//   AI_API_BASE=https://api.deepseek.com/v1
//   AI_MODEL=deepseek-chat
@Injectable()
export class DeepSeekProvider implements AiProvider {
  readonly name = 'deepseek';
  private readonly logger = new Logger(DeepSeekProvider.name);
  private apiKey: string;
  private base: string;
  private model: string;

  constructor(cfg: ConfigService) {
    this.apiKey = cfg.get<string>('AI_API_KEY') || '';
    this.base = cfg.get<string>('AI_API_BASE') || 'https://api.deepseek.com/v1';
    this.model = cfg.get<string>('AI_MODEL') || 'deepseek-chat';
  }

  async chat(system: string, user: string): Promise<string> {
    if (!this.apiKey) {
      this.logger.warn('未配置 AI_API_KEY，返回占位分析（请在 .env 配置）');
      return '【未配置AI接口】请在系统设置或 .env 中配置 AI_API_KEY 后使用 AI 分析功能。';
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
}
