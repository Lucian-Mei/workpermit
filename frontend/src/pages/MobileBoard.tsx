import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import api from '@/api/client';
import { WORK_PERMIT_STATUS } from '@/constants';
import { RefreshCw, MapPin, Clock, Users, CalendarDays, AlertTriangle, PauseCircle, CheckCircle2, ChevronRight } from 'lucide-react';
import dayjs from 'dayjs';

// ============================================================
// 手机端·今日作业看板（仅移动端展示）
// - 数据源与桌面大屏看板一致：/api/e-applications/board/today?date=
// - 桌面（≥768px）访问本页自动重定向到大屏看板 /e-board（满足"只有手机端才能看"）
// - 入口：移动端底部导航「看板」→ /m-board
// ============================================================

const REFRESH_MS = 60_000; // 自动刷新间隔

interface BoardItem {
  id: string;
  kind: 'routine' | 'hazard';
  permitNo: string;
  jobName: string;
  content: string;
  location: string;
  department: string;
  applicantName: string;
  operatorNames: string[];
  contractorUnit: string;
  hazardTypeLabel?: string;
  involvesHazardous?: boolean;
  status: string;
  planStart?: string;
  planEnd?: string;
  pausedByName?: string;
  pauseReason?: string;
  hazards: BoardItem[];
}

