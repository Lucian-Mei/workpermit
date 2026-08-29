// 消息中心：作业票 + 隐患任务聚合 + 一键已读/恢复未读
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, ShieldCheck, Flame, ClipboardList, PenLine, CheckCircle2, RotateCcw, Inbox, Wrench, ClipboardCheck, BadgeCheck } from 'lucide-react';
import api from '@/api/client';
import { Popover } from './Popover';

type Counts = {
  approval: number;
  inspection: number;
  briefing: number;
  signature: number;
  hazard_rectify: number;
  hazard_review: number;
  hazard_accept: number;
  total: number;
};

const READ_KEY = (uid: string) => `ehs_notif_read_${uid}`;
const HIDDEN_KEY = (uid: string) => `ehs_notif_hidden_${uid}`;

export default function NotificationBell() {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false); // 是否一键已读

  const uid = (() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || 'null');
      return u?.id || u?.userId || 'anon';
    } catch { return 'anon'; }
  })();

  const loadCounts = useCallback(async () => {
    try {
      const { data } = await api.get('/e-permits/notifications');
      setCounts(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadCounts();
    try {
      setHidden(localStorage.getItem(HIDDEN_KEY(uid)) === '1');
    } catch { /* ignore */ }
  }, [loadCounts, uid]);

  // 每 30s 轮询一次（避免依赖 SSE/WS）
  useEffect(() => {
    const t = setInterval(loadCounts, 30000);
    return () => clearInterval(t);
  }, [loadCounts]);

  const visibleTotal = hidden ? 0 : (counts?.total ?? 0);

  function markAllRead() {
    try { localStorage.setItem(HIDDEN_KEY(uid), '1'); } catch {}
    setHidden(true);
  }
  function restoreUnread() {
    try { localStorage.removeItem(HIDDEN_KEY(uid)); } catch {}
    setHidden(false);
  }

  const items: Array<{ key: keyof Omit<Counts, 'total'>; label: string; icon: any; color: string; target: string }> = [
    // 作业票任务
    { key: 'approval', label: '审批任务', icon: ShieldCheck, color: '#f59e0b', target: '/e-approval' },
    // 检查/交底/签字都是「现场作业执行」类任务 → 统一进电子现场台列表，由现场台按作业逐一处理
    { key: 'inspection', label: '检查任务', icon: Flame, color: '#ea580c', target: '/e-onsite' },
    { key: 'briefing', label: '交底任务', icon: ClipboardList, color: '#0ea5e9', target: '/e-onsite' },
    { key: 'signature', label: '签字任务', icon: PenLine, color: '#7c3aed', target: '/e-onsite' },
    // 隐患任务
    { key: 'hazard_rectify', label: '隐患整改', icon: Wrench, color: '#10b981', target: '/hazards?status=assigned&scope=assigned' },
    { key: 'hazard_review', label: '隐患审核', icon: ClipboardCheck, color: '#6366f1', target: '/hazards/department' },
    { key: 'hazard_accept', label: '隐患验收', icon: BadgeCheck, color: '#0891b2', target: '/hazards/acceptance' },
  ];

  return (
    <Popover
      align="right"
      width="min(calc(100vw - 2rem), 20rem)"
      open={open}
      onOpenChange={setOpen}
      trigger={({ toggle, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={toggle}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
          aria-label="通知"
          title="通知中心"
        >
          <Bell size={17} />
          {visibleTotal > 0 && (
            <span
              className="absolute -right-1 -top-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center ring-2 ring-background"
              aria-label={`${visibleTotal} 项待办`}
            >
              {visibleTotal > 99 ? '99+' : visibleTotal}
            </span>
          )}
        </button>
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-1 pb-2.5">
        <div className="flex items-center gap-2">
          <Bell size={16} className="text-primary" />
          <span className="text-sm font-semibold">消息中心</span>
          {counts && (
            <span className="text-xs text-muted-foreground">
              ({visibleTotal > 0 ? `${visibleTotal} 项` : '无消息'})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {hidden ? (
            <button
              type="button"
              onClick={restoreUnread}
              className="text-[11px] px-2 py-1 rounded border border-border text-muted-foreground hover:bg-muted"
              title="恢复未读"
            >
              <RotateCcw size={11} className="inline -mt-0.5 mr-0.5" />恢复未读
            </button>
          ) : (
            <button
              type="button"
              onClick={markAllRead}
              disabled={(counts?.total ?? 0) === 0}
              className="text-[11px] px-2 py-1 rounded border border-border text-primary hover:bg-primary/5 disabled:opacity-50 disabled:cursor-not-allowed"
              title="一键已读"
            >
              <CheckCircle2 size={11} className="inline -mt-0.5 mr-0.5" />一键已读
            </button>
          )}
        </div>
      </div>

      <div className="max-h-80 overflow-y-auto py-1">
        {!counts ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">加载中…</div>
        ) : counts.total === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-muted-foreground">
            <Inbox size={28} className="mx-auto mb-2 opacity-50" />
            暂无消息
          </div>
        ) : (
          items.map((it) => {
            const Icon = it.icon;
            const n = counts[it.key];
            return (
              <button
                key={it.key}
                type="button"
                onClick={() => { setOpen(false); navigate(it.target); }}
                className="w-full flex items-center gap-3 px-1 py-2.5 text-left hover:bg-muted/40 transition-colors"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                  style={{ background: `${it.color}1a`, color: it.color }}
                >
                  <Icon size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{it.label}</div>
                  <div className="text-[11px] text-muted-foreground">前往处理 →</div>
                </div>
                <span
                  className="min-w-[24px] h-6 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center"
                  style={{ background: it.color, color: '#fff' }}
                >
                  {n > 99 ? '99+' : n}
                </span>
              </button>
            );
          })
        )}
      </div>

      {counts && counts.total > 0 && (
        <div className="border-t border-border px-1 pt-2 text-[11px] text-muted-foreground">
          合计 <span className="font-semibold text-foreground">{counts.total}</span> 项待办
        </div>
      )}
    </Popover>
  );
}