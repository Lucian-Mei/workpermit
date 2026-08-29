import React, { useEffect, useState } from 'react';
import api from '@/api/client';
import { Button, Input, Modal, PageHeader, EmptyState } from '@/components/ui';
import { DataTable, MetricTile, StatStrip, Tag } from '@/components/kit';
import { Plus, Trash2, KeyRound, ShieldCheck, SlidersHorizontal, Inbox } from 'lucide-react';
import { PERM_LABEL, PERMISSION_CATALOG, PERM_CATEGORIES } from '@/constants';

const BUILTIN = ['admin', 'safety', 'approver', 'employee'];

export default function RolesList() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ key: '', name: '', description: '', perms: [] as string[] });
  const [err, setErr] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editRole, setEditRole] = useState<any>(null);
  const [editPerms, setEditPerms] = useState<string[]>([]);

  async function load() {
    const { data } = await api.get('/roles');
    setRows(data || []);
  }
  useEffect(() => {
    load();
  }, []);

  function toggle(p: string) {
    setForm((f) => ({ ...f, perms: f.perms.includes(p) ? f.perms.filter((x) => x !== p) : [...f.perms, p] }));
  }
  function toggleEdit(p: string) {
    setEditPerms((arr) => (arr.includes(p) ? arr.filter((x) => x !== p) : [...arr, p]));
  }

  async function create() {
    setErr('');
    try {
      await api.post('/roles', form);
      setOpen(false);
      setForm({ key: '', name: '', description: '', perms: [] });
      load();
    } catch (e: any) {
      setErr(e.response?.data?.message || '创建失败');
    }
  }

  function openEdit(r: any) {
    setEditRole(r);
    setEditPerms(r.permissions || []);
    setEditOpen(true);
  }
  async function saveEdit() {
    if (!editRole) return;
    await api.put(`/roles/${editRole.key}/permissions`, { permissions: editPerms });
    setEditOpen(false);
    load();
  }
  async function remove(key: string) {
    if (!confirm(`删除角色「${key}」？该角色下用户将失去对应权限。`)) return;
    await api.delete(`/roles/${key}`).catch(() => {});
    load();
  }

  return (
    <div className="page-fade space-y-[var(--gap-card)]">
      <PageHeader
        title="角色与权限"
        description="角色定义与权限点分配"
        icon={<KeyRound size={20} />}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} className="mr-1" /> 新建角色
          </Button>
        }
      />

      <StatStrip>
        <MetricTile label="角色总数" value={rows.length} icon={<KeyRound size={16} />} />
        <MetricTile label="内置角色" value={rows.filter((r) => BUILTIN.includes(r.key)).length} color="#6366f1" icon={<ShieldCheck size={16} />} />
        <MetricTile label="自定义角色" value={rows.filter((r) => !BUILTIN.includes(r.key)).length} color="#0ea5e9" icon={<SlidersHorizontal size={16} />} />
      </StatStrip>

      <DataTable
        loading={false}
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          {
            key: 'name',
            header: '角色',
            render: (r) => (
              <div className="flex items-center gap-2">
                <span className="font-medium">{r.name}</span>
                {BUILTIN.includes(r.key) && <Tag color="#6366f1">内置</Tag>}
                <span className="text-xs text-muted-foreground">{r.key}</span>
              </div>
            ),
          },
          { key: 'description', header: '说明', render: (r) => <span className="text-sm text-muted-foreground">{r.description || '—'}</span> },
          {
            key: 'perms',
            header: '权限',
            render: (r) => (
              <span className="flex flex-wrap gap-1">
                {(r.permissions || []).slice(0, 3).map((p: string) => (
                  <Tag key={p}>{PERM_LABEL[p] || p}</Tag>
                ))}
                {(r.permissions || []).length > 3 && (
                  <span className="text-xs text-muted-foreground">+{(r.permissions || []).length - 3}</span>
                )}
                {(r.permissions || []).length === 0 && <span className="text-xs text-muted-foreground">无权限</span>}
              </span>
            ),
          },
          {
            key: 'op',
            header: '操作',
            align: 'right',
            render: (r) => (
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                  编辑权限
                </Button>
                {!BUILTIN.includes(r.key) && (
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(r.key)}>
                    <Trash2 size={14} className="mr-1" /> 删除
                  </Button>
                )}
              </div>
            ),
          },
        ]}
        empty={<EmptyState icon={<Inbox size={26} />} title="暂无角色" hint="点击右上角「新建角色」开始配置" />}
      />

      {/* 新建角色 */}
      <Modal
        open={open}
        title="新建角色"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={create}>创建</Button>
          </>
        }
      >
        {err && <div className="mb-2 text-sm text-destructive bg-destructive/10 rounded p-2">{err}</div>}
        <div className="space-y-3">
          <div>
            <label className="text-sm">角色标识（英文，如 auditor）</label>
            <Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="英文小写" />
          </div>
          <div>
            <label className="text-sm">角色名称</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="text-sm">说明</label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label className="text-sm">权限分配（按功能分类）</label>
            <div className="mt-1 max-h-72 space-y-3 overflow-auto rounded-md border border-border p-2">
              {PERM_CATEGORIES.map((c) => {
                const items = PERMISSION_CATALOG.filter((p) => p.cat === c.key);
                if (items.length === 0) return null;
                const checked = items.filter((p) => form.perms.includes(p.key)).length;
                return (
                  <div key={c.key}>
                    <div className="flex items-center gap-2 py-1 text-xs">
                      <span className="font-semibold text-foreground">{c.label}</span>
                      <span className="truncate text-[11px] text-muted-foreground/70">{c.desc}</span>
                      <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {checked}/{items.length}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {items.map((p) => (
                        <label key={p.key} className="flex items-center gap-2 rounded p-1 text-xs hover:bg-muted">
                          <input type="checkbox" checked={form.perms.includes(p.key)} onChange={() => toggle(p.key)} />
                          <span className="truncate" title={p.key}>{p.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>

      {/* 编辑权限 */}
      <Modal
        open={editOpen}
        title={`编辑权限 — ${editRole?.name || ''}`}
        onClose={() => setEditOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button onClick={saveEdit}>保存权限</Button>
          </>
        }
      >
        <div className="max-h-80 space-y-3 overflow-auto rounded-md border border-border p-2">
          {PERM_CATEGORIES.map((c) => {
            const items = PERMISSION_CATALOG.filter((p) => p.cat === c.key);
            if (items.length === 0) return null;
            const checked = items.filter((p) => editPerms.includes(p.key)).length;
            return (
              <div key={c.key}>
                <div className="flex items-center gap-2 py-1 text-xs">
                  <span className="font-semibold text-foreground">{c.label}</span>
                  <span className="truncate text-[11px] text-muted-foreground/70">{c.desc}</span>
                  <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {checked}/{items.length}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {items.map((p) => (
                    <label key={p.key} className="flex items-center gap-2 rounded border p-1.5 text-xs hover:bg-muted">
                      <input type="checkbox" checked={editPerms.includes(p.key)} onChange={() => toggleEdit(p.key)} />
                      <span className="truncate" title={p.key}>{p.label}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{p.key}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