/** 仅移动端守卫：桌面访问跳大屏看板 */
function useDesktopRedirect() {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => dayjs());
  useEffect(() => {
    const t = setInterval(() => setNow(dayjs()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export default function MobileBoard() {
  const navigate = useNavigate();
  const isDesktop = useDesktopRedirect();
  const now = useNow(1000);

  const [date, setDate] = useState(() => dayjs().format('YYYY-MM-DD'));
  const [data, setData] = useState<{ total: number; running: number; paused: number; items: BoardItem[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | 'running' | 'paused' | 'finished'>('all');
  const [pulling, setPulling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const { data: d } = await api.get('/e-applications/board/today', { params: { date } });
      setData(d);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  // 自动刷新
  useEffect(() => {
    timerRef.current = setInterval(load, REFRESH_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load]);

  const items = useMemo(() => {
    const all = data?.items || [];
    if (tab === 'running') return all.filter((i) => i.status === 'printed');
    if (tab === 'paused') return all.filter((i) => i.status === 'paused');
    if (tab === 'finished') return all.filter((i) => i.status === 'finished');
    return all;
  }, [data, tab]);

  const sorted = useMemo(
    () => [...items].sort((a, b) => (b.planStart ? new Date(b.planStart).getTime() : 0) - (a.planStart ? new Date(a.planStart).getTime() : 0)),
    [items],
  );

  // 桌面 → 大屏看板（所有 Hooks 均在其上方，遵守 Rules of Hooks）
  if (isDesktop) return <Navigate to="/e-board" replace />;

  const isToday = date === dayjs().format('YYYY-MM-DD');
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][dayjs(date).day()];

  const TABS = [
    { key: 'all' as const, label: '全部', count: data?.total ?? 0 },
    { key: 'running' as const, label: '作业中', count: data?.running ?? 0 },
    { key: 'paused' as const, label: '已暂停', count: data?.paused ?? 0 },
  ];

  function prevDay() {
    setDate(dayjs(date).subtract(1, 'day').format('YYYY-MM-DD'));
  }
  function nextDay() {
    setDate(dayjs(date).add(1, 'day').format('YYYY-MM-DD'));
  }
  function today() {
    setDate(dayjs().format('YYYY-MM-DD'));
  }

  async function manualRefresh() {
    setPulling(true);
    try {
      await load();
    } finally {
      setTimeout(() => setPulling(false), 400);
    }
  }

  function statusMeta(status: string) {
    return WORK_PERMIT_STATUS[status] || { label: status, color: '#94a3b8' };
  }

  return (
    <div className="page-fade min-h-screen bg-muted/30 pb-24">
      {/* 顶部标题 + 日期 */}
      <header className="sticky top-0 z-10 border-b border-border bg-[hsl(var(--background))] px-4 pt-3 pb-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold">今日作业看板</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isToday ? '今天' : dayjs(date).format('MM月DD日')} · 周{weekday} · {now.format('HH:mm')}
              {!isToday && (
                <button className="ml-2 font-medium text-primary" onClick={today}>回今天</button>
              )}
            </p>
          </div>
          <button
            onClick={manualRefresh}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground active:scale-95"
            aria-label="刷新"
          >
            <RefreshCw size={16} className={pulling ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* 日期切换 */}
        <div className="mt-2 flex items-center gap-2">
          <button onClick={prevDay} className="flex h-8 items-center rounded-lg border border-border bg-card px-2 text-sm text-muted-foreground active:scale-95">前一天</button>
          <button onClick={today} className="h-8 flex-1 rounded-lg border border-primary/30 bg-primary/5 text-sm font-medium text-primary">今日（{now.format('MM-DD')}）</button>
          <button onClick={nextDay} className="flex h-8 items-center rounded-lg border border-border bg-card px-2 text-sm text-muted-foreground active:scale-95">后一天</button>
        </div>
      </header>

      {/* 状态筛选：统计 + 分组合一（一排三格，点击筛选列表） */}
      <div className="px-4 pt-3">
        <div className="grid grid-cols-3 gap-2">
          {TABS.map((t) => {
            const active = tab === t.key;
            const color = t.key === 'running' ? 'text-primary' : t.key === 'paused' ? 'text-warning' : 'text-foreground';
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-xl border p-3 text-center transition-colors ${
                  active ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-[hsl(var(--card))]'
                }`}
              >
                <div className={`text-xl font-bold ${color}`}>{t.count}</div>
                <div className={`mt-0.5 text-[11px] ${active ? 'font-medium text-primary' : 'text-muted-foreground'}`}>{t.label}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 卡片列表 */}
      <div className="space-y-2.5 px-4 pt-3">
        {loading && sorted.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">加载中…</div>
        ) : sorted.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-[hsl(var(--card))] py-12 text-center text-sm text-muted-foreground">
            {tab === 'all' ? '当天暂无作业安排' : '该状态下暂无作业'}
          </div>
        ) : (
          sorted.map((it) => {
            const st = statusMeta(it.status);
            const hasHazards = it.hazards && it.hazards.length > 0;
            return (
              <button
                key={it.id}
                onClick={() => navigate(`/e-permits/view/${it.id}`)}
                className="w-full rounded-xl border border-border bg-[hsl(var(--card))] p-3 text-left shadow-sm active:scale-[0.99]"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">{it.permitNo}</span>
                  {hasHazards && (
                    <span className="flex items-center gap-0.5 rounded-md bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-600">
                      <AlertTriangle size={10} /> 含危险作业
                    </span>
                  )}
                  <span
                    className="ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                    style={{ color: st.color, border: `1px solid ${st.color}55`, background: `${st.color}14` }}
                  >
                    {st.label}
                  </span>
                </div>

                <div className="mt-1.5 flex items-start gap-1.5">
                  <span className="line-clamp-1 flex-1 text-[15px] font-semibold">{it.jobName || '未命名作业'}</span>
                </div>

                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <MapPin size={13} className="shrink-0" />
                    <span className="line-clamp-1">{it.location || '—'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Users size={13} className="shrink-0" />
                    <span className="line-clamp-1">
                      {Array.isArray(it.operatorNames) && it.operatorNames.length ? it.operatorNames.join('、') : it.applicantName || '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock size={13} className="shrink-0" />
                    <span>
                      {it.planStart ? dayjs(it.planStart).format('MM-DD HH:mm') : '—'}
                      {it.planEnd ? ` ~ ${dayjs(it.planEnd).format('HH:mm')}` : ''}
                    </span>
                    {!isToday && (
                      <span className="ml-auto flex items-center gap-0.5 text-primary">
                        <CalendarDays size={12} /> {dayjs(it.planStart || date).format('MM-DD')}
                      </span>
                    )}
                  </div>
                  {it.status === 'paused' && it.pauseReason && (
                    <div className="flex items-center gap-1.5 text-warning">
                      <PauseCircle size={13} className="shrink-0" />
                      <span className="line-clamp-1">{it.pauseReason}</span>
                    </div>
                  )}
                  {it.status === 'finished' && (
                    <div className="flex items-center gap-1.5 text-success">
                      <CheckCircle2 size={13} className="shrink-0" /> 作业已完工
                    </div>
                  )}
                </div>

                {hasHazards && (
                  <div className="mt-2 flex flex-wrap gap-1.5 border-t border-dashed pt-2" style={{ borderColor: 'var(--color-border-tertiary, rgba(0,0,0,0.08))' }}>
                    {it.hazards.map((h) => {
                      const hs = statusMeta(h.status);
                      return (
                        <span key={h.id} className="rounded-md bg-orange-50 px-1.5 py-0.5 text-[10px] text-orange-700">
                          {h.hazardTypeLabel || '危险作业'} · {hs.label}
                        </span>
                      );
                    })}
                  </div>
                )}

                <div className="mt-2 flex items-center justify-end text-[11px] text-primary">
                  查看详情 <ChevronRight size={13} />
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
