import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api, { hasPerm } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { Button, PageHeader, Select, EmptyState } from '@/components/ui';
import { DataTable, MetricTile, StatStrip, FilterBar, SearchInput, StatusPill, Avatar } from '@/components/kit';
import { HAZARD_STATUS, RISK_LEVELS } from '@/constants';
import { Plus, ShieldAlert, ListChecks, Inbox, Clock, Wrench, ShieldCheck, ClipboardCheck, CheckCircle2, XCircle, Ban, Archive } from 'lucide-react';
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

export default function HazardsList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  // 支持 URL 直达：?status=&scope=（消息中心「隐患整改」→ status=assigned&scope=assigned）
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [risk, setRisk] = useState('');
  const [scope, setScope] = useState(searchParams.get('scope') || '');
  const [mine, setMine] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{ total: number; open: number; byStatus: { status: string; count: number }[] }>({ total: 0, open: 0, byStatus: [] });

  // URL 参数变化（如从消息中心跳转）时同步筛选状态
  useEffect(() => {
    const s = searchParams.get('status');
    const sc = searchParams.get('scope');
    if (s !== null) setStatus(s);
    if (sc !== null) setScope(sc);
    if (s !== null || sc !== null) setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '15',
        ...(q ? { keyword: q } : {}),
        ...(status ? { status } : {}),
        ...(risk ? { riskLevel: risk } : {}),
        ...(scope ? { scope } : {}),
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

  useEffect(() => { load(); loadStats(); }, [page, status, risk, mine]);

  function pick(statusKey: string) {
    setPage(1);
    setStatus(statusKey);
  }

  const countOf = (k: string) => stats.byStatus.find((s) => s.status === k)?.count ?? 0;

  return (
    <div className="page-fade space-y-[var(--gap-card)]">
      <PageHeader
        title="隐患管理"
        description="隐患上报、整改与验收全过程追踪"
        icon={<ShieldAlert size={20} />}
        actions={
          <>
            <Button variant="ghost" onClick={() => setMine(!mine)}>
              {mine ? '查看全部' : '只看我的上报'}
            </Button>
            {hasPerm(user, 'hazard:create') && (
              <Button onClick={() => navigate('/hazards/report')}>
                <Plus size={16} className="mr-1" /> 上报隐患
              </Button>
            )}
          </>
        }
      />

      <StatStrip>
        <MetricTile label="全部隐患" value={stats.total} icon={<ListChecks size={20} />} onClick={() => pick('')} active={status === ''} />
        {Object.entries(HAZARD_STATUS).map(([k, v]) => (
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
        <SearchInput value={q} onChange={setQ} onSearch={load} placeholder="搜索隐患描述 / 编号" />
        <Select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
          <option value="">全部状态</option>
          {Object.entries(HAZARD_STATUS).map(([k, v]) => (
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
          {
            key: 'submitterName',
            header: '上报人',
            render: (h) => (
              <span className="flex items-center gap-2 text-xs">
                <Avatar name={h.submitterName} size={26} />
                <span>{h.submitterName}{h.isAnonymous ? '（扫码）' : ''}</span>
              </span>
            ),
          },
          { key: 'department', header: '部门', render: (h) => <span className="text-xs">{h.department || '—'}</span> },
          { key: 'description', header: '描述', render: (h) => <span className="block max-w-[280px] truncate text-xs">{h.description}</span> },
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
            header: '时间',
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
        empty={<EmptyState icon={<Inbox size={26} />} title="暂无隐患记录" hint="点击右上角「上报隐患」开始登记" />}
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
