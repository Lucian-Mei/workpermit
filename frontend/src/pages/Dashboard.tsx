import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  AlertTriangle,
  Clock,
  ClipboardList,
  Users,
  Building2,
  Activity,
  ShieldCheck,
  Gauge,
  RefreshCw,
  ListChecks,
  ArrowRight,
  CheckCircle2,
  TrendingUp,
  Ban,
} from 'lucide-react';
import api from '@/api/client';
import { Card, CardContent, Spinner, PageHeader, Progress, Button } from '@/components/ui';
import { StatStrip, MetricTile, tint } from '@/components/kit';
import { HAZARD_STATUS, WORK_PERMIT_STATUS, RISK_LEVELS, WORK_PERMIT_TYPES } from '@/constants';

interface Overview {
  scope?: 'all' | 'dept' | 'self';
  hazards: {
    total: number;
    open: number;
    byStatus: { status: string; count: number }[];
    byRisk: { riskLevel: string; count: number }[];
    byDept: { dept: string; count: number }[];
  };
  workPermits: {
    total: number;
    pending: number;
    byStatus: { status: string; count: number }[];
    byType: { type: string; count: number }[];
  };
  usersCount: number;
  departmentsCount: number;
  hazardTrend: { month: string; reported: number; rectified: number }[];
  wpTrend: { month: string; reported: number }[];
  overdue: { count: number; list: any[] };
  efficiency: { avgRectifyDays: number; rejectRate: number };
}

type LabelColor = { label: string; color: string } | undefined;

function Bars({
  data,
  labelOf,
}: {
  data: { key: string; count: number }[];
  labelOf: (k: string) => LabelColor;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  if (data.length === 0) {
    return <div className="text-sm text-muted-foreground py-3">暂无数据</div>;
  }
  return (
    <div className="space-y-2.5">
      {data.map((d) => {
        const m = labelOf(d.key);
        const pct = Math.round((d.count / max) * 100);
        return (
          <div key={d.key} className="flex items-center gap-3 text-sm">
            <div className="w-24 shrink-0 truncate text-muted-foreground" title={m?.label || d.key}>
              {m?.label || d.key}
            </div>
            <div className="h-5 flex-1 overflow-hidden rounded-md bg-muted">
              <div
                className="h-full rounded-md transition-all"
                style={{ width: `${pct}%`, backgroundColor: m?.color || 'hsl(var(--primary))' }}
              />
            </div>
            <div className="w-8 text-right text-muted-foreground tabular-nums">{d.count}</div>
          </div>
        );
      })}
    </div>
  );
}
// 状态/风险 -> 设计令牌配色（与皮肤变量联动）
const HAZARD_STATUS_COLOR: Record<string, string> = {
  pending_assign: 'hsl(var(--warning))',
  assigned: 'hsl(var(--primary))',
  rectified: 'hsl(var(--chart-3))',
  dept_confirmed: 'hsl(190 84% 47%)',
  accepted: 'hsl(var(--success))',
  rejected: 'hsl(var(--destructive))',
  cancelled: 'hsl(var(--muted-foreground))',
};
const RISK_COLOR: Record<string, string> = {
  low: 'hsl(var(--risk-low))',
  normal: 'hsl(var(--success))',
  major: 'hsl(var(--risk-medium))',
  critical: 'hsl(var(--risk-critical))',
};
const WP_STATUS_COLOR: Record<string, string> = {
  draft: 'hsl(var(--muted-foreground))',
  pending_review: 'hsl(var(--warning))',
  reviewing: 'hsl(var(--primary))',
  approved: 'hsl(var(--success))',
  rejected: 'hsl(var(--destructive))',
  completed: 'hsl(var(--chart-4))',
};

function PanelHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/12 text-primary">
        {icon}
      </span>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
    </div>
  );
}

/* ======================= 今日待我处理 ======================= */
const TODO_META: Record<string, { icon: React.ReactNode; color: string; to: string }> = {
  approval: { icon: <Clock size={16} />, color: 'hsl(var(--warn-fg))', to: '/e-applications' },
  briefing: { icon: <ShieldCheck size={16} />, color: 'hsl(var(--info-fg))', to: '/e-onsite/list' },
  hazard: { icon: <AlertTriangle size={16} />, color: 'hsl(var(--danger-fg))', to: '/hazards' },
  dept_review: { icon: <AlertTriangle size={16} />, color: 'hsl(var(--danger-fg))', to: '/hazards' },
  hazard_accept: { icon: <CheckCircle2 size={16} />, color: 'hsl(var(--success-fg))', to: '/hazards' },
};

