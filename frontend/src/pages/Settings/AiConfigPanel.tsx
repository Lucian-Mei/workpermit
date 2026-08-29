import React, { useEffect, useState } from 'react';
import api from '@/api/client';
import { Button, Input, Card, CardContent } from '@/components/ui';
import { Section, FormGrid, Field } from '@/components/kit';
import { KeyRound, Sparkles, ExternalLink, Check, Zap, Gift } from 'lucide-react';

// 内置厂商预设：全部为 OpenAI 兼容协议，选中即自动填好接口地址与默认模型，
// 用户只需去对应控制台白嫖一个“免费额度”Key 粘贴进来即可使用。
interface Vendor {
  key: string;
  label: string;
  base: string;
  model: string;
  freeUrl: string;
  freeText: string;
  tag?: string;
  hint?: string;
}
const PROVIDERS: Vendor[] = [
  {
    key: 'deepseek',
    label: 'DeepSeek 深度求索',
    base: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    freeUrl: 'https://platform.deepseek.com/',
    freeText: '新账号送 500 万免费 tokens（30 天）',
    tag: '最易上手 · 推荐',
    hint: '默认已切到 deepseek-v4-flash（老模型 deepseek-chat 已于 2026-07-24 停用）。你这量级付费仅约 ¥4–5/月。',
  },
  {
    key: 'siliconflow',
    label: '硅基流动（免费聚合）',
    base: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    freeUrl: 'https://cloud.siliconflow.cn/',
    freeText: '注册送免费额度 · 一个 Key 调用 DeepSeek / Qwen / Kimi 等',
    tag: '免费聚合 · 一个 Key 多用',
    hint: '新用户送 2000 万 tokens（永久有效）；9B 以下模型（如 DeepSeek-R1-Distill-Llama-8B、Qwen2.5-7B）更是永久免费不限量，对你这量级零成本。',
  },
  {
    key: 'doubao',
    label: '豆包（火山方舟）',
    base: 'https://ark.cn-beijing.volcesecsp.com/api/v3',
    model: 'doubao-seed-1.6-250615',
    freeUrl: 'https://console.volcengine.com/ark',
    freeText: '方舟模型免费试用额度',
    hint: '方舟需把“模型”替换为你创建的推理接入点 Endpoint ID（ep-xxxx）。',
  },
  {
    key: 'kimi',
    label: 'Kimi（月之暗面）',
    base: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    freeUrl: 'https://platform.moonshot.cn/',
    freeText: '新用户免费额度',
    hint: '模型可选 moonshot-v1-8k / kimi-k2 等。',
  },
  {
    key: 'hunyuan',
    label: '元宝（腾讯混元）',
    base: 'https://api.hunyuan.cloud.tencent.com/v1',
    model: 'hunyuan-turbos-latest',
    freeUrl: 'https://cloud.tencent.com/product/hunyuan',
    freeText: '混元有免费额度 / 体验版',
    hint: '模型可选 hunyuan-turbos-latest / hunyuan-lite（免费）等。',
  },
  {
    key: 'tongyi',
    label: '通义千问（阿里）',
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    freeUrl: 'https://dashscope.console.aliyun.com/',
    freeText: '百炼平台免费额度',
    hint: '模型可选 qwen-plus / qwen-max / qwen-turbo 等。',
  },
  {
    key: 'openai',
    label: 'OpenAI',
    base: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    freeUrl: 'https://platform.openai.com/',
    freeText: '需自备 Key',
    hint: '需自备 Key，无免费额度。',
  },
  {
    key: 'offline',
    label: '离线演示（无需密钥）',
    base: '',
    model: 'offline',
    freeUrl: '',
    freeText: '无需 Key，保存即可体验',
    tag: '沙箱无密钥也能用',
    hint: '由内置规则生成的分析（非真实大模型），用于本地体验 AI 分析全流程；正式部署时建议切换到上方任一真实厂商。',
  },
];

