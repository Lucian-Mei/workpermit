import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import LotteryModal from '@/components/LotteryModal';
import { Button, PageHeader, Select, EmptyState } from '@/components/ui';
import { DataTable, MetricTile, StatStrip, FilterBar, SearchInput, StatusPill, Avatar } from '@/components/kit';
import { HAZARD_STATUS, RISK_LEVELS } from '@/constants';
import { ListChecks, ShieldAlert, Inbox, Clock, Wrench, ShieldCheck, ClipboardCheck, CheckCircle2, XCircle, Ban, Archive, Gift } from 'lucide-react';
import dayjs from 'dayjs';

const HAZARD_ICONS: Record<string, React.ReactNode> = {
  pending_assign: <Clock size={20} />,
  assigned: <Wrench size={20} />,
  rectified: <ShieldCheck size={20} />,
  dept_confirmed: <ClipboardCheck size={20} />,
  accepted: <CheckCircle2 size={20} />,
  rejected: <XCircle size={20} />,
  cancelled: <Ban size={20} />,
  archived: <Archive size={20} />,
};

export default function MyHazards() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [risk, setRisk] = useState('');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{ total: number; open: number; byStatus: { status: string; count: number }[] }>({ total: 0, open: 0, byStatus: [] });
  const [winsOpen, setWinsOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      // 调 /hazards/my：仅返回当前用户提交/匿名的隐患
      // （之前调 /hazards 对超管返回全量，与"我的隐患"语义不符）
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '15',
        ...(q ? { keyword: q } : {}),
        ...(status ? { status } : {}),
        ...(risk ? { riskLevel: risk } : {}),
      });
      const { data } = await api.get(`/hazards/my?${params.toString()}`);
      setRows(data.items || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    try {
      // 「我的」统计：取当前用户全部（不分页）再按状态聚合
      const { data } = await api.get('/hazards/my?page=1&pageSize=1000');
      const items = data.items || [];
      const byStatus: Record<string, number> = {};
      for (const h of items) byStatus[h.status] = (byStatus[h.status] || 0) + 1;
      setStats({
        total: items.length,
        open: items.filter((h: any) => h.status === 'pending_assign' || h.status === 'assigned' || h.status === 'rectified' || h.status === 'dept_confirmed').length,
        byStatus: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
      });
    } catch {}
  }

  useEffect(() => { load(); loadStats(); }, [page, status, risk]);

  function pick(statusKey: string) {
    setPage(1);
    setStatus(statusKey);
  }

  const countOf = (k: string) => stats.byStatus.find((s) => s.status === k)?.count ?? 0;

  return (
    <div className="page-fade space-y-[var(--gap-card)]">
      <PageHeader
        title="我的隐患"
        description={user ? `上报人：${user.name}` : '我上报与跟进的隐患'}
        icon={<ShieldAlert size={20} />}
        actions={
          <Button variant="secondary" onClick={() => setWinsOpen(true)}>
            <Gift size={16} className="mr-1" /> 我的中奖
          </Button>
        }
      />

      <StatStrip>
        <MetricTile label="全部隐患" value={stats.total} icon={<ListChecks size={20} />} onClick={() => pick('')} active={status === ''} />
        {Object.entries(HAZARD_STATUS).filter(([k]) => k !== 'archived').map(([k, v]) => (
          <MetricTile
            key={k}
            label={v.label}
            value={countOf(k)}
            color={v.color}
            icon={HAZARD_ICONS[k] || <span className="dot" style={{ background: v.color }} />}
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
        <Select value={risk} onChange={(e) => setRisk(e.target.value)}>
          <option value="">全部风险</option>
          {Object.entries(RISK_LEVELS).map(([k, v]) => (
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
          { key: 'description', header: '描述', render: (h) => <span className="block max-w-[280px] truncate">{h.description}</span> },
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
            key: 'createdAt',
            header: '提交时间',
            align: 'right',
            render: (h) => <span className="text-xs text-muted-foreground">{dayjs(h.createdAt).format('MM-DD HH:mm')}</span>,
          },
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
        empty={<EmptyState icon={<Inbox size={26} />} title="暂无隐患记录" hint="您上报的隐患会显示在这里" />}
      />

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {total} 条</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
          <Button variant="secondary" size="sm" disabled={page * 15 >= total} onClick={() => setPage((p) => p + 1)}>下一页</Button>
        </div>
      </div>

      <LotteryModal open={winsOpen} mode="history" onClose={() => setWinsOpen(false)} />
    </div>
  );
}
