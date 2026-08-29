import React, { useEffect, useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import api from '@/api/client';
import { Card, CardContent, Button, Input, Modal, Switch, EmptyState } from '@/components/ui';
import { Section, DataTable, Field } from '@/components/kit';
import { Upload, HardHat, Plus, Pencil, Trash2, Power, PowerOff, Search } from 'lucide-react';

/**
 * 承包商库管理面板：
 * - 列表：单位 / 负责人 / 电话 / 启用状态 / 更新时间
 * - 新增 / 编辑 / 启用停用 / 删除
 * - 关键字搜索（单位+负责人）
 * - Excel 批量导入
 * - 申请单填写时自动从这里下拉（按 enabled 过滤）
 */
export default function ContractorPanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [q, setQ] = useState('');
  const [showDisabled, setShowDisabled] = useState(false);
  const [form, setForm] = useState({ name: '', head: '', phone: '', enabled: true });
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const { data } = await api.get('/contractors', { params: { q: q || undefined, includeDisabled: showDisabled ? 'true' : undefined } });
      setRows(data || []);
    } catch {}
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, showDisabled]);

  function openCreate() {
    setEditing(null);
    setForm({ name: '', head: '', phone: '', enabled: true });
    setErr('');
    setOpen(true);
  }
  function openEdit(r: any) {
    setEditing(r);
    setForm({ name: r.name || '', head: r.head || '', phone: r.phone || '', enabled: r.enabled ?? true });
    setErr('');
    setOpen(true);
  }
  async function submit() {
    setErr('');
    if (!form.name.trim() && !form.head.trim()) {
      setErr('请至少填写承包商单位或负责人');
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await api.put(`/contractors/${editing.id}`, form);
      } else {
        await api.post('/contractors', form);
      }
      setOpen(false);
      load();
    } catch (e: any) {
      setErr(e.response?.data?.message || '保存失败');
    } finally { setBusy(false); }
  }
  async function toggle(r: any) {
    try {
      await api.put(`/contractors/${r.id}/enabled`, { enabled: !r.enabled });
      load();
    } catch (e: any) {
      alert(e.response?.data?.message || '操作失败');
    }
  }
  async function remove(r: any) {
    if (!confirm(`确定删除承包商「${r.name || r.head}」？`)) return;
    try { await api.delete(`/contractors/${r.id}`); load(); } catch (e: any) { alert(e.response?.data?.message || '删除失败'); }
  }

  async function onImport(file: File) {
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const rows = json
        .map((r) => ({ name: String(r['承包商单位'] || r['name'] || r['单位'] || '').trim(), head: String(r['负责人'] || r['head'] || '').trim(), phone: String(r['联系电话'] || r['phone'] || '').trim() }))
        .filter((r) => r.name || r.head);
      let ok = 0;
      for (const r of rows) {
        try { await api.post('/contractors', { ...r, enabled: true }); ok++; } catch {}
      }
      alert(`导入完成：成功 ${ok}/${rows.length}`);
      load();
    } catch (e: any) {
      alert('导入失败：' + (e?.message || String(e)));
    } finally { setBusy(false); }
  }

  return (
    <Section title="承包商库" icon={<HardHat size={16} />} description="作业申请单填写时自动从这里下拉，可启用/停用/批量导入">
      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[12rem]">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索：单位 / 负责人" />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={showDisabled} onChange={setShowDisabled} />
              显示已停用
            </label>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload size={14} className="mr-1" /> 批量导入
            </Button>
            <Button onClick={openCreate}>
              <Plus size={14} className="mr-1" /> 新增承包商
            </Button>
          </div>

          {rows.length === 0 ? (
            <EmptyState title={q ? '没有匹配的承包商' : '暂无承包商'} description={q ? '换个关键词试试' : '点击右上角「新增承包商」开始录入'} />
          ) : (
            <DataTable
              rows={rows}
              rowKey={(r: any) => r.id}
              empty={null}
              columns={[
                { key: 'name', header: '承包商单位', render: (r) => <span className="font-medium">{r.name || <span className="text-muted-foreground">—</span>}</span> },
                { key: 'head', header: '负责人', render: (r) => r.head || <span className="text-muted-foreground">—</span> },
                { key: 'phone', header: '联系电话', render: (r) => r.phone || <span className="text-muted-foreground">—</span> },
                { key: 'enabled', header: '状态', render: (r) => r.enabled ? <span className="text-success">● 启用</span> : <span className="text-muted-foreground">○ 已停用</span> },
                { key: 'updated', header: '更新时间', render: (r) => <span className="text-xs text-muted-foreground">{r.updatedAt ? new Date(r.updatedAt).toLocaleString('zh-CN') : '—'}</span>, hideOn: 'sm' },
                {
                  key: 'actions', header: '操作', render: (r) => (
                    <div className="flex items-center gap-1.5">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(r)}><Pencil size={13} /></Button>
                      <Button variant="ghost" size="sm" onClick={() => toggle(r)} title={r.enabled ? '停用' : '启用'}>
                        {r.enabled ? <PowerOff size={13} /> : <Power size={13} />}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(r)} title="删除"><Trash2 size={13} /></Button>
                    </div>
                  ),
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? '编辑承包商' : '新增承包商'}>
        <div className="space-y-3">
          <Field label="承包商单位" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 恒达机电安装有限公司" />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="负责人">
              <Input value={form.head} onChange={(e) => setForm({ ...form, head: e.target.value })} placeholder="现场负责人姓名" />
            </Field>
            <Field label="联系电话">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="11 位手机号" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
            启用（停用后下拉不再显示，历史申请单仍保留）
          </label>
          {err && <div className="text-sm text-destructive">{err}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={submit} disabled={busy}>{editing ? '保存' : '新增'}</Button>
          </div>
        </div>
      </Modal>
    </Section>
  );
}
