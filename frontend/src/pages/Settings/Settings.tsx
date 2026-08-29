import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '@/api/client';
import { Card, CardContent, Button, SegTabs, PageHeader, Input, Textarea, Select, Switch } from '@/components/ui';
import { DataTable, Field } from '@/components/kit';
import { Download, Cloud, Database, Mail, MapPin, AlertTriangle, Gift, QrCode, Cpu, BookOpen, Palette, Moon, Sun, HardHat, LayoutTemplate } from 'lucide-react';
import { useTheme } from '@/theme/ThemeProvider';
import { ACCENTS, MODES } from '@/theme/skins';
import EmailPanel from './EmailPanel';
import AreaPanel from './AreaPanel';
import HazardTypePanel from './HazardTypePanel';
import LotteryPanel from './LotteryPanel';
import QrCodePanel from './QrCodePanel';
import ContractorPanel from './ContractorPanel';
import AiConfigPanel from './AiConfigPanel';
import DocsPanel from './DocsPanel';
import TrainingPanel from './TrainingPanel';
import PrintTemplatePanel from './PrintTemplatePanel';

type Tab = 'backup' | 'ai' | 'ai_config' | 'email' | 'area' | 'contractor' | 'hazard_type' | 'lottery' | 'qr' | 'feishu' | 'docs' | 'training' | 'appearance' | 'print';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'backup', label: '数据备份', icon: <Database size={16} /> },
  { key: 'ai', label: 'AI 提示词', icon: <Cpu size={16} /> },
  { key: 'ai_config', label: 'AI 接口配置', icon: <Cpu size={16} /> },
  { key: 'email', label: '邮件通知', icon: <Mail size={16} /> },
  { key: 'area', label: '区域管理', icon: <MapPin size={16} /> },
  { key: 'contractor', label: '承包商库', icon: <HardHat size={16} /> },
  { key: 'hazard_type', label: '隐患类型', icon: <AlertTriangle size={16} /> },
  { key: 'lottery', label: '抽奖设置', icon: <Gift size={16} /> },
  { key: 'qr', label: '上报二维码', icon: <QrCode size={16} /> },
  { key: 'feishu', label: '飞书同步', icon: <Cloud size={16} /> },
  { key: 'training', label: '培训配置', icon: <BookOpen size={16} /> },
  { key: 'print', label: '打印模板', icon: <LayoutTemplate size={16} /> },
  { key: 'docs', label: '帮助文档', icon: <BookOpen size={16} /> },
  { key: 'appearance', label: '外观', icon: <Palette size={16} /> },
];

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const validTab = (t: string | null): t is Tab => !!t && TABS.some((x) => x.key === t);
  const initial = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(validTab(initial) ? initial : 'backup');

  // URL 的 ?tab= 变化时同步内部选中（如从侧边栏"帮助文档"进入）
  useEffect(() => {
    const t = searchParams.get('tab');
    if (validTab(t) && t !== tab) setTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const changeTab = (t: Tab) => {
    setTab(t);
    // 同步 URL，保证侧边栏高亮与刷新后状态一致（默认 backup 时清空 query）
    setSearchParams(t === 'backup' ? {} : { tab: t }, { replace: true });
  };

  return (
    <div>
      <PageHeader title="系统设置" description="备份、AI、邮件与外观等系统级配置" />
      <div className="mb-4">
        <SegTabs items={TABS} value={tab} onChange={changeTab} />
      </div>
      {tab === 'backup' && <BackupPanel />}
      {tab === 'ai' && <ConfigPanel />}
      {tab === 'ai_config' && <AiConfigPanel />}
      {tab === 'email' && <EmailPanel />}
      {tab === 'area' && <AreaPanel />}
      {tab === 'contractor' && <ContractorPanel />}
      {tab === 'training' && <TrainingPanel />}
      {tab === 'print' && <PrintTemplatePanel />}
      {tab === 'hazard_type' && <HazardTypePanel />}
      {tab === 'lottery' && <LotteryPanel />}
      {tab === 'qr' && <QrCodePanel />}
      {tab === 'feishu' && <FeishuPanel />}
      {tab === 'docs' && <DocsPanel />}
      {tab === 'appearance' && <AppearancePanel />}
    </div>
  );
}

function BackupPanel() {
  const [backups, setBackups] = useState<any[]>([]);
  const [config, setConfig] = useState<any>({
    enabled: true,
    cycle: 'weekly',
    includePhotos: true,
    keepCount: 5,
    hour: 2,
    minute: 0,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function load() {
    try {
      const [{ data: list }, { data: cfg }] = await Promise.all([
        api.get('/backup/list'),
        api.get('/backup/config'),
      ]);
      setBackups(list || []);
      if (cfg) setConfig(cfg);
    } catch {}
  }
  React.useEffect(() => {
    load();
  }, []);

  async function runBackup() {
    setBusy(true);
    setMsg('');
    try {
      const { data } = await api.post('/backup/download', {});
      setMsg(`备份完成（${data.kind}）：${data.file}`);
      load();
      window.open(data.file, '_blank');
    } finally {
      setBusy(false);
    }
  }

  async function syncFeishu() {
    setBusy(true);
    setMsg('');
    try {
      const { data } = await api.post('/backup/feishu', {});
      setMsg(data.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveConfig() {
    setBusy(true);
    setMsg('');
    try {
      await api.put('/backup/config', config);
      setMsg('自动备份配置已保存。');
    } finally {
      setBusy(false);
    }
  }

  async function removeBackup(name: string) {
    if (!confirm(`确定删除备份文件「${name}」？最新的备份无法删除。`)) return;
    setBusy(true);
    setMsg('');
    try {
      await api.delete(`/backup/${encodeURIComponent(name)}`);
      setMsg(`已删除：${name}`);
      load();
    } catch (e: any) {
      setMsg('删除失败：' + (e?.response?.data?.message || e?.message || '未知错误'));
    } finally {
      setBusy(false);
    }
  }

  const CYCLES = [
    { v: 'weekly', label: '每周' },
    { v: '15days', label: '每 15 天' },
    { v: 'monthly', label: '每月' },
    { v: '2months', label: '每 2 个月' },
    { v: 'quarterly', label: '每季度' },
  ];

  return (
    <div className="space-y-4">
      {msg && <div className="text-sm text-primary bg-accent rounded-md p-2">{msg}</div>}

      <Card>
        <CardContent className="space-y-3">
          <div className="font-medium">自动备份设置</div>
          <div className="text-sm text-muted-foreground">
            系统每天北京时间凌晨 2 点自动检查并执行备份（含数据库与照片）。可设置备份周期与保留份数，避免磁盘空间不足。
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="flex items-center justify-between gap-2 text-sm rounded-[var(--radius)] border border-border bg-muted/40 px-3 py-2 cursor-pointer">
              <span>启用自动备份</span>
              <Switch checked={!!config.enabled} onChange={(v) => setConfig((c: any) => ({ ...c, enabled: v }))} />
            </label>
            <label className="text-sm block">
              备份周期
              <Select
                className="mt-1"
                value={config.cycle}
                onChange={(e) => setConfig((c: any) => ({ ...c, cycle: e.target.value }))}
              >
                {CYCLES.map((c) => (
                  <option key={c.v} value={c.v}>{c.label}</option>
                ))}
              </Select>
            </label>
            <label className="text-sm block">
              保留份数
              <Input
                type="number"
                min={1}
                max={30}
                className="mt-1"
                value={config.keepCount}
                onChange={(e) => setConfig((c: any) => ({ ...c, keepCount: Number(e.target.value) || 5 }))}
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-sm rounded-[var(--radius)] border border-border bg-muted/40 px-3 py-2 cursor-pointer">
              <span>备份照片</span>
              <Switch checked={!!config.includePhotos} onChange={(v) => setConfig((c: any) => ({ ...c, includePhotos: v }))} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveConfig} disabled={busy}>保存配置</Button>
            <Button onClick={runBackup} disabled={busy}>
              <Download size={16} className="mr-1" /> 立即备份并下载
            </Button>
            <Button variant="secondary" onClick={syncFeishu} disabled={busy}>
              <Cloud size={16} className="mr-1" /> 同步到飞书
            </Button>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            若需配置飞书多维表格自动同步，请在服务器 <code className="bg-muted px-1 rounded">.env</code> 中设置 <code className="bg-muted px-1 rounded">FEISHU_*</code> 环境变量，然后重启服务。
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div className="font-medium mb-2">历史备份（仅保留最近 {config.keepCount} 份）</div>
          <DataTable
            loading={busy}
            rows={backups}
            rowKey={(b) => b.name}
            columns={[
              { key: 'name', header: '文件名', render: (b) => <span className="font-mono text-xs">{b.name}</span> },
              { key: 'time', header: '时间', render: (b) => <span className="text-xs text-muted-foreground">{new Date(b.time).toLocaleString('zh-CN')}</span> },
              { key: 'size', header: '大小', render: (b) => <span className="text-xs">{(b.size / 1024).toFixed(1)} KB</span> },
              {
                key: 'op',
                header: '操作',
                align: 'right',
                render: (b, i) => (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy || i === 0}
                    title={i === 0 ? '最新的备份不能删除' : '删除该备份'}
                    onClick={() => removeBackup(b.name)}
                  >
                    {i === 0 ? '最新·不可删' : '删除'}
                  </Button>
                ),
              },
            ]}
            empty={<div className="p-6 text-center text-sm text-muted-foreground">暂无备份</div>}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function ConfigPanel() {
  const [configs, setConfigs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { data } = await api.get('/settings/config');
      setConfigs(data || []);
    } catch {}
  }
  React.useEffect(() => {
    load();
  }, []);

  async function save(c: any) {
    setBusy(true);
    try {
      await api.put(`/settings/config/${c.key}`, { value: c.value });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">AI 提示词可在不改动代码的情况下调整，影响隐患分析、作业票风险分析的质量。</div>
        {configs
          .filter((c) => c.key.startsWith('ai_prompt'))
          .map((c) => (
            <div key={c.key}>
              <label className="text-sm font-medium">{c.key}</label>
              <Textarea
                rows={4}
                className="mt-1 font-mono text-xs"
                value={c.value}
                onChange={(e) => setConfigs((cs) => cs.map((x) => (x.key === c.key ? { ...x, value: e.target.value } : x)))}
              />
              <Button variant="secondary" className="mt-1" disabled={busy} onClick={() => save(c)}>
                保存
              </Button>
            </div>
          ))}
        {configs.filter((c) => c.key.startsWith('ai_prompt')).length === 0 && (
          <div className="text-sm text-muted-foreground">暂无 AI 提示词配置。</div>
        )}
      </CardContent>
    </Card>
  );
}

function AppearancePanel() {
  const { mode, accent, customColor, setMode, setAccent, setCustomColor, resetCustom } = useTheme();
  return (
    <Card>
      <CardContent className="space-y-6">
        {/* 显示模式 */}
        <div>
          <div className="font-medium mb-1">显示模式</div>
          <div className="text-sm text-muted-foreground mb-3">在暗色指挥台与明亮模式之间切换。</div>
          <div className="grid max-w-sm grid-cols-2 gap-3">
            {MODES.map((m) => {
              const active = mode === m.name;
              return (
                <button
                  key={m.name}
                  onClick={() => setMode(m.name)}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                    active ? 'border-primary bg-primary-soft text-primary' : 'border-border hover:border-primary/40'
                  }`}
                >
                  {m.name === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 主题色 */}
        <div>
          <div className="font-medium mb-1">主题色</div>
          <div className="text-sm text-muted-foreground mb-3">
            切换整体主色，侧边栏高亮、按钮、链接、图表主色等即时跟随。
          </div>
          <div className="grid max-w-md grid-cols-5 gap-3">
            {ACCENTS.map((a) => {
              const active = accent === a.name && !customColor;
              return (
                <button
                  key={a.name}
                  title={a.label}
                  onClick={() => setAccent(a.name)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 transition-all ${
                    active ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/40'
                  }`}
                >
                  <span className="h-8 w-8 rounded-full border border-black/10" style={{ background: a.swatch }} />
                  <span className="text-xs font-medium">{a.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 自定义主色 */}
        <div>
          <div className="font-medium mb-1">自定义主色</div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="color"
              value={customColor || '#21c97a'}
              onChange={(e) => setCustomColor(e.target.value)}
              className="h-10 w-16 cursor-pointer rounded-lg border border-border bg-card"
            />
            <Button variant="secondary" onClick={() => setCustomColor('#21c97a')}>
              应用默认绿
            </Button>
            {customColor && (
              <Button variant="ghost" onClick={resetCustom}>
                恢复预设主色
              </Button>
            )}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            自定义主色会覆盖上述预设，刷新或重新登录后依然生效。
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================ 飞书同步 ============================ */
function FeishuPanel() {
  const [form, setForm] = useState({
    FEISHU_APP_ID: '',
    FEISHU_APP_SECRET: '',
    FEISHU_BITABLE_APP_TOKEN: '',
    FEISHU_BITABLE_TABLE_ID: '',
    enabled: false,
  });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { data } = await api.get('/settings/config/feishu');
      const raw = (data && data.value) ? (typeof data.value === 'string' ? JSON.parse(data.value) : data.value) : (data || {});
      setForm({
        FEISHU_APP_ID: raw?.FEISHU_APP_ID || '',
        FEISHU_APP_SECRET: raw?.FEISHU_APP_SECRET ? '••••••' : '',
        FEISHU_BITABLE_APP_TOKEN: raw?.FEISHU_BITABLE_APP_TOKEN || '',
        FEISHU_BITABLE_TABLE_ID: raw?.FEISHU_BITABLE_TABLE_ID || '',
        enabled: raw?.enabled === true,
      });
    } catch {
      // 第一次加载可能没有记录
    }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const payload: any = { enabled: form.enabled };
      if (form.FEISHU_APP_ID) payload.FEISHU_APP_ID = form.FEISHU_APP_ID;
      if (form.FEISHU_APP_SECRET && !form.FEISHU_APP_SECRET.startsWith('••')) payload.FEISHU_APP_SECRET = form.FEISHU_APP_SECRET;
      if (form.FEISHU_BITABLE_APP_TOKEN) payload.FEISHU_BITABLE_APP_TOKEN = form.FEISHU_BITABLE_APP_TOKEN;
      if (form.FEISHU_BITABLE_TABLE_ID) payload.FEISHU_BITABLE_TABLE_ID = form.FEISHU_BITABLE_TABLE_ID;
      await api.put('/settings/config/feishu', { value: JSON.stringify(payload) });
      setMsg('已保存。请到「数据备份」页点击「同步到飞书」验证连通性。');
      load();
    } catch (e: any) {
      setErr(e.response?.data?.message || '保存失败');
    } finally { setBusy(false); }
  }

  async function testSync() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const { data } = await api.post('/backup/feishu', {});
      setMsg(data?.message || '同步成功');
    } catch (e: any) {
      setErr(e.response?.data?.message || '同步失败');
    } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-base font-bold">
          <Cloud size={18} className="text-primary" /> 飞书多维表格同步
        </div>
        <div className="text-sm text-muted-foreground">
          配置后，「数据备份」页的"同步到飞书"按钮会把备份数据写入指定的多维表格。需在飞书开放平台创建自建应用并授权多维表格读写权限。
        </div>
        {msg && <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{msg}</div>}
        {err && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="App ID">
            <Input value={form.FEISHU_APP_ID} onChange={(e) => setForm({ ...form, FEISHU_APP_ID: e.target.value })} placeholder="cli_xxxxx" />
          </Field>
          <Field label="App Secret" hint="已保存的会显示为 ••••，留空表示不修改">
            <Input type="password" value={form.FEISHU_APP_SECRET} onChange={(e) => setForm({ ...form, FEISHU_APP_SECRET: e.target.value })} placeholder="xxxxxxxx" />
          </Field>
          <Field label="多维表格 App Token">
            <Input value={form.FEISHU_BITABLE_APP_TOKEN} onChange={(e) => setForm({ ...form, FEISHU_BITABLE_APP_TOKEN: e.target.value })} placeholder="bascnxxxxx" />
          </Field>
          <Field label="数据表 ID">
            <Input value={form.FEISHU_BITABLE_TABLE_ID} onChange={(e) => setForm({ ...form, FEISHU_BITABLE_TABLE_ID: e.target.value })} placeholder="tblxxxxx" />
          </Field>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
          <div>
            <div className="text-sm font-medium">启用飞书同步</div>
            <div className="text-xs text-muted-foreground">启用后备份页面将显示"同步到飞书"按钮</div>
          </div>
          <Switch checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={busy}>保存配置</Button>
          <Button variant="secondary" onClick={testSync} disabled={busy}>测试同步</Button>
        </div>
      </CardContent>
    </Card>
  );
}
