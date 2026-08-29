import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/client';
import { Card, CardContent, Button, Input, Textarea, Select, Modal, EmptyState, PageHeader } from '@/components/ui';
import { Section, DataTable, Field } from '@/components/kit';
import { BookOpen, Plus, Pencil, Trash2, Check, Search, Eye, GraduationCap, Settings, ChevronDown } from 'lucide-react';
import dayjs from 'dayjs';

export default function TrainingManagement() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'config' | 'questions' | 'records'>('config');

  return (
    <div className="page-fade space-y-[var(--gap-card)]">
      <PageHeader
        title="一级安全培训"
        description="管理考试题库、查看培训记录。承包商扫码在线考试→通过→3个月有效"
        icon={<GraduationCap size={20} />}
      />
      
      <Card>
        <CardContent className="p-0">
          <div className="flex border-b border-border">
            <TabBtn active={tab === 'config'} onClick={() => setTab('config')}>
              <Settings size={14} className="mr-1" /> 考试设置
            </TabBtn>
            <TabBtn active={tab === 'questions'} onClick={() => setTab('questions')}>试题管理</TabBtn>
            <TabBtn active={tab === 'records'} onClick={() => setTab('records')}>培训记录</TabBtn>
            <TabBtn active={false} onClick={() => navigate('/training/exam')}>
              <Eye size={14} className="mr-1" /> 考试页面预览
            </TabBtn>
          </div>
          <div className="p-4">
            {tab === 'config' && <ConfigPanel />}
            {tab === 'questions' && <QuestionsPanel />}
            {tab === 'records' && <RecordsPanel />}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TabBtn({ active, onClick, children }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center px-4 py-2.5 text-sm border-b-2 transition ${
        active ? 'border-primary font-medium text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function ConfigPanel() {
  const [form, setForm] = useState({ validityDays: '90', passScore: '60', questionCount: '5' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get('/training/config').then(({ data }) => {
      if (typeof data === 'object' && !Array.isArray(data)) {
        setForm({ validityDays: data.validity_days || '90', passScore: data.pass_score || '60', questionCount: data.question_count || '5' });
      }
    }).catch(() => {});
  }, []);
  async function save() {
    setBusy(true); setMsg('');
    try {
      await Promise.all([
        api.put('/training/config/validity_days', { value: form.validityDays }),
        api.put('/training/config/pass_score', { value: form.passScore }),
        api.put('/training/config/question_count', { value: form.questionCount }),
      ]);
      setMsg('保存成功');
    } catch (e: any) { setMsg('保存失败：' + (e.response?.data?.message || String(e))); }
    finally { setBusy(false); }
  }
  return (
    <div className="max-w-lg space-y-4">
      <Field label="培训有效期（天）" hint="通过后在此天数内无需重训。例：90 = 3个月">
        <Input type="number" min="1" value={form.validityDays} onChange={(e) => setForm({ ...form, validityDays: e.target.value })} />
      </Field>
      <Field label="及格分数线（百分比）" hint="例：60 表示答对 60% 即通过">
        <Input type="number" min="1" max="100" value={form.passScore} onChange={(e) => setForm({ ...form, passScore: e.target.value })} />
      </Field>
      <Field label="每次抽题数量" hint="从题库中随机抽取的题目数，举例 10">
        <Input type="number" min="1" max="50" value={form.questionCount} onChange={(e) => setForm({ ...form, questionCount: e.target.value })} />
      </Field>
      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={busy}>保存</Button>
        {msg && <span className={`text-sm ${msg.includes('失败') ? 'text-destructive' : 'text-success'}`}>{msg}</span>}
      </div>
    </div>
  );
}

function QuestionsPanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [form, setForm] = useState({ question: '', options: ['', '', '', ''], answer: '', sort: 0 });
  const [err, setErr] = useState('');

  async function load() { try { const { data } = await api.get('/training/questions'); setRows(data || []); } catch {} }
  useEffect(() => { load(); }, []);

  function openCreate() { setEditing(null); setForm({ question: '', options: ['', '', '', ''], answer: '', sort: 0 }); setErr(''); setOpen(true); }
  function openEdit(r: any) { setEditing(r); setForm({ question: r.question, options: r.options?.length === 4 ? r.options : ['', '', '', ''], answer: r.answer, sort: r.sort ?? 0 }); setErr(''); setOpen(true); }
  async function submit() {
    setErr('');
    if (!form.question.trim()) { setErr('请填写题目'); return; }
    const validOpts = form.options.filter((o) => o.trim()).map((o) => o.trim());
    if (validOpts.length < 2) { setErr('至少需要 2 个有效选项'); return; }
    if (!form.answer) { setErr('请选择正确答案'); return; }
    try {
      if (editing) { await api.put(`/training/questions/${editing.id}`, { ...form, options: validOpts }); }
      else { await api.post('/training/questions', { ...form, options: validOpts }); }
      setOpen(false); load();
    } catch (e: any) { setErr(e.response?.data?.message || '保存失败'); }
  }
  async function remove(r: any) {
    if (!confirm(`确定删除「${r.question?.slice(0, 30)}…」？`)) return;
    try { await api.delete(`/training/questions/${r.id}`); load(); } catch {}
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground">共 {rows.length} 道试题</span>
        <Button size="sm" onClick={openCreate}><Plus size={14} className="mr-1" />新增试题</Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="暂无试题" description="请新增题目以启用在线考试" />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-start gap-2 rounded-lg border border-border p-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{r.question}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(r.options || []).map((o: string, i: number) => (
                    <span key={i} className={`text-xs px-1.5 py-0.5 rounded ${o.startsWith(r.answer) ? 'bg-success/15 text-success font-medium' : 'bg-muted text-muted-foreground'}`}>{o}</span>
                  ))}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => openEdit(r)}><Pencil size={13} /></Button>
                <Button variant="ghost" size="sm" onClick={() => remove(r)}><Trash2 size={13} /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? '编辑试题' : '新增试题'}>
        <div className="space-y-3">
          <Field label="题目" required>
            <Textarea rows={2} value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} placeholder="如：进入受限空间作业前，需要进行什么？" />
          </Field>
          {form.options.map((o, i) => (
            <Field key={i} label={`选项 ${String.fromCharCode(65 + i)}`}>
              <div className="flex items-center gap-2">
                <Input value={o} onChange={(e) => { const opts = [...form.options]; opts[i] = e.target.value; setForm({ ...form, options: opts }); }} placeholder={`选项 ${String.fromCharCode(65 + i)} 内容`} />
                <button type="button" className={`px-2 py-1 rounded text-xs font-medium ${form.answer === String.fromCharCode(65 + i) ? 'bg-success text-white' : 'bg-muted text-muted-foreground'}`} onClick={() => setForm({ ...form, answer: String.fromCharCode(65 + i) })}>
                  {form.answer === String.fromCharCode(65 + i) ? <Check size={14} /> : String.fromCharCode(65 + i)}
                </button>
              </div>
            </Field>
          ))}
          {err && <div className="text-sm text-destructive">{err}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={submit}>{editing ? '保存' : '新增'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function RecordsPanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [detail, setDetail] = useState<any>(null);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [name]);

  async function load() {
    try {
      const { data } = await api.get('/training/records', { params: { name: name || undefined } });
      setRows(data || []);
    } catch {}
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" value={name} onChange={(e) => setName(e.target.value)} placeholder="按姓名搜索培训记录" />
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="暂无培训记录" />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id}>
              <div
                className="flex items-center justify-between rounded-lg border border-border p-3 text-sm cursor-pointer hover:bg-accent/50 transition"
                onClick={() => setDetail(detail?.id === r.id ? null : r)}
              >
                <div className="flex items-center gap-3">
                  <div className="font-medium">{r.name}</div>
                  <span className="text-muted-foreground">|</span>
                  <span>{r.phone || '—'}</span>
                  <span className="text-muted-foreground">|</span>
                  <span>{r.score}/{r.total} ({r.total > 0 ? Math.round((r.score || 0) / r.total * 100) : 0}%)</span>
                  <span className={r.passed ? 'text-success font-medium' : 'text-destructive font-medium'}>{r.passed ? '通过' : '未通过'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{r.createdAt ? dayjs(r.createdAt).format('MM-DD HH:mm') : ''}</span>
                  <ChevronDown size={14} className={`transition ${detail?.id === r.id ? 'rotate-180' : ''} text-muted-foreground`} />
                </div>
              </div>
              {detail?.id === r.id && r.answers?.length > 0 && (
                <div className="rounded-b-lg border-x border-b border-border bg-muted/20 p-3 space-y-2">
                  <div className="text-xs font-medium text-muted-foreground mb-2">答卷详情：</div>
                  {(r.answers || []).map((a: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className={`shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${a.isCorrect ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'}`}>
                        {a.isCorrect ? '✓' : '✗'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{a.question}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          你的答案：<span className={a.isCorrect ? 'text-success' : 'text-destructive'}>{a.userAnswer || '未作答'}</span>
                          {!a.isCorrect && <span className="ml-2">正确答案：<span className="text-success">{a.correctAnswer}</span></span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
