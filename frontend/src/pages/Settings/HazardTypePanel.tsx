import React, { useEffect, useState } from 'react';
import api from '@/api/client';
import { Card, CardContent, Button, Input, Textarea, Modal, Switch, EmptyState } from '@/components/ui';
import { Section, DataTable, StatusPill, Field } from '@/components/kit';
import { ListChecks, Plus, Pencil, Trash2 } from 'lucide-react';

const OK = 'hsl(var(--success))';
const OFF = 'hsl(var(--muted-foreground))';

export default function HazardTypePanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: '', regulations: '', enabled: true, sortOrder: 0 });

  async function load() {
    try {
      const { data } = await api.get('/hazard-types');
      setRows(data || []);
    } catch {}
  }
  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ name: '', regulations: '', enabled: true, sortOrder: 0 });
    setOpen(true);
  }
  function openEdit(r: any) {
    setEditing(r);
    setForm({
      name: r.name,
      regulations: (r.regulations || []).join('、'),
      enabled: r.enabled ?? true,
      sortOrder: r.sortOrder ?? 0,
    });
    setOpen(true);
  }
  async function submit() {
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        regulations: form.regulations
          .split(/[、,，\n]/)
          .map((s: string) => s.trim())
          .filter(Boolean),
        enabled: form.enabled,
        sortOrder: Number(form.sortOrder) || 0,
      };
      if (editing) await api.put(`/hazard-types/${editing.id}`, payload);
      else await api.post('/hazard-types', payload);
      setOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function remove(r: any) {
    if (!confirm(`删除隐患类型「${r.name}」？`)) return;
    await api.delete(`/hazard-types/${r.id}`);
    await load();
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <Section
          title="隐患类型列表"
          icon={<ListChecks size={18} className="text-primary" />}
          action={
            <Button size="sm" onClick={openCreate}><Plus size={16} className="mr-1" />新增类型</Button>
          }
        >
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              { key: 'name', header: '名称', render: (r) => <span className="font-medium">{r.name}</span> },
              {
                key: 'regulations',
                header: '关联法规',
                render: (r) => <span className="text-xs text-muted-foreground">{(r.regulations || []).join('、') || '-'}</span>,
              },
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
            empty={<EmptyState icon={<ListChecks size={26} />} title="暂无隐患类型" hint="点击右上角「新增类型」开始登记" />}
          />
        </Section>
      </CardContent>
      <Modal
        open={open}
        title={editing ? '编辑隐患类型' : '新增隐患类型'}
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
          <Field label="关联法规条款（用、或,分隔）">
            <Textarea rows={2} value={form.regulations} onChange={(e) => setForm({ ...form, regulations: e.target.value })} />
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
