import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/client';
import { Button, PageHeader, Select, EmptyState } from '@/components/ui';
import { DataTable, MetricTile, StatStrip, FilterBar, SearchInput, StatusPill } from '@/components/kit';
import { HAZARD_STATUS, RISK_LEVELS } from '@/constants';
import { ShieldCheck, ListChecks, Inbox, Clock, Wrench, ClipboardCheck, CheckCircle2, XCircle, Ban, Archive } from 'lucide-react';

const HAZARD_ICONS: Record<string, React.ReactNode> = {
  pending_assign: <Clock size={18} />,
  assigned: <Wrench size={18} />,
  rectified: <ClipboardCheck size={18} />,
  dept_confirmed: <ShieldCheck size={18} />,
  accepted: <CheckCircle2 size={18} />,
  rejected: <XCircle size={18} />,
  cancelled: <Ban size={18} />,
  archived: <Archive size={18} />,
};
import dayjs from 'dayjs';

export default function AcceptanceManagement() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('dept_confirmed');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{ total: number; open: number; byStatus: { status: string; count: number }[] }>({ total: 0, open: 0, byStatus: [] });

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '15',
        ...(q ? { keyword: q } : {}),
        ...(status ? { status } : {}),
      });
      const { data } = await api.get(`/hazards?${params.toString()}`);
      setRows(data.items || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    try {
      const { data } = await api.get('/hazards/stats');
      setStats(data || { total: 0, open: 0, byStatus: [] });
    } catch {}
  }

  useEffect(() => { load(); loadStats(); }, [page, status]);

  function pick(statusKey: string) {
    setPage(1);
    setStatus(statusKey);
  }

  const countOf = (k: string) => stats.byStatus.find((s) => s.status === k)?.count ?? 0;

  return (
    <div className="page-fade space-y-[var(--gap-card)]">
      <PageHeader
        title="验收管理"
        description="整改完成后由安全员/验收人进行验收闭环"
        icon={<ShieldCheck size={20} />}
      />

      <StatStrip>
        <MetricTile label="全部" value={stats.total} icon={<ListChecks size={18} />} onClick={() => pick('')} active={status === ''} />
        {Object.entries(HAZARD_STATUS).filter(([k]) => k !== 'archived').map(([k, v]) => (
          <MetricTile
            key={k}
            label={v.label}
            value={countOf(k)}
            color={v.color}
            icon={HAZARD_ICONS[k]}
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
          {
            key: 'rectificationDate',
            header: '整改完成',
            align: 'right',
            render: (h) => <span className="text-xs text-muted-foreground">{h.rectificationDate ? dayjs(h.rectificationDate).format('MM-DD HH:mm') : '—'}</span>,
          },
          {
            key: 'op',
            header: '操作',
            align: 'right',
            render: (h) => (
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/hazards/${h.id}`); }}>查看</Button>
            ),
          },
        ]}
        empty={<EmptyState icon={<Inbox size={26} />} title="暂无隐患记录" hint="当前筛选条件下没有待验收记录" />}
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