function TodoSection({ todos, navigate }: { todos: any; navigate: (p: string) => void }) {
  if (!todos) return null;
  const groups = (todos.groups || []).filter((g: any) => g.items?.length > 0);
  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-success/12 text-success">
            <CheckCircle2 size={18} />
          </span>
          <div>
            <div className="text-sm font-semibold text-foreground">今日待办已全部处理 ✓</div>
            <div className="text-xs text-muted-foreground">没有需要你跟进的审批、交底或隐患。</div>
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <ListChecks size={15} />
        </span>
        <h2 className="text-sm font-semibold text-foreground">今日待我处理</h2>
        <span className="ml-auto text-xs font-medium text-primary">{todos.total} 项待办</span>
      </div>
      <div className="grid grid-cols-1 gap-[var(--gap-card)] md:grid-cols-3">
        {groups.map((g: any) => (
          <TodoGroup key={g.key} group={g} meta={TODO_META[g.key]} onGo={(p) => navigate(p)} />
        ))}
      </div>
    </section>
  );
}

function TodoGroup({ group, meta, onGo }: { group: any; meta: any; onGo: (p: string) => void }) {
  const color = meta?.color || 'hsl(var(--foreground))';
  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col">
        <div className="mb-3 flex items-center gap-2.5">
          <span className="todo-ic" style={tint(color)}>{meta?.icon}</span>
          <h3 className="text-sm font-semibold text-foreground">{group.label}</h3>
          <span
            className="ml-auto rounded-full px-2 py-0.5 text-xs font-semibold"
            style={tint(color)}
          >
            {group.items.length}
          </span>
        </div>
        <div className="space-y-2">
          {group.items.slice(0, 4).map((it: any) => (
            <button key={it.id} className="todo-row" onClick={() => onGo(it.to)}>
              <span className="todo-ic shrink-0" style={tint(color)}>
                {meta?.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{it.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{it.sub}</span>
              </span>
              <span className="shrink-0 text-xs font-medium text-primary">去处理 <ArrowRight size={13} className="ml-0.5 inline" /></span>
            </button>
          ))}
        </div>
        <button
          className="mt-3 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
          onClick={() => onGo(meta?.to || '/')}
        >
          查看全部 {group.items.length} 项 →
        </button>
      </CardContent>
    </Card>
  );
}

/* ======================= 趋势图 ======================= */
const C_REPORT = '#3b82f6';
const C_RECT = '#22c55e';
const C_WP = '#0ea5e9';
const C_OVERDUE = '#ef4444';
const DEPT_PALETTE = ['#0ea5e9', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#ec4899', '#64748b'];

function HazardTrendChart({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <defs>
          <linearGradient id="gRep" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C_REPORT} stopOpacity={0.35} />
            <stop offset="100%" stopColor={C_REPORT} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gRec" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C_RECT} stopOpacity={0.35} />
            <stop offset="100%" stopColor={C_RECT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} interval={0} angle={-30} textAnchor="end" height={48} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
        <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
        <Area type="monotone" dataKey="reported" name="上报" stroke={C_REPORT} fill="url(#gRep)" strokeWidth={2} />
        <Area type="monotone" dataKey="rectified" name="整改完成" stroke={C_RECT} fill="url(#gRec)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function WpTrendChart({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <defs>
          <linearGradient id="gWp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C_WP} stopOpacity={0.35} />
            <stop offset="100%" stopColor={C_WP} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} interval={0} angle={-30} textAnchor="end" height={48} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
        <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
        <Area type="monotone" dataKey="reported" name="作业申请" stroke={C_WP} fill="url(#gWp)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function DeptBar({ data }: { data: any[] }) {
  if (!data || data.length === 0) return <div className="py-10 text-center text-xs text-muted-foreground">暂无数据</div>;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="dept" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} interval={0} angle={-20} textAnchor="end" height={48} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
        <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.3 }} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={DEPT_PALETTE[i % DEPT_PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ======================= 超期预警卡 ======================= */
function OverdueCard({ overdue, navigate }: { overdue: any; navigate: (p: string) => void }) {
  if (!overdue) return null;
  const list: any[] = overdue.list || [];
  const danger = (overdue.count ?? 0) > 0;
  return (
    <Card className={danger ? 'border-l-4 border-l-destructive' : ''}>
      <CardContent>
        <PanelHeader icon={<AlertTriangle size={15} />} title="超期预警" />
        <div className="mb-3 flex items-end gap-2">
          <span className={`text-3xl font-bold tabular-nums ${danger ? 'text-destructive' : 'text-success'}`}>
            {overdue.count ?? 0}
          </span>
          <span className="mb-1 text-xs text-muted-foreground">条隐患已超整改期限</span>
        </div>
        {list.length === 0 ? (
          <div className="text-xs text-muted-foreground">无超期项，继续保持 ✓</div>
        ) : (
          <div className="space-y-1.5">
            {list.map((h: any) => (
              <button key={h.id} className="todo-row w-full" onClick={() => navigate(`/hazards/${h.id}`)}>
                <span className="todo-ic shrink-0" style={tint(C_OVERDUE)}>
                  <AlertTriangle size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    <span className="font-mono">{h.hazardNo}</span> {h.description}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {h.department} · 风险 {h.riskLevel} · 超期 {h.days} 天
                  </span>
                </span>
                <span className="shrink-0 text-xs font-medium text-destructive">查看 →</span>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EffNumber({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

const SCOPE_LABEL: Record<string, string> = {
  all: '全厂数据',
  dept: '本部门数据',
  self: '我相关的数据',
};

export default function Dashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [todos, setTodos] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    setLoadErr(null);
    try {
      // 用 allSettled：即便「待办」接口异常，也不影响主看板数据渲染
      const [ov, td] = await Promise.allSettled([
        api.get('/dashboard/overview'),
        api.get('/dashboard/todos'),
      ]);
      if (ov.status === 'rejected') throw (ov as PromiseRejectedResult).reason;
      setData((ov as PromiseFulfilledResult<any>).value.data);
      if (td.status === 'fulfilled') setTodos((td as PromiseFulfilledResult<any>).value.data);
    } catch (e: any) {
      const status = e?.response?.status;
      setLoadErr(
        status
          ? `后端返回 ${status}${status === 401 ? '（登录会话已失效，请重新登录）' : ''}`
          : e?.code === 'ERR_NETWORK'
            ? '无法连接后端服务（:3000），请确认服务已启动'
            : (e?.message as string) || '未知错误',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) return <Spinner />;
  if (loadErr) {
    return (
      <div className="page-fade space-y-[var(--gap-card)]">
        <PageHeader title="数据看板" description="隐患与作业票的实时分布概览" icon={<Gauge size={20} />} />
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <div className="flex items-center gap-2 font-medium text-destructive">
              <AlertTriangle size={18} />
              <span>数据加载失败</span>
            </div>
            <p className="text-sm text-muted-foreground">{loadErr}</p>
            <Button variant="secondary" onClick={load}>
              <RefreshCw size={16} className="mr-1" /> 重试
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (!data) return (
    <div className="page-fade space-y-[var(--gap-card)]">
      <PageHeader title="数据看板" description="隐患与作业票的实时分布概览" icon={<Gauge size={20} />} />
      <div className="text-muted-foreground">暂无数据</div>
    </div>
  );

  const hz = data.hazards;
  const wp = data.workPermits;
  const overdueCount = data.overdue?.count ?? 0;
  const closedHz = hz.total - hz.open;
  const closedRate = hz.total ? Math.round((closedHz / hz.total) * 100) : 0;
  const acceptedCount = hz.byStatus.find((x) => x.status === 'accepted')?.count || 0;
  const acceptRate = hz.total ? Math.round((acceptedCount / hz.total) * 100) : 0;
  const completedWp = wp.byStatus.find((x) => x.status === 'completed')?.count || 0;
  const wpRate = wp.total ? Math.round((completedWp / wp.total) * 100) : 0;

  const stat = [
    { label: '隐患总数', value: hz.total, color: 'hsl(var(--primary))', icon: <AlertTriangle size={16} />, onClick: () => navigate('/hazards') },
    { label: '待处理隐患', value: hz.open, color: 'hsl(var(--warning))', icon: <Clock size={16} />, onClick: () => navigate('/hazards?status=pending_assign') },
    { label: '作业票总数', value: wp.total, color: 'hsl(var(--chart-3))', icon: <ClipboardList size={16} />, onClick: () => navigate('/e-permits') },
    { label: '待审批作业票', value: wp.pending, color: 'hsl(var(--destructive))', icon: <Clock size={16} />, onClick: () => navigate('/e-approval') },
    { label: '超期隐患', value: overdueCount, color: C_OVERDUE, icon: <AlertTriangle size={16} />, onClick: () => navigate('/hazards') },
    { label: '部门数', value: data.departmentsCount, color: 'hsl(var(--chart-4))', icon: <Building2 size={16} />, onClick: () => navigate('/departments') },
  ];

  const posture = [
    { label: '隐患闭环率', value: closedRate },
    { label: '验收通过率', value: acceptRate },
    { label: '作业票完成率', value: wpRate },
  ];

  return (
    <div className="page-fade space-y-[var(--gap-card)]">
      <PageHeader
        title="数据看板"
        description={`隐患与作业票实时概览 · ${SCOPE_LABEL[data.scope || 'all']}`}
        icon={<Gauge size={20} />}
        actions={
          <Button variant="secondary" onClick={load}>
            <RefreshCw size={16} className="mr-1" /> 刷新
          </Button>
        }
      />

      <StatStrip>
        {stat.map((s) => (
          <MetricTile key={s.label} label={s.label} value={s.value} color={s.color} icon={s.icon} onClick={s.onClick} />
        ))}
      </StatStrip>

      {/* 今日待我处理 */}
      <TodoSection todos={todos} navigate={navigate} />

      {/* 趋势 + 超期 */}
      <div className="grid grid-cols-1 gap-[var(--gap-card)] lg:grid-cols-2">
        <Card>
          <CardContent>
            <PanelHeader icon={<TrendingUp size={15} />} title="隐患趋势 · 近 12 个月" />
            <HazardTrendChart data={data.hazardTrend || []} />
          </CardContent>
        </Card>

        <OverdueCard overdue={data.overdue} navigate={navigate} />
      </div>

      {/* 作业趋势 + 部门分布 */}
      <div className="grid grid-cols-1 gap-[var(--gap-card)] lg:grid-cols-2">
        <Card>
          <CardContent>
            <PanelHeader icon={<Activity size={15} />} title="作业申请趋势 · 近 12 个月" />
            <WpTrendChart data={data.wpTrend || []} />
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <PanelHeader icon={<Building2 size={15} />} title="隐患 · 按责任部门" />
            <DeptBar data={hz.byDept || []} />
          </CardContent>
        </Card>
      </div>

      {/* 安全态势 + 效能 */}
      <Card>
        <CardContent>
          <PanelHeader icon={<ShieldCheck size={15} />} title="安全态势与闭环效能" />
          <div className="grid gap-6 md:grid-cols-5">
            {posture.map((p) => (
              <div key={p.label}>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{p.label}</span>
                  <span className="font-semibold tabular-nums text-foreground">{p.value}%</span>
                </div>
                <Progress value={p.value} />
              </div>
            ))}
            <EffNumber label="平均整改时长" value={`${data.efficiency?.avgRectifyDays ?? 0} 天`} color="hsl(var(--warning))" />
            <EffNumber label="隐患驳回率" value={`${data.efficiency?.rejectRate ?? 0}%`} color={C_OVERDUE} />
          </div>
        </CardContent>
      </Card>

      {/* 分布明细 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardContent>
            <PanelHeader icon={<Activity size={15} />} title="隐患 · 按状态" />
            <Bars
              data={hz.byStatus.map((x) => ({ key: x.status, count: x.count }))}
              labelOf={(k) => ({ label: HAZARD_STATUS[k]?.label || k, color: HAZARD_STATUS_COLOR[k] })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <PanelHeader icon={<AlertTriangle size={15} />} title="隐患 · 按风险" />
            <Bars
              data={hz.byRisk.map((x) => ({ key: x.riskLevel, count: x.count }))}
              labelOf={(k) => ({ label: RISK_LEVELS[k]?.label || k, color: RISK_COLOR[k] })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <PanelHeader icon={<ClipboardList size={15} />} title="作业票 · 按状态" />
            <Bars
              data={wp.byStatus.map((x) => ({ key: x.status, count: x.count }))}
              labelOf={(k) => ({ label: WORK_PERMIT_STATUS[k]?.label || k, color: WP_STATUS_COLOR[k] })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <PanelHeader icon={<ClipboardList size={15} />} title="作业票 · 按类型" />
            <Bars
              data={wp.byType.map((x) => ({ key: x.type, count: x.count }))}
              labelOf={(k) => ({
                label: WORK_PERMIT_TYPES[k]?.label || k,
                color: WORK_PERMIT_TYPES[k]?.isHazardous ? 'hsl(var(--destructive))' : 'hsl(var(--primary))',
              })}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
