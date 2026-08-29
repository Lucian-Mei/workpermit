import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { hasPerm } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { Button, PageHeader, Select, EmptyState } from '@/components/ui';
import { DataTable, MetricTile, StatStrip, FilterBar, SearchInput, StatusPill, Avatar, Tag } from '@/components/kit';
import { WORK_PERMIT_STATUS, WORK_PERMIT_TYPES, EPERMIT_CATEGORIES } from '@/constants';
import { ClipboardList, Trash2, Inbox, Plus, ListChecks, ShieldCheck, ClipboardCheck, Hammer, CheckCircle2, Archive, Play, Pause, FileWarning, Link2 } from 'lucide-react';
import dayjs from 'dayjs';

type Kind = 'regular' | 'hazard';

interface Ticket {
  id: string;
  kind: Kind;
  permitNo: string;
  jobName?: string;
  applicantName?: string;
  department?: string;
  status: string;
  isHazardous?: boolean;
  createdAt: string;
  applicantId?: string;
  typeLabel?: string;
  type?: string;
  briefingDone?: boolean;
  linkedRoutineNo?: string;
  materialMissing?: boolean;
}

const PAGE_SIZE = 15;

const CAT_ICONS: Record<string, any> = {
  all: ListChecks,
  reviewing: ShieldCheck,
  briefing: ClipboardCheck,
  working: Hammer,
  in_progress: Play,
  paused: Pause,
  material_missing: FileWarning,
  finished: CheckCircle2,
  archived: Archive,
};

// 分类判定（与后端 categoryConditions 前端近似版，与作业看板 running/paused 口径一致）
// - printed + 未交底 → 交底中；printed + 已交底 → 作业中；进行中 = 两者之和
// - paused 独立为「已暂停」，不归入作业中/进行中
// - completed + 资料缺 → 待补资料；completed + 资料齐 → 已归档
function ticketCategory(r: Ticket): string {
  const s = r.status;
  if (['pending_review', 'ehs_reviewing', 'reviewing'].includes(s)) return 'reviewing';
  if (s === 'printed') return r.briefingDone ? 'working' : 'briefing';
  if (s === 'paused') return 'paused';
  if (s === 'finished') return 'finished';
  if (s === 'completed') return r.materialMissing ? 'material_missing' : 'archived';
  return 'all';
}

// 「进行中」= 交底中 + 作业中
function isInProgress(r: Ticket): boolean {
  const c = ticketCategory(r);
  return c === 'briefing' || c === 'working';
}

