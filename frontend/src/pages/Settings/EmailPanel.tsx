import React, { useEffect, useState } from 'react';
import api from '@/api/client';
import { Card, CardContent, Button, Input, Textarea, Switch, SegTabs } from '@/components/ui';
import { Section, FormGrid, Field } from '@/components/kit';
import { Mail, Server, FileText, Send } from 'lucide-react';

const SMTP_FIELDS = [
  { key: 'host', label: 'SMTP 主机', placeholder: 'smtp.exmail.qq.com' },
  { key: 'port', label: '端口', type: 'number' },
  { key: 'user', label: '发件账号', placeholder: 'notice@company.com' },
  { key: 'pass', label: '发件密码/授权码', type: 'password' },
  { key: 'from', label: '发件人显示', placeholder: 'EHS系统 <notice@company.com>' },
  { key: 'baseUrl', label: '系统访问地址', placeholder: 'https://ehs.company.com' },
];

const EVENT_TABS = [
  { event: 'hazard_submitted', label: '隐患提交' },
  { event: 'hazard_assigned', label: '任务分配' },
  { event: 'hazard_rectified', label: '整改完成' },
  { event: 'hazard_dept_confirmed', label: '部门确认' },
  { event: 'hazard_accepted', label: '验收通过' },
  { event: 'hazard_rejected', label: '整改驳回' },
  { event: 'work_permit_submitted', label: '作业票提交' },
  { event: 'work_permit_approved', label: '作业票批准' },
];

export default function EmailPanel() {
  const [cfg, setCfg] = useState<any>({ enabled: false, host: '', port: 465, secure: true, user: '', pass: '', from: '', baseUrl: '' });
  const [tpls, setTpls] = useState<any[]>([]);
  const [activeEvent, setActiveEvent] = useState('hazard_submitted');
  const [testTo, setTestTo] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { data } = await api.get('/email/config');
      setCfg(data || cfg);
    } catch {}
    try {
      const { data } = await api.get('/email/templates');
      setTpls(data || []);
      if (data?.[0]?.event) setActiveEvent(data[0].event);
    } catch {}
  }
  useEffect(() => { load(); }, []);

  const activeTpl = tpls.find((t) => t.event === activeEvent) || { event: activeEvent, name: '', subject: '', body: '', vars: [] };
  const activeIndex = tpls.findIndex((t) => t.event === activeEvent);

  function updateTpl(patch: Partial<any>) {
    if (activeIndex < 0) {
      setTpls((arr) => [...arr, { event: activeEvent, name: activeTpl.name || EVENT_TABS.find((e) => e.event === activeEvent)?.label, subject: '', body: '', vars: [], ...patch }]);
    } else {
      setTpls((arr) => arr.map((t, i) => (i === activeIndex ? { ...t, ...patch } : t)));
    }
  }

  async function saveCfg() {
    setBusy(true);
    setMsg('');
    try {
      await api.put('/email/config', cfg);
      setMsg('SMTP 配置已保存。');
    } finally {
      setBusy(false);
    }
  }
  async function saveTpls() {
    setBusy(true);
    setMsg('');
    try {
      await api.put('/email/templates', tpls);
      setMsg('邮件模板已保存。');
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setMsg('');
    try {
      const { data } = await api.post('/email/test', { to: testTo });
      setMsg('测试结果：' + JSON.stringify(data));
    } finally {
      setBusy(false);
    }
  }
  async function restoreDefault() {
    if (!confirm('确定恢复默认模板？当前自定义内容将丢失。')) return;
    setBusy(true);
    try {
      await api.put('/email/templates', { restore: true });
      load();
      setMsg('已恢复默认模板。');
    } finally {
      setBusy(false);
    }
  }

  function insertVar(v: string) {
    const ta = document.getElementById('email-body-editor') as HTMLTextAreaElement;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const text = activeTpl.body || '';
    const before = text.slice(0, start);
    const after = text.slice(end);
    const inserted = `{{${v}}}`;
    updateTpl({ body: before + inserted + after });
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + inserted.length, start + inserted.length);
    }, 0);
  }

  return (
    <div className="space-y-[var(--gap-card)]">
      {msg && <div className="text-sm text-primary bg-accent rounded p-2">{msg}</div>}

      <Card>
        <CardContent className="space-y-5">
          <Section title="SMTP 服务器配置" icon={<Server size={18} className="text-primary" />} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-muted/40 px-3 py-2">
              <span className="text-sm font-medium">启用邮件通知</span>
              <Switch checked={!!cfg.enabled} onChange={(v) => setCfg({ ...cfg, enabled: v })} />
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-muted/40 px-3 py-2">
              <span className="text-sm font-medium">SSL/TLS 加密</span>
              <Switch checked={!!cfg.secure} onChange={(v) => setCfg({ ...cfg, secure: v })} />
            </div>
          </div>
          <FormGrid cols={2}>
            {SMTP_FIELDS.map((f) => (
              <Field key={f.key} label={f.label}>
                <Input
                  type={f.type || 'text'}
                  value={cfg[f.key] ?? (f.key === 'port' ? 465 : '')}
                  onChange={(e) => setCfg({ ...cfg, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })}
                  placeholder={f.placeholder}
                />
              </Field>
            ))}
          </FormGrid>
          <div className="flex gap-2 flex-wrap items-center">
            <Button disabled={busy} onClick={saveCfg}><Mail size={16} className="mr-1" />保存配置</Button>
            <Input className="max-w-xs" placeholder="测试收件邮箱" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            <Button variant="secondary" disabled={busy || !testTo} onClick={test}><Send size={16} className="mr-1" />发送测试</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-5">
          <Section title="邮件模板编辑" icon={<FileText size={18} className="text-primary" />} />
          <SegTabs
            items={EVENT_TABS.map((t) => ({ key: t.event, label: t.label }))}
            value={activeEvent}
            onChange={setActiveEvent}
          />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <Field label="邮件主题">
                <Input value={activeTpl.subject || ''} onChange={(e) => updateTpl({ subject: e.target.value })} placeholder="请输入邮件主题" />
              </Field>
              <Field label="邮件正文（支持 HTML，使用 {{变量}} 占位符）">
                <Textarea
                  id="email-body-editor"
                  rows={14}
                  value={activeTpl.body || ''}
                  onChange={(e) => updateTpl({ body: e.target.value })}
                  placeholder="在此编辑 HTML 邮件模板..."
                />
              </Field>
              <div className="flex gap-2 flex-wrap">
                <Button disabled={busy} onClick={saveTpls}>保存模板</Button>
                <Button variant="secondary" disabled={busy} onClick={restoreDefault}>恢复默认</Button>
              </div>
            </div>
            <div>
              <div className="text-sm font-medium mb-2">可用变量</div>
              <div className="text-xs text-muted-foreground mb-2">点击即可插入到正文</div>
              <div className="space-y-1">
                {(activeTpl.vars || []).map((v: string) => (
                  <Button
                    key={v}
                    variant="outline"
                    size="sm"
                    className="w-full justify-start font-mono"
                    onClick={() => insertVar(v)}
                  >
                    {'{{' + v + '}}'}
                  </Button>
                ))}
                {(activeTpl.vars || []).length === 0 && (
                  <div className="text-xs text-muted-foreground">通用变量：hazardNo, submitter, location, riskLevel, description, assignee, deadline, rectificationDesc, reason, permitNo, type, applicant, actionUrl</div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