export default function AiConfigPanel() {
  const [provider, setProvider] = useState('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [apiModel, setApiModel] = useState('');
  const [apiBase, setApiBase] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testRes, setTestRes] = useState<any>(null);
  const [err, setErr] = useState('');

  async function load() {
    try {
      const { data } = await api.get('/ai/config');
      if (data.provider) setProvider(data.provider);
      if (data.apiModel) setApiModel(data.apiModel);
      if (data.apiBase) setApiBase(data.apiBase);
      setHasKey(!!data.hasKey);
    } catch {}
  }
  useEffect(() => {
    load();
  }, []);

  function onPickProvider(key: string) {
    setProvider(key);
    const p = PROVIDERS.find((x) => x.key === key);
    if (p) {
      setApiBase(p.base);
      setApiModel(p.model);
    }
  }

  const active = PROVIDERS.find((x) => x.key === provider);

  async function save() {
    setBusy(true);
    setErr('');
    setTestRes(null);
    try {
      await api.put('/ai/config', { provider, apiKey, apiModel, apiBase });
      setHasKey(true);
      setApiKey('');
      alert('AI 配置已保存，立即生效，无需重启。');
      load();
    } catch (e: any) {
      setErr(e.response?.data?.message || '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setErr('');
    setTestRes(null);
    try {
      const { data } = await api.post('/ai/test', {});
      setTestRes(data);
      if (!data.ok) setErr(data.error || '测试未通过');
    } catch (e: any) {
      setErr(e.response?.data?.message || '测试失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-5">
        <Section title="AI 接口配置" icon={<Sparkles size={18} className="text-primary" />}>
          <p className="text-sm text-muted-foreground">
            下方已内置多家支持<strong className="text-foreground">免费额度</strong>的国产大模型（豆包 / Kimi / 元宝 / 通义 / DeepSeek 等）。
            点选一家即自动填好接口地址与默认模型，再去它的控制台<strong className="text-foreground">白嫖一个免费 Key</strong>粘贴进来，隐患分析、作业票风险分析、提交复核即可直接使用——无需改代码、无需重启。
          </p>
        </Section>

        <div>
          <div className="text-sm font-medium mb-2">选择模型厂商（点击即应用预设）</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {PROVIDERS.map((p) => {
              const selected = p.key === provider;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => onPickProvider(p.key)}
                  className={[
                    'relative text-left rounded-lg border p-3 transition-colors',
                    selected
                      ? 'border-primary bg-primary/10 ring-1 ring-primary'
                      : 'border-border bg-card hover:border-primary/50',
                  ].join(' ')}
                >
                  {selected && (
                    <span className="absolute top-2 right-2 text-primary">
                      <Check size={15} />
                    </span>
                  )}
                  <div className="flex items-center gap-1.5 font-medium text-sm pr-4">
                    {p.key === 'siliconflow' ? <Zap size={15} className="text-amber-500" /> : <Sparkles size={15} className="text-primary" />}
                    {p.label}
                  </div>
                  {p.tag && (
                    <div className="mt-1 text-[11px] text-primary/80 leading-tight">{p.tag}</div>
                  )}
                  {p.freeUrl ? (
                    <a
                      href={p.freeUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
                    >
                      <Gift size={12} className="text-emerald-500" />
                      {p.freeText}
                      <ExternalLink size={11} />
                    </a>
                  ) : (
                    <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Gift size={12} className="text-emerald-500" />
                      {p.freeText}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {active?.hint && (
            <p className="mt-2 text-xs text-muted-foreground">提示：{active.hint}</p>
          )}
        </div>

        <FormGrid cols={2}>
          <Field label="模型名称">
            <Input value={apiModel} onChange={(e) => setApiModel(e.target.value)} placeholder="如 deepseek-chat" />
          </Field>
          <Field
            label="API Key"
            hint={hasKey ? '（已配置，留空表示不修改）' : undefined}
          >
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasKey ? '已保存，留空则不修改' : '粘贴厂商控制台获得的免费 Key'}
            />
          </Field>
          <Field label="接口地址（Base URL，一般无需修改）" className="md:col-span-2">
            <Input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://api.deepseek.com/v1" />
          </Field>
        </FormGrid>

        {err && <div className="text-sm text-destructive bg-destructive/10 rounded p-2">{err}</div>}
        {testRes?.ok && (
          <div className="text-sm text-success bg-success/10 rounded p-2">
            连通成功，模型返回：{testRes.reply}
          </div>
        )}

        <div className="flex gap-2">
          <Button disabled={busy} onClick={save}>
            <KeyRound size={16} className="mr-1" />
            保存配置
          </Button>
          <Button variant="secondary" disabled={busy} onClick={test}>
            测试连通性
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
