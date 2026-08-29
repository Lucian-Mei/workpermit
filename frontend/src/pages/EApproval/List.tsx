import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/client';
import { Button, Card, CardContent, PageHeader } from '@/components/ui';
import { MetricTile, StatStrip } from '@/components/kit';
import { WORK_PERMIT_STATUS } from '@/constants';
import {
  Smartphone, ChevronRight, Search, ShieldCheck, ClipboardCheck, PenLine,
  ListChecks, FileText, Flame, Mountain, Box, Truck, Shovel, Plug, Disc, AlertTriangle,
} from 'lucide-react';
import dayjs from 'dayjs';

type TaskKey = 'pending_review' | 'ehs_reviewing' | 'reviewing';

const TASK_META: Record<TaskKey, { label: string; color: string; icon: any }> = {
  pending_review: { label: '待部门审核', color: '#f59e0b', icon: ShieldCheck },
  ehs_reviewing: { label: '待EHS审批', color: '#0ea5e9', icon: ClipboardCheck },
  reviewing: { label: '待经理批准', color: '#a855f7', icon: PenLine },
};
const TASK_KEYS: TaskKey[] = ['pending_review', 'ehs_reviewing', 'reviewing'];

// 作业类型卡片：颜色与「作业票申请」类型卡片一致（常规绿 / 动火 coral / 高处 sky / 受限 purple / 吊装 amber / 动土 teal / 临电 pink / 盲板 indigo / 其他 red）
const TYPE_CARDS: Array<{ key: string; label: string; color: string; Icon: any }> = [
  { key: '', label: '全部作业', color: '#64748b', Icon: ListChecks },
  { key: 'routine', label: '常规作业', color: '#3B6D11', Icon: FileText },
  { key: 'hot_work', label: '动火作业', color: '#B9572E', Icon: Flame },
  { key: 'high_altitude', label: '高处作业', color: '#0E5B83', Icon: Mountain },
  { key: 'confined_space', label: '受限空间', color: '#4A43A0', Icon: Box },
  { key: 'lifting', label: '起重吊装', color: '#A96F0D', Icon: Truck },
  { key: 'excavation', label: '动土作业', color: '#0E7A5F', Icon: Shovel },
  { key: 'temporary_electricity', label: '临时用电', color: '#B54874', Icon: Plug },
  { key: 'blind', label: '盲板抽堵', color: '#4A44A8', Icon: Disc },
  { key: 'other', label: '其他危险', color: '#A32D2D', Icon: AlertTriangle },
];

// 电子审批台：待办审批列表（移动端单列、桌面端双列）。
// 展示「当前需要我处理」的作业票（审批中三态），顶部按作业类型统计卡片，点击过滤；卡片点击直接进详情审批。
export default function EApprovalList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [kw, setKw] = useState('');
  const [task, setTask] = useState<TaskKey | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState('');

  async function load() {
    setLoading(true);
    try {
      // 审批视角：取全部在审票（前端按当前用户可见的 pending 节点过滤，管理员可见全部）
      const { data } = await api.get('/e-permits', { params: { channel: 'electronic', pageSize: 500, category: 'reviewing' } });
      setItems(data.items || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // 当前节点是否为「我」的待办（无审批链信息的历史票按状态显示）
  const myPending = useMemo(() => {
    const me = JSON.parse(localStorage.getItem('user') || 'null');
    const isSuper = me?.roles?.includes('admin') || me?.permissions?.includes('*');
    return (w: any) => {
      if (isSuper) return true;
      const pending = (w.approvalChain || []).find((n: any) => n.status === 'pending');
      if (!pending) return true; // 无链历史票：按状态展示
      return pending.approverId === me?.id || pending.actualApproverId === me?.id;
    };
  }, [items]);

  function taskOf(w: any): TaskKey | null {
    if (!myPending(w)) return null;
    if (w.status === 'pending_review') return 'pending_review';
    if (w.status === 'ehs_reviewing') return 'ehs_reviewing';
    if (w.status === 'reviewing') return 'reviewing';
    return null;
  }

  // 当前用户待办（按作业类型统计）
  const pendingItems = useMemo(() => items.filter((w) => taskOf(w)), [items]);
  const typeCount = (key: string) => (key === '' ? pendingItems.length : pendingItems.filter((w) => w.type === key).length);

  const filtered = items.filter((w) => {
    const t = taskOf(w);
    if (!t) return false;
    if (task !== 'all' && t !== task) return false;
    if (typeFilter && w.type !== typeFilter) return false;
    if (kw) {
      const text = `${w.permitNo || ''} ${w.content || ''} ${w.department || ''} ${w.location || ''} ${w.linkedRoutineNo || ''}`.toLowerCase();
      if (!text.includes(kw.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div className="page-fade mx-auto w-full max-w-6xl space-y-4">
      <PageHeader
        title="电子审批台"
        description="需要你审批的作业票按部门审核 / EHS 审批 / 经理批准三态展示；顶部按作业类型统计，点击过滤，卡片进入详情完成审批。"
        icon={<Smartphone size={20} />}
      />

      {/* 作业类型统计卡片（颜色与作业票申请一致，风格参考电子现场台；数量为 0 的不展示） */}
      <StatStrip cols="6">
        {TYPE_CARDS.filter((c) => typeCount(c.key) > 0).map((c) => {
          const Icon = c.Icon;
          return (
            <MetricTile
              key={c.key}
              label={c.label}
              value={typeCount(c.key)}
              color={c.color}
              icon={<Icon size={16} />}
              active={typeFilter === c.key}
              onClick={() => setTypeFilter(c.key)}
            />
          );
        })}
      </StatStrip>

      <div className="flex items-center gap-2 rounded-[var(--radius)] border border-input bg-card px-3">
        <Search size={16} className="text-muted-foreground" />
        <input
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder="搜索作业名称 / 票号 / 部门"
          className="h-[var(--control-h)] w-full bg-transparent text-sm outline-none"
        />
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">加载中…</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          当前没有需要你审批的作业票。审批中的票会按「部门审核 → EHS 审批 → 经理批准」在此出现。
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {filtered.map((w) => {
            const t = taskOf(w)!;
            const meta = TASK_META[t];
            const TIcon = meta.icon;
            const st = WORK_PERMIT_STATUS[w.status] || { label: w.status, color: '#94a3b8' };
            return (
              <Card key={w.id} hover className={w.isHazardous ? 'card-hazard' : ''}>
                <CardContent className="py-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                      style={{ background: `${meta.color}1a`, color: meta.color }}
                    >
                      <TIcon size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold">{w.content || '未命名作业'}</span>
                        <span
                          className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
                          style={{ color: meta.color, border: `1px solid ${meta.color}55`, background: `${meta.color}14` }}
                        >
                          {meta.label}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span>{w.permitNo}</span>
                        <span style={{ color: w.isHazardous ? '#ea580c' : '#64748b' }}>
                          {w.isHazardous ? (w.typeLabel || w.type || '危险作业') : '常规作业'}
                        </span>
                        <span>· {w.department || '—'}</span>
                        {w.startTime && <span>· {dayjs(w.startTime).format('MM-DD HH:mm')}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center justify-end border-t pt-2.5" style={{ borderColor: 'var(--color-border-tertiary, rgba(0,0,0,0.08))' }}>
                    <Button size="sm" onClick={() => navigate(`/e-permits/view/${w.id}`)}>
                      去审批 <ChevronRight size={15} className="ml-0.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
