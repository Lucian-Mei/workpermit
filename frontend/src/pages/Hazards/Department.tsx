import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { Button, PageHeader, Select, Card, CardContent, EmptyState } from '@/components/ui';
import { DataTable, MetricTile, StatStrip, FilterBar, SearchInput, StatusPill, Tag } from '@/components/kit';
import { HAZARD_STATUS, RISK_LEVELS } from '@/constants';
import { ListChecks, Building2, Inbox } from 'lucide-react';
import dayjs from 'dayjs';

export default function DepartmentHazards() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{ total: number; byStatus: { status: string; count: number }[] }>({ total: 0, byStatus: [] });

  const departments = user?.managedDepartments || [];

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '15',
        ...(q ? { keyword: q } : {}),
        ...(status ? { status } : {}),
      });
      const { data } = await api.get(`/hazards/department?${params.toString()}`);
      setRows(data.items || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    try {
      const { data } = await api.get('/hazards/department/stats');
      setStats(data || { total: 0, byStatus: [] });
    } catch {}
  }

  useEffect(() => { load(); loadStats(); }, [page, status]);

  function pick(statusKey: string) {
    setPage(1);
    setStatus(statusKey);
  }

  const countOf = (k: string) => stats.byStatus.find((s) => s.status === k)?.count ?? 0;

  if (!departments.length) {
    return (
      <div className="page-fade space-y-[var(--gap-card)]">
        <PageHeader title="部门隐患" description="负责部门下的隐患治理与验收" icon={<Building2 size={20} />} />
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            您未被设置为任何部门的负责人，请联系管理员在“部门管理”中配置。
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-fade space-y-[var(--gap-card)]">
      <PageHeader
        title="部门隐患"
        description="负责部门下的隐患治理与验收"
        icon={<Building2 size={20} />}
        actions={
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Building2 size={15} />
            <span>负责部门：</span>
            {departments.map((d: string) => (
              <Tag key={d} color="var(--primary)" className="font-normal">{d}</Tag>
            ))}
          </div>
        }
      />

      <StatStrip>
        <MetricTile label="全部隐患" value={stats.total} icon={<ListChecks size={16} />} onClick={() => pick('')} active={status === ''} />
        {Object.entries(HAZARD_STATUS).filter(([k]) => k !== 'archived').map(([k, v]) => (
          <MetricTile
            key={k}
            label={v.label}
            value={countOf(k)}
            color={v.color}
            icon={<span className="dot" style={{ background: v.color }} />}
            onClick={() => pick(k)}
            active={status === k}
          />
        ))}
      </StatStrip>

      <FilterBar>
        <SearchInput value={q} onChange={setQ} onSearch={load} placeholder="搜索描述 / 编号" />
        <Select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
          <option value="">全部状态</option>
          {Object.entries(HAZARD_STATUS).filter(([k]) => k !== 'archived').map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </Select>
        <Button variant="secondary" onClick={() => { setPage(1); load(); }}>刷新</Button>
      </FilterBar>

      <DataTable
        loading={loading}
        rows={rows}
        rowKey={(h) => h.id}
        onRowClick={(h) => navigate(`/hazards/${h.id}`)}
        columns={[
          { key: 'hazardNo', header: '编号', render: (h) => <span className="text-xs">{h.hazardNo}</span> },
          { key: 'area', header: '区域', render: (h) => <span>{h.area || '—'}</span> },
          { key: 'location', header: '具体位置', render: (h) => <span>{h.location || '—'}</span> },
          { key: 'description', header: '描述', render: (h) => <span className="block max-w-[200px] truncate">{h.description}</span> },
          {
            key: 'riskLevel',
            header: '风险',
            render: (h) => <StatusPill color={RISK_LEVELS[h.riskLevel]?.color}>{RISK_LEVELS[h.riskLevel]?.label || h.riskLevel}</StatusPill>,
          },
          {
            key: 'status',
            header: '状态',
            render: (h) => <StatusPill color={HAZARD_STATUS[h.status]?.color}>{HAZARD_STATUS[h.status]?.label || h.status}</StatusPill>,
          },
          { key: 'allocatedDepartment', header: '分配部门', render: (h) => <span>{h.allocatedDepartment || '—'}</span> },
          {
            key: 'op',
            header: '操作',
            align: 'right',
            render: (h) => (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); navigate(`/hazards/${h.id}`); }}
              >
                查看
              </Button>
            ),
          },
        ]}
        empty={<EmptyState icon={<Inbox size={26} />} title="暂无部门隐患记录" hint="负责部门下的隐患会显示在这里" />}
      />

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {total} 条</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
          <Button variant="secondary" size="sm" disabled={page * 15 >= total} onClick={() => setPage((p) => p + 1)}>下一页</Button>
        </div>
      </div>
    </div>
  );
}
