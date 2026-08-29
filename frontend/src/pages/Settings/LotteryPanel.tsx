import React, { useEffect, useState } from 'react';
import api from '@/api/client';
import { Card, CardContent, Button, Input, Textarea, Switch } from '@/components/ui';
import { Section, Field, FormGrid } from '@/components/kit';
import { Ticket, Plus } from 'lucide-react';

export default function LotteryPanel() {
  const [cfg, setCfg] = useState<any>({
    enabled: false,
    name: '安全活动抽奖',
    description: '',
    prizes: [{ label: '谢谢参与', weight: 90 }],
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState('');

  async function load() {
    try {
      const { data } = await api.get('/lottery/config');
      setCfg(data || cfg);
    } catch {}
  }
  useEffect(() => {
    load();
  }, []);

  function updatePrize(i: number, key: string, val: any) {
    const p = [...cfg.prizes];
    p[i] = { ...p[i], [key]: val };
    setCfg({ ...cfg, prizes: p });
  }
  function addPrize() {
    setCfg({ ...cfg, prizes: [...cfg.prizes, { label: '新奖项', weight: 1 }] });
  }
  function removePrize(i: number) {
    const p = [...cfg.prizes];
    p.splice(i, 1);
    setCfg({ ...cfg, prizes: p });
  }

  async function save() {
    setBusy(true);
    setMsg('');
    try {
      await api.put('/lottery/config', cfg);
      setMsg('抽奖设置已保存。');
    } finally {
      setBusy(false);
    }
  }
  async function draw() {
    setBusy(true);
    setResult('');
    try {
      const { data } = await api.post('/lottery/draw', {});
      setResult(JSON.stringify(data));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-fade space-y-[var(--gap-card)]">
      {msg && (
        <div className="rounded-[var(--radius)] bg-accent px-3 py-2 text-sm text-primary">{msg}</div>
      )}
      <Section title="安全活动抽奖设置" icon={<Ticket size={18} />}>
        <Card>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-border bg-card px-3 py-2">
              <div>
                <div className="text-sm font-medium text-foreground">启用抽奖</div>
                <div className="text-xs text-muted-foreground">开启后员工扫码上报隐患可参与抽奖</div>
              </div>
              <Switch checked={!!cfg.enabled} onChange={(v) => setCfg({ ...cfg, enabled: v })} />
            </div>

            <FormGrid cols={2}>
              <Field label="活动名称" className="md:col-span-2">
                <Input value={cfg.name || ''} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} />
              </Field>
              <Field label="活动说明" className="md:col-span-2">
                <Textarea rows={2} value={cfg.description || ''} onChange={(e) => setCfg({ ...cfg, description: e.target.value })} />
              </Field>
            </FormGrid>

            <Section title="奖项与权重（权重越大越容易中）">
              <div className="space-y-2">
                {cfg.prizes?.map((p: any, i: number) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input className="max-w-xs" value={p.label} onChange={(e) => updatePrize(i, 'label', e.target.value)} placeholder="奖项名" />
                    <Input type="number" className="max-w-24" value={p.weight} onChange={(e) => updatePrize(i, 'weight', Number(e.target.value))} />
                    <span className="text-xs text-muted-foreground">权重</span>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removePrize(i)}>
                      删
                    </Button>
                  </div>
                ))}
              </div>
              <Button variant="secondary" size="sm" className="mt-2" onClick={addPrize}>
                <Plus size={14} className="mr-1" /> 增加奖项
              </Button>
            </Section>

            <div className="flex gap-2">
              <Button disabled={busy} onClick={save}>
                保存设置
              </Button>
              <Button variant="secondary" disabled={busy || !cfg.enabled} onClick={draw}>
                试抽一次
              </Button>
            </div>

            {result && (
              <div className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm text-foreground">
                试抽结果：{result}
              </div>
            )}
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
