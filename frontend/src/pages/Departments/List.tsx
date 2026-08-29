import React, { useEffect, useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import api from '@/api/client';
import { Button, Input, Modal, PageHeader, EmptyState } from '@/components/ui';
import { DataTable, FilterBar, SearchInput, Avatar, MetricTile, StatStrip, Tag } from '@/components/kit';
import { Plus, Pencil, Trash2, Upload, Building2, UserCog, Inbox } from 'lucide-react';

export default function DepartmentsList() {
  const [rows, setRows] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: '', abbreviation: '', responsiblePerson: '', coordinator: '', managerUserIds: [] as string[], defaultRectifierId: '' });
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const { data } = await api.get('/departments');
    setRows(data || []);
  }
  async function loadUsers() {
    const { data } = await api.get('/users?pageSize=1000');
    setUsers((data?.items || []).filter((u: any) => u.status === 'active'));
  }
  useEffect(() => { load(); loadUsers(); }, []);

  function openCreate() {
    setEditing(null);
    setForm({ name: '', abbreviation: '', responsiblePerson: '', coordinator: '', managerUserIds: [], defaultRectifierId: '' });
    setOpen(true);
  }
  function openEdit(d: any) {
    setEditing(d);
    setForm({
      name: d.name,
      abbreviation: d.abbreviation || '',
      responsiblePerson: d.responsiblePerson || '',
      coordinator: d.coordinator || '',
      managerUserIds: (d.managers || []).map((m: any) => m.id),
      defaultRectifierId: d.defaultRectifierId || '',
    });
    setOpen(true);
  }
  async function save() {
    if (editing) await api.put(`/departments/${editing.id}`, form);
    else await api.post('/departments', form);
    setOpen(false);
    load();
  }
  async function remove(id: string) {
    if (!confirm('确定删除该部门？')) return;
    await api.delete(`/departments/${id}`).catch(() => {});
    load();
  }

  function toggleManager(userId: string) {
    setForm((f) => ({
      ...f,
      managerUserIds: f.managerUserIds.includes(userId)
        ? f.managerUserIds.filter((id) => id !== userId)
        : [...f.managerUserIds, userId],
    }));
  }

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
        abbreviation: r['简称'] ?? r['abbreviation'] ?? '',
        responsiblePerson: r['负责人'] ?? r['responsiblePerson'] ?? '',
        coordinator: r['协调人'] ?? r['coordinator'] ?? '',
      }));
      const { data } = await api.post('/departments/import', { rows });
      alert(`导入完成：成功 ${data.created?.length ?? 0} 条，失败 ${data.errors?.length ?? 0} 条`);
      load();
    } catch (err: any) {
      alert('导入失败：' + (err?.message || err));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const deptUsers = users.filter((u) => u.department === form.name);

  const filtered = rows.filter((d) => {
    const kw = q.trim().toLowerCase();
    return !kw || d.name?.toLowerCase().includes(kw) || (d.abbreviation || '').toLowerCase().includes(kw);
  });

  return (
    <div className="page-fade space-y-[var(--gap-card)]">
      <PageHeader
        title="部门管理"
        description="部门建档、负责人与协调人配置"
        icon={<Building2 size={20} />}
        actions={
          <>
            <label className="inline-flex items-center gap-1 px-3 py-2 border rounded-lg text-sm text-primary cursor-pointer hover:bg-accent">
              <Upload size={16} /> {importing ? '导入中…' : '批量导入'}
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onImport} />
            </label>
            <Button onClick={openCreate}>
              <Plus size={16} className="mr-1" /> 新建部门
            </Button>
          </>
        }
      />

      <StatStrip>
        <MetricTile label="部门总数" value={rows.length} icon={<Building2 size={16} />} />
        <MetricTile label="含负责人" value={rows.filter((d) => (d.managers || []).length > 0).length} color="#0ea5e9" icon={<UserCog size={16} />} />
      </StatStrip>

      <FilterBar>
        <SearchInput value={q} onChange={setQ} placeholder="搜索部门名称 / 简称" />
      </FilterBar>

      <DataTable
        loading={false}
        rows={filtered}
        rowKey={(d) => d.id}
        columns={[
          {
            key: 'name',
            header: '名称',
            render: (d) => (
              <div className="flex items-center gap-2">
                <Avatar name={d.name} size={26} color="#0ea5e9" />
                <span className="font-medium">{d.name}</span>
              </div>
            ),
          },
          { key: 'abbreviation', header: '简称', render: (d) => <span>{d.abbreviation || '—'}</span> },
          { key: 'responsiblePerson', header: '负责人', render: (d) => <span>{d.responsiblePerson || '—'}</span> },
          { key: 'coordinator', header: '协调人', render: (d) => <span>{d.coordinator || '—'}</span>, hideOn: 'md' },
          {
            key: 'defaultRectifier',
            header: '默认整改人',
            render: (d) => <span>{d.defaultRectifierName || '—'}</span>,
          },
          {
            key: 'managers',
            header: '部门负责人',
            render: (d) =>
              (d.managers || []).length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {(d.managers as any[]).map((m) => (
                    <Tag key={m.id} color="#0ea5e9">{m.name}</Tag>
                  ))}
                </span>
              ) : (
                '—'
              ),
          },
          {
            key: 'op',
            header: '操作',
            align: 'right',
            render: (d) => (
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => openEdit(d)}>
                  <Pencil size={14} className="mr-1" /> 编辑
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(d.id)}>
                  <Trash2 size={14} className="mr-1" /> 删除
                </Button>
              </div>
            ),
          },
        ]}
        empty={<EmptyState icon={<Inbox size={26} />} title="暂无部门" hint="点击右上角「新建部门」或「批量导入」" />}
      />

      <Modal open={open} title={editing ? '编辑部门' : '新建部门'} onClose={() => setOpen(false)} footer={
        <>
          <Button variant="secondary" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={save}>保存</Button>
        </>
      }>
        <div className="space-y-3">
          <div><label className="text-sm">部门名称 *</label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="text-sm">简称</label><Input value={form.abbreviation} onChange={(e) => setForm({ ...form, abbreviation: e.target.value })} /></div>
          <div><label className="text-sm">负责人</label><Input value={form.responsiblePerson} onChange={(e) => setForm({ ...form, responsiblePerson: e.target.value })} placeholder="可填写负责人姓名" /></div>
          <div><label className="text-sm">协调人（按姓名关联员工账号，邮箱取自员工账号）</label><Input value={form.coordinator} onChange={(e) => setForm({ ...form, coordinator: e.target.value })} /></div>
          <div>
            <label className="text-sm">默认整改人（隐患派单时自动带出）</label>
            <select
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              value={form.defaultRectifierId}
              onChange={(e) => setForm({ ...form, defaultRectifierId: e.target.value })}
            >
              <option value="">— 请选择 —</option>
              {deptUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            {form.name && deptUsers.length === 0 && <div className="mt-1 text-xs text-muted-foreground">该部门下暂无员工账号</div>}
          </div>
          <div>
            <label className="text-sm">部门负责人（可勾选多人，用于查看部门隐患）</label>
            <div className="border rounded-lg p-2 mt-1 max-h-40 overflow-auto">
              {form.name && deptUsers.length === 0 && <div className="text-xs text-muted-foreground">该部门下暂无员工账号</div>}
              {!form.name && <div className="text-xs text-muted-foreground">请先填写部门名称</div>}
              {deptUsers.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm p-1 hover:bg-muted rounded">
                  <input type="checkbox" checked={form.managerUserIds.includes(u.id)} onChange={() => toggleManager(u.id)} />
                  {u.name}
                </label>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
