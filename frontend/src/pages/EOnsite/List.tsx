import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/client';
import { Button, Card, CardContent, PageHeader } from '@/components/ui';
import { StatStrip, MetricTile } from '@/components/kit';
import { WORK_PERMIT_STATUS } from '@/constants';
import {
  Smartphone, ChevronRight, Search, ShieldCheck, ClipboardCheck, PenLine, CheckCircle2, Pause, Eye, FileText,
} from 'lucide-react';
import dayjs from 'dayjs';

type TaskKey = 'briefing' | 'inspection' | 'sign' | 'finish' | 'paused';

const TASK_META: Record<TaskKey, { label: string; color: string; icon: any }> = {
  briefing: { label: '待交底', color: '#22c55e', icon: ShieldCheck },
  inspection: { label: '待现场检查', color: '#0ea5e9', icon: ClipboardCheck },
  sign: { label: '待签字', color: '#a855f7', icon: PenLine },
  finish: { label: '待完工/归档', color: '#14b8a6', icon: CheckCircle2 },
  paused: { label: '已暂停', color: '#f97316', icon: Pause },
};
const TASK_KEYS: TaskKey[] = ['briefing', 'inspection', 'sign', 'finish', 'paused'];

// 电子现场作业入口（作业票粒度）：仅展示「当前需要执行的任务」——
// 交底未完成只显示交底；交底完成显示现场检查；检查完成显示签字/完工；暂停独立成卡。
// 任务卡带「作业详情」入口，详情页可查看关联作业并互相进入现场检查。
export default function EOnsiteList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [kw, setKw] = useState('');
  const [task, setTask] = useState<TaskKey | 'all'>('all');

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/e-permits', { params: { channel: 'electronic', pageSize: 500 } });
      setItems(data.items || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // 常规票交底状态映射（危险票的“可执行前提” = 其常规票已交底）
  const briefingMap = useMemo(() => {
    const m = new Map<string, boolean>();
    items.forEach((w) => { if (!w.isHazardous) m.set(w.id, !!w.briefingDone); });
    return m;
  }, [items]);

  // 任务判定：仅返回「当前需要执行」的任务；无任务返回 null
  function taskOf(w: any): TaskKey | null {
    const s = w.status;
    if (s === 'paused') return 'paused';
    if (s === 'finished') return 'finish';
    if (!['approved', 'printed', 'paused', 'finished'].includes(s)) return null;
    // 常规票：未交底 → 交底任务
    if (!w.isHazardous) {
      if (!w.briefingDone) return 'briefing';
    } else {
      // 危险票：常规票未交底 → 无任务（等待常规交底）
      const rtBriefed = w.linkedRoutineId ? briefingMap.get(w.linkedRoutineId) : true;
      if (!rtBriefed) return null;
    }
    // 交底已完成：未检查 → 现场检查
    if (!w.checksCount) return 'inspection';
    // 未签字 → 签字
    if (!w.signDone) return 'sign';
    // 交底+检查+签字均完成 → 待完工
    if (s === 'printed') return 'finish';
    return null;
  }

  const taskCount = (k: TaskKey | 'all') => {
    const base = items.filter((w) => taskOf(w) !== null);
    if (k === 'all') return base.length;
    return base.filter((w) => taskOf(w) === k).length;
  };

  const filtered = items.filter((w) => {
    const t = taskOf(w);
    if (!t) return false;
    if (task !== 'all' && t !== task) return false;
    if (kw) {
      const text = `${w.permitNo || ''} ${w.content || ''} ${w.department || ''} ${w.location || ''} ${w.linkedRoutineNo || ''}`.toLowerCase();
      if (!text.includes(kw.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div className="page-fade mx-auto w-full max-w-6xl space-y-4">
      <PageHeader
        title="电子现场台"
        description="按当前需要执行的任务展示：交底 → 现场检查 → 签字 → 完工/归档；任务卡可进入作业详情并跳转关联作业。"
        icon={<Smartphone size={20} />}
        actions={
          <Button variant="secondary" onClick={() => navigate('/e-onsite/inspections')}>
            <ClipboardCheck size={14} className="mr-1" /> 巡检记录
          </Button>
        }
      />

      {/* 任务分类卡片 */}
      <StatStrip cols="3">
        <MetricTile label="全部任务" value={taskCount('all')} color="#64748b" icon={<FileText size={16} />} active={task === 'all'} onClick={() => setTask('all')} />
        {TASK_KEYS.map((k) => {
          const meta = TASK_META[k];
          const Icon = meta.icon;
          return (
            <MetricTile
              key={k}
              label={meta.label}
              value={taskCount(k)}
              color={meta.color}
              icon={<Icon size={16} />}
              active={task === k}
              onClick={() => setTask(k)}
            />
          );
        })}
      </StatStrip>

      <div className="flex items-center gap-2 rounded-[var(--radius)] border border-input bg-card px-3">
        <Search size={16} className="text-muted-foreground" />
        <input
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder="搜索作业名称 / 票号 / 地点"
          className="h-[var(--control-h)] w-full bg-transparent text-sm outline-none"
        />
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">加载中…</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          当前没有需要执行的任务。作业批准后按「交底 → 现场检查 → 签字 → 完工」在此依次出现。
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {filtered.map((w) => {
            const t = taskOf(w)!;
            const meta = TASK_META[t];
            const TIcon = meta.icon;
            const st = WORK_PERMIT_STATUS[w.status] || { label: w.status, color: '#94a3b8' };
            // st 仅保留备用：当前不再在卡片内重复展示（右上/右下按钮已显示）
            void st;
            const tab = t === 'briefing' ? 'briefing' : t === 'inspection' ? 'inspection' : t === 'sign' ? 'sign' : t === 'paused' ? 'control' : 'control';
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
                        {w.linkedRoutineNo && <span>· 关联 <span>{w.linkedRoutineNo}</span></span>}
                        <span>· {w.department || '—'}</span>
                        {w.startTime && <span>· {dayjs(w.startTime).format('MM-DD HH:mm')}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between border-t pt-2.5" style={{ borderColor: 'var(--color-border-tertiary, rgba(0,0,0,0.08))' }}>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {w.materialMissing && <span className="text-destructive">资料缺</span>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/e-permits/view/${w.id}`)}>
                        <Eye size={14} className="mr-1" /> 作业详情
                      </Button>
                      <Button size="sm" onClick={() => navigate(`/e-onsite/${w.id}?permit=${w.id}&tab=${tab}`)}>
                        {meta.label} <ChevronRight size={15} className="ml-0.5" />
                      </Button>
                    </div>
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