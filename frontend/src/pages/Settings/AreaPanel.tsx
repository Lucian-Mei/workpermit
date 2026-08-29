import React, { useEffect, useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import api from '@/api/client';
import { Card, CardContent, Button, Input, Textarea, Modal, Switch, EmptyState } from '@/components/ui';
import { Section, DataTable, StatusPill, Field } from '@/components/kit';
import { Upload, Building2, Plus, Pencil, Trash2 } from 'lucide-react';

const OK = 'hsl(var(--success))';
const OFF = 'hsl(var(--muted-foreground))';

export default function AreaPanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: '', code: '', description: '', building: '', floor: '', responsibleDept: '', enabled: true, sortOrder: 0 });
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const { data } = await api.get('/areas');
      setRows(data || []);
    } catch {}
  }
  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ name: '', code: '', description: '', building: '', floor: '', responsibleDept: '', enabled: true, sortOrder: 0 });
    setOpen(true);
  }
  function openEdit(r: any) {
    setEditing(r);
    setForm({ name: r.name, code: r.code || '', description: r.description || '', building: r.building || '', floor: r.floor || '', responsibleDept: r.responsibleDept || '', enabled: r.enabled ?? true, sortOrder: r.sortOrder ?? 0 });
    setOpen(true);
  }
  async function submit() {
    setBusy(true);
    try {
      if (editing) await api.put(`/areas/${editing.id}`, form);
      else await api.post('/areas', form);
      setOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function remove(r: any) {
    if (!confirm(`删除区域「${r.name}」？`)) return;
    await api.delete(`/areas/${r.id}`);
    await load();
  }

  // 批量导入：解析 Excel/CSV（首行表头：名称/编码/说明）
  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: any[] = XLSX.utils.sheet_to_json(ws);
      const rows = raw.map((r: any) => ({
        name: r['名称'] ?? r['name'] ?? '',
        code: r['编码'] ?? r['区域ID'] ?? r['code'] ?? '',
        building: r['建筑'] ?? r['building'] ?? '',
        floor: r['楼层'] ?? r['floor'] ?? '',
        responsibleDept: r['负责部门'] ?? r['预计负责部门'] ?? r['responsibleDept'] ?? '',
        description: r['说明'] ?? r['description'] ?? '',
      })).filter((r: any) => r.name);
      const { data } = await api.post('/areas/import', { rows });
      alert(`导入完成：成功 ${data.created?.length ?? 0} 条，失败 ${data.errors?.length ?? 0} 条`);
      await load();
    } catch (err: any) {
      alert('导入失败：' + (err?.message || err));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <Section
          title="区域列表"
          icon={<Building2 size={18} className="text-primary" />}
          action={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={importing} onClick={() => fileRef.current?.click()}>
                <Upload size={16} className="mr-1" /> {importing ? '导入中…' : '批量导入'}
              </Button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onImport} />
              <Button size="sm" onClick={openCreate}><Plus size={16} className="mr-1" />新增区域</Button>
            </div>
          }
        >
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              { key: 'name', header: '名称', render: (r) => <span className="font-medium">{r.name}</span> },
              { key: 'code', header: '编码', render: (r) => <span className="font-mono text-xs text-muted-foreground">{r.code || '-'}</span> },
              { key: 'building', header: '建筑', render: (r) => <span className="text-muted-foreground">{r.building || '-'}</span> },
              { key: 'floor', header: '楼层', render: (r) => <span className="text-muted-foreground">{r.floor || '-'}</span> },
              { key: 'dept', header: '负责部门', render: (r) => <span className="text-muted-foreground">{r.responsibleDept || '-'}</span> },
              {
                key: 'enabled',
                header: '状态',
                render: (r) => (
                  <StatusPill color={r.enabled ? OK : OFF}>{r.enabled ? '启用' : '停用'}</StatusPill>
                ),
              },
              {
                key: 'op',
                header: '操作',
                align: 'right',
                render: (r) => (
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                      <Pencil size={14} className="mr-1" />编辑
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(r)}>
                      <Trash2 size={14} className="mr-1" />删除
                    </Button>
                  </div>
                ),
              },
            ]}
            empty={<EmptyState icon={<Building2 size={26} />} title="暂无区域" hint="点击右上角「新增区域」开始登记" />}
          />
        </Section>
      </CardContent>
      <Modal
        open={open}
        title={editing ? '编辑区域' : '新增区域'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button disabled={busy} onClick={submit}>
              {editing ? '保存' : '创建'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="名称" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="编码（区域ID，作业票编号前缀，可选）">
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
          <Field label="建筑">
            <Input value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} />
          </Field>
          <Field label="楼层">
            <Input value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} />
          </Field>
          <Field label="负责部门">
            <Input value={form.responsibleDept} onChange={(e) => setForm({ ...form, responsibleDept: e.target.value })} />
          </Field>
          <Field label="说明">
            <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-muted/40 px-3 py-2">
            <span className="text-sm font-medium">启用</span>
            <Switch checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
          </div>
        </div>
      </Modal>
    </Card>
  );
}