export default function UnifiedTicketList({ onlyKind }: { onlyKind?: 'regular' | 'hazard' } = {}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [allRows, setAllRows] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState<'all' | Kind>('all');
  const [wpType, setWpType] = useState('');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);

  async function load() {
    setLoading(true);
    try {
      // 作业票（常规 GWP / 特殊票）都是独立个体，仅从 work_permits 读取；申请单在「作业票申请」页单独管理
      const permitsRes = await api.get('/e-permits?channel=electronic&pageSize=500');
      const permits: any[] = permitsRes.data?.items || [];
      const tickets: Ticket[] = permits.map((w) => ({
        id: w.id,
        kind: w.isHazardous ? 'hazard' : 'regular',
        permitNo: w.permitNo,
        jobName: w.content || w.jobName,
        applicantName: w.applicantName,
        department: w.department,
        status: w.status,
        isHazardous: !!w.isHazardous,
        createdAt: w.createdAt,
        applicantId: w.applicantId,
        typeLabel: w.typeLabel,
        type: w.type,
        briefingDone: !!w.briefingDone,
        linkedRoutineNo: w.linkedRoutineNo,
        materialMissing: !!w.materialMissing,
      }));
      setAllRows(tickets);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const UNFINISHED = ['pending_review', 'ehs_reviewing', 'reviewing', 'printed', 'paused'];

  const filtered = useMemo(() => {
    return allRows.filter((r) => {
      // 草稿不进入作业票管理（草稿票在「作业票申请」中办理）
      if (r.status === 'draft') return false;
      // 拆分页面：常规作业管理只看常规票，危险作业管理只看危险票
      if (onlyKind && r.kind !== onlyKind) return false;
      if (kind !== 'all' && r.kind !== kind) return false;
      if (wpType && r.type !== wpType) return false;
      if (status === 'unfinished') {
        // 聚合虚拟状态：未完成 = 审批中 + 进行中 + 已暂停
        if (!UNFINISHED.includes(r.status)) return false;
      } else if (status === 'in_progress') {
        // 聚合虚拟状态：进行中 = 交底中 + 作业中 = 全部 printed
        if (r.status !== 'printed') return false;
      } else if (status && r.status !== status) return false;
      if (category === 'all') {
        // 默认视图 = 本页全部票（仅排除草稿）；注意：不能提前 return，否则跳过下方 q 搜索过滤
      } else if (category === 'in_progress') {
        if (!isInProgress(r)) return false;
      } else if (ticketCategory(r) !== category) return false;
      if (q) {
        const text = `${r.permitNo} ${r.jobName || ''} ${r.applicantName || ''} ${r.department || ''} ${r.linkedRoutineNo || ''}`.toLowerCase();
        if (!text.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [allRows, kind, wpType, status, category, q, onlyKind]);

  const catCount = (k: string) => {
    // 拆分页面：按 onlyKind 各自统计（卡片数字对应本页面票维度），与列表保持一致
    const base = allRows.filter((r) => {
      if (r.status === 'draft') return false;
      if (onlyKind && r.kind !== onlyKind) return false;
      return true;
    });
    // "全部"显示本页面总票数（排除草稿）
    if (k === 'all') return base.length;
    if (k === 'in_progress') return base.filter((r) => isInProgress(r)).length;
    return base.filter((r) => ticketCategory(r) === k).length;
  };

  function pick(catKey: string) {
    setPage(1);
    setCategory(catKey);
    setStatus('');
  }

  const total = filtered.length;
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function goDetail(r: Ticket) {
    // 作业票都是独立个体（常规 GWP / 特殊票），统一进入作业票详情
    navigate(`/e-permits/view/${r.id}`);
  }

  async function remove(r: Ticket, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('确定删除该草稿？')) return;
    try {
      await api.delete(`/e-permits/${r.id}`);
      load();
    } catch (err: any) {
      alert(err?.response?.data?.message || '删除失败');
    }
  }

  const statusOptions = new Map<string, string>();
  // 聚合虚拟状态（与 8 类卡片口径一致）：未完成 = 审批中+进行中+已暂停；进行中 = 交底中+作业中 = 全部 printed
  statusOptions.set('unfinished', '未完成');
  statusOptions.set('in_progress', '进行中');
  Object.entries(WORK_PERMIT_STATUS).forEach(([k, v]) => {
    if (!statusOptions.has(k)) statusOptions.set(k, v.label);
  });

  const isHazardPage = onlyKind === 'hazard';
  return (
    <div className={`page-fade space-y-[var(--gap-card)] ${isHazardPage ? 'permit-hazard-highlight' : ''}`}>
      <PageHeader
        title={isHazardPage ? '危险作业管理' : '常规作业管理'}
        description={
          isHazardPage
            ? '危险作业票（HWP/CSE/LFP…）独立管理：依附于常规作业票，时间范围须在常规票覆盖范围内'
            : '常规作业票（GWP）独立管理：一张常规票可挂 0~N 张危险作业票，统计维度互不影响'
        }
        icon={<ClipboardList size={20} />}
        actions={
          <>
            {hasPerm(user, 'epermit:create') && (
              <Button onClick={() => navigate('/e-permits/apply')}>
                <Plus size={16} className="mr-1" /> 申请作业票
              </Button>
            )}
          </>
        }
      />

      <StatStrip cols="9">
        {EPERMIT_CATEGORIES.filter((c) => !(onlyKind && c.key === 'archived')).map((c) => {
          const Icon = CAT_ICONS[c.key];
          return (
            <MetricTile
              key={c.key}
              label={c.label}
              value={catCount(c.key)}
              color={c.color}
              icon={Icon ? <Icon size={16} /> : undefined}
              onClick={() => pick(c.key)}
              active={category === c.key}
            />
          );
        })}
      </StatStrip>

      <FilterBar>
        <SearchInput value={q} onChange={setQ} onSearch={() => setPage(1)} placeholder="搜索编号 / 作业名称 / 申请人" />
        {!onlyKind && (
          <Select value={kind} onChange={(e) => { setPage(1); setKind(e.target.value as any); }}>
            <option value="all">全部类型</option>
            <option value="regular">常规作业票</option>
            <option value="hazard">危险作业票</option>
          </Select>
        )}
        {isHazardPage && (
          <Select value={wpType} onChange={(e) => { setPage(1); setWpType(e.target.value); }}>
            <option value="">全部危险类型</option>
            {Object.entries(WORK_PERMIT_TYPES)
              .filter(([k]) => k !== 'routine')
              .map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
          </Select>
        )}
        <Select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
          <option value="">全部状态</option>
          {Array.from(statusOptions.entries()).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </Select>
        <Button variant="secondary" onClick={() => { setPage(1); load(); }}>刷新</Button>
      </FilterBar>

      <DataTable
        loading={loading}
        rows={rows}
        rowKey={(w) => `${w.kind}-${w.id}`}
        onRowClick={goDetail}
        // 危险作业管理：不再用行级高亮（避免列表色块过多），危险作业靠详情页/审批台/现场台卡片高亮辨识
        rowClassName={() => undefined}
        columns={[
          {
            key: 'kind',
            header: '类型',
            render: (w) =>
              w.kind === 'hazard' ? (
                <Tag color="#f97316">{w.typeLabel || '危险作业'}</Tag>
              ) : w.isHazardous ? (
                <Tag color="#f97316">含危险作业</Tag>
              ) : (
                <Tag color="#64748b">常规作业</Tag>
              ),
          },
          { key: 'permitNo', header: '编号', render: (w) => <span className="text-xs">{w.permitNo}</span> },
          ...(isHazardPage
            ? [{
                key: 'linkedRoutineNo',
                header: '关联常规票',
                hideOn: 'sm',
                render: (w: any) =>
                  w.linkedRoutineNo ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Link2 size={12} /> {w.linkedRoutineNo}
                    </span>
                  ) : (
                    <span className="text-xs text-destructive">未关联</span>
                  ),
              }]
            : []),
          { key: 'jobName', header: '作业名称', render: (w) => <span className="font-medium text-xs">{w.jobName || '—'}</span> },
          {
            key: 'applicantName',
            header: '申请人',
            hideOn: 'sm',
            render: (w) => (
              <span className="flex items-center gap-2 text-xs">
                <Avatar name={w.applicantName} size={26} />
                <span>{w.applicantName || '—'}</span>
              </span>
            ),
          },
          { key: 'department', header: '部门', hideOn: 'md', render: (w) => <span className="text-xs">{w.department || '—'}</span> },
          {
            key: 'status',
            header: '状态',
            render: (w) => {
              const meta = WORK_PERMIT_STATUS[w.status] || { label: w.status, color: '#94a3b8' };
              return <StatusPill color={meta.color}>{meta.label}</StatusPill>;
            },
          },
          {
            key: 'createdAt',
            header: '创建时间',
            align: 'right',
            hideOn: 'md',
            render: (w) => <span className="text-xs text-muted-foreground">{dayjs(w.createdAt).format('MM-DD HH:mm')}</span>,
          },
          {
            key: 'op',
            header: '操作',
            align: 'right',
            render: (w) => (
              <div className="flex items-center justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); goDetail(w); }}>查看</Button>
                {w.status === 'draft' && (w.applicantId === user?.id || hasPerm(user, 'epermit:create')) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={(e) => remove(w, e)}
                  >
                    <Trash2 size={14} className="mr-1" /> 删除
                  </Button>
                )}
              </div>
            ),
          },
        ]}
        empty={<EmptyState icon={<Inbox size={26} />} title="暂无作业票" hint="点击「申请作业票」从统一入口开始办理" />}
      />

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {total} 条</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
          <Button variant="secondary" size="sm" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>下一页</Button>
        </div>
      </div>
    </div>
  );
}
