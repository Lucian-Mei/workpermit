import React, { useEffect, useState, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import api from '@/api/client';
import { Card, CardContent, Button, Input, Select, Modal, PageHeader, EmptyState } from '@/components/ui';
import { DataTable, FilterBar, SearchInput, StatusPill, Avatar, MetricTile, StatStrip, Tag } from '@/components/kit';
import { Users, Plus, RotateCcw, Upload, UserCheck, UserX, Inbox } from 'lucide-react';

const STATUS_COLOR: Record<string, string> = { active: '#16a34a', disabled: '#dc2626' };

export default function UsersList() {
  const [rows, setRows] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [depts, setDepts] = useState<string[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [roleKey, setRoleKey] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({
    name: '',
    department: '',
    area: '',
    email: '',
    phone: '',
    managerId: '',
    roleKeys: [] as string[],
  });
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState('');
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [u, r, d, a] = await Promise.all([
      api.get('/users?pageSize=200'),
      api.get('/roles'),
      api.get('/departments'),
      api.get('/areas'),
    ]);
    setRows(u.data.items || []);
    setRoles(r.data || []);
    setDepts((d.data || []).map((x: any) => x.name));
    setAreas((a.data || []).filter((x: any) => x.enabled !== false).map((x: any) => x.name));
  }
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return rows.filter((u) => {
      const matchQ =
        !kw ||
        u.name?.toLowerCase().includes(kw) ||
        u.username?.toLowerCase().includes(kw) ||
        (u.department || '').toLowerCase().includes(kw);
      const matchR = !roleKey || (u.roles || []).some((r: any) => r.key === roleKey);
      return matchQ && matchR;
    });
  }, [rows, q, roleKey]);

  function toggleRole(key: string) {
    setForm((f) => ({
      ...f,
      roleKeys: f.roleKeys.includes(key) ? f.roleKeys.filter((k) => k !== key) : [...f.roleKeys, key],
    }));
  }

  function openCreate() {
    setEditing(null);
    setForm({ name: '', department: '', area: '', email: '', phone: '', managerId: '', roleKeys: [] });
    setPwd('');
    setErr('');
    setOpen(true);
  }
  function openEdit(u: any) {
    setEditing(u);
    setForm({
      name: u.name,
      department: u.department || '',
      area: u.area || '',
      email: u.email || '',
      phone: u.phone || '',
      managerId: u.managerId || '',
      roleKeys: (u.roles || []).map((r: any) => r.key),
    });
    setPwd('');
    setErr('');
    setOpen(true);
  }

  async function submit() {
    setErr('');
    try {
      if (editing) {
        await api.put(`/users/${editing.id}`, form);
      } else {
        const { data } = await api.post('/users', form);
        setPwd(data.plainPassword);
      }
      setOpen(false);
      load();
    } catch (e: any) {
      setErr(e.response?.data?.message || '保存失败');
    }
  }

  async function reset(id: string) {
    if (!confirm('确定重置该员工密码？')) return;
    try {
      const { data } = await api.post(`/users/${id}/reset-password`, {});
      alert(`新密码：${data.plainPassword}\n${data.message || ''}`.trim());
    } catch (e: any) {
      alert(e.response?.data?.message || '重置失败');
    }
  }
  async function disable(id: string) {
    if (!confirm('确定停用该账号？')) return;
    await api.put(`/users/${id}/disable`, {});
    load();
  }
  async function enable(id: string) {
    await api.put(`/users/${id}/enable`, {}).catch(() => {});
    load();
  }

  // 批量导入：解析 Excel/CSV（首行表头：姓名/部门/区域/邮箱/手机/角色）
  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setErr('');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: any[] = XLSX.utils.sheet_to_json(ws);
      const rows = raw.map((r: any) => ({
        name: r['姓名'] ?? r['name'] ?? r['Name'] ?? '',
        department: r['部门'] ?? r['department'] ?? '',
        area: r['区域'] ?? r['area'] ?? '',
        email: r['邮箱'] ?? r['email'] ?? '',
        phone: String(r['手机'] ?? r['phone'] ?? ''),
        roleKeys: String(r['角色'] ?? r['role'] ?? '')
          .split(/[,，]/)
          .map((s: string) => s.trim())
          .filter(Boolean),
      }));
      const { data } = await api.post('/users/import', { rows });
      alert(`导入完成：成功 ${data.created?.length ?? 0} 条，失败 ${data.errors?.length ?? 0} 条`);
      load();
    } catch (e: any) {
      setErr(e?.message || '导入失败');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="page-fade space-y-[var(--gap-card)]">
      <PageHeader
        title="员工账号"
        description="员工建档、角色分配与账号启停管理"
        icon={<Users size={20} />}
        actions={
          <>
            <label className="inline-flex items-center gap-1 px-3 py-2 border rounded-lg text-sm text-primary cursor-pointer hover:bg-accent">
              <Upload size={16} /> {importing ? '导入中…' : '批量导入'}
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onImport} />
            </label>
            <Button onClick={openCreate}>
              <Plus size={16} className="mr-1" /> 新建员工
            </Button>
          </>
        }
      />

      <StatStrip>
        <MetricTile label="全部员工" value={rows.length} icon={<Users size={16} />} />
        <MetricTile
          label="正常"
          value={rows.filter((u) => u.status === 'active').length}
          color="#16a34a"
          icon={<UserCheck size={16} />}
        />
        <MetricTile
          label="停用"
          value={rows.filter((u) => u.status !== 'active').length}
          color="#dc2626"
          icon={<UserX size={16} />}
        />
      </StatStrip>

      <FilterBar>
        <SearchInput value={q} onChange={setQ} placeholder="搜索姓名 / 账号 / 部门" />
        <Select value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
          <option value="">全部角色</option>
          {roles.map((r) => (
            <option key={r.id} value={r.key}>
              {r.name}
            </option>
          ))}
        </Select>
      </FilterBar>

      <DataTable
        loading={false}
        rows={filtered}
        rowKey={(u) => u.id}
        columns={[
          {
            key: 'name',
            header: '姓名',
            render: (u) => (
              <span className="flex items-center gap-2 text-xs">
                <Avatar name={u.name} size={26} />
                <span className="font-medium">{u.name}</span>
              </span>
            ),
          },
          { key: 'username', header: '账号', render: (u) => <span className="text-xs">{u.username}</span> },
          { key: 'email', header: '邮箱', render: (u) => <span className="text-xs">{u.email || '—'}</span>, hideOn: 'md' },
          { key: 'department', header: '部门', render: (u) => <span className="text-xs">{u.department || '—'}</span>, hideOn: 'md' },
          {
            key: 'managerName',
            header: '直属领导',
            hideOn: 'md',
            render: (u) => <span className="text-xs">{u.managerName || '—'}</span>,
          },
          {
            key: 'roles',
            header: '角色',
            render: (u) =>
              (u.roles || []).length ? (
                <span className="flex flex-wrap gap-1">
                  {(u.roles as any[]).map((r) => (
                    <Tag key={r.key}>{r.name}</Tag>
                  ))}
                </span>
              ) : (
                <span className="text-xs">—</span>
              ),
          },
          {
            key: 'status',
            header: '状态',
            render: (u) => (
              <StatusPill color={STATUS_COLOR[u.status === 'active' ? 'active' : 'disabled']}>
                {u.status === 'active' ? '正常' : '停用'}
              </StatusPill>
            ),
          },
          {
            key: 'op',
            header: '操作',
            align: 'right',
            render: (u) => (
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
                  编辑
                </Button>
                <Button variant="ghost" size="sm" onClick={() => reset(u.id)}>
                  <RotateCcw size={12} className="mr-1" /> 重置密码
                </Button>
                {u.status === 'active' ? (
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => disable(u.id)}>
                    停用
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" className="text-success" onClick={() => enable(u.id)}>
                    启用
                  </Button>
                )}
              </div>
            ),
          },
        ]}
        empty={<EmptyState icon={<Inbox size={26} />} title="暂无员工账号" hint="点击右上角「新建员工」或「批量导入」" />}
      />

      <Modal
        open={open}
        title={editing ? '编辑员工' : '新建员工账号'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={submit}>保存</Button>
          </>
        }
      >
        {err && <div className="mb-2 text-sm text-destructive bg-destructive/10 rounded p-2">{err}</div>}
        {pwd && (
          <div className="mb-2 text-sm text-success bg-success/10 rounded p-2">
            初始密码：{pwd}（请线下告知员工，首次登录需修改）
          </div>
        )}
        <div className="space-y-3">
          <div>
            <label className="text-sm">姓名 *</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="系统将自动生成拼音账号" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm">部门</label>
              <Select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                <option value="">— 请选择 —</option>
                {depts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-sm">区域</label>
              <Select value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}>
                <option value="">— 请选择 —</option>
                {areas.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-sm">邮箱</label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="text-sm">手机</label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <label className="text-sm">直属领导</label>
              <Select value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })}>
                <option value="">— 无 —</option>
                {rows.filter((m) => m.id !== editing?.id).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <label className="text-sm">角色 *</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {roles.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggleRole(r.key)}
                  className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                    form.roleKeys.includes(r.key)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border hover:bg-accent'
                  }`}
                >
                  {r.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
