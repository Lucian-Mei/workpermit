import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/client';
import { Button, PageHeader, Select, EmptyState } from '@/components/ui';
import { DataTable, MetricTile, StatStrip, FilterBar, SearchInput, StatusPill, WP_STATUS_ICONS } from '@/components/kit';
import { WORK_PERMIT_STATUS, WORK_PERMIT_TYPES, EPERMIT_CATEGORIES } from '@/constants';
import { ListChecks, ShieldCheck, ClipboardCheck, Hammer, CheckCircle2, Archive, Play, Pause, FileWarning, FileEdit, Inbox } from 'lucide-react';
import dayjs from 'dayjs';

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

export default function MyEPermits() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('all');
  const [loading, setLoading] = useState(false);
  const [catStats, setCatStats] = useState<Record<string, number>>({});

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '15' });
      if (q) params.set('keyword', q);
      if (category && category !== 'all') params.set('category', category);
      else if (status) params.set('status', status);
      const { data } = await api.get(`/e-permits/my?${params.toString()}`);
      setRows(data.items || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    try {
      // 我的电子票：只统计我提交的（scope=mine），审批中不剔除自己（我是申请人）
      const { data } = await api.get('/e-permits/category-stats?scope=mine');
      setCatStats(data || {});
    } catch {}
  }

  useEffect(() => { load(); }, [page, category, status, q]);
  useEffect(() => { loadStats(); }, []);

  function pick(catKey: string) {
    setPage(1);
    setCategory(catKey);
    setStatus('');
  }

  const catCount = (k: string) => catStats[k] ?? 0;

  return (
    <div className="page-fade space-y-[var(--gap-card)]">
      <PageHeader
        title="我的电子票"
        description="我提交与参与的作业票全过程追踪"
        icon={<ClipboardCheck size={20} />}
        actions={
          <Button
            variant={status === 'draft' ? 'primary' : 'secondary'}
            onClick={() => { setPage(1); setCategory('all'); setStatus('draft'); }}
          >
            <FileEdit size={16} className="mr-1" />
            草稿
          </Button>
        }
      />

      <StatStrip cols="9">
        {EPERMIT_CATEGORIES.map((c) => {
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
        <SearchInput value={q} onChange={setQ} onSearch={load} placeholder="搜索作业内容 / 编号" />
        <Select value={status} onChange={(e) => { setPage(1); setCategory('all'); setStatus(e.target.value); }}>
          <option value="">全部状态</option>
          {Object.entries(WORK_PERMIT_STATUS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </Select>
        <Button variant="secondary" onClick={() => { setPage(1); load(); }}>刷新</Button>
      </FilterBar>

      <DataTable
        loading={loading}
        rows={rows}
        rowKey={(w) => w.id}
        rowClassName={(w) => (w.isHazardous ? 'row-hazard' : undefined)}
        onRowClick={(w) => navigate(`/e-permits/view/${w.id}`)}
        columns={[
          { key: 'permitNo', header: '编号', render: (w) => <span className="text-xs">{w.permitNo}</span> },
          {
            key: 'type',
            header: '类型',
            render: (w) => (
              <span className="flex items-center gap-1.5">
                {WORK_PERMIT_TYPES[w.type]?.label || w.type}
                {w.isHazardous && <span className="text-destructive" title="危险作业">⚠</span>}
              </span>
            ),
          },
          { key: 'content', header: '作业内容', render: (w) => <span className="block max-w-[240px] truncate">{w.content}</span> },
          {
            key: 'status',
            header: '状态',
            render: (w) => <StatusPill color={WORK_PERMIT_STATUS[w.status]?.color}>{WORK_PERMIT_STATUS[w.status]?.label || w.status}</StatusPill>,
          },
          {
            key: 'createdAt',
            header: '提交时间',
            align: 'right',
            render: (w) => <span className="text-xs text-muted-foreground">{dayjs(w.createdAt).format('MM-DD HH:mm')}</span>,
          },
          {
            key: 'op',
            header: '操作',
            align: 'right',
            render: (w) => (
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/e-permits/view/${w.id}`); }}>查看</Button>
            ),
          },
        ]}
        empty={<EmptyState icon={<Inbox size={26} />} title="暂无电子票" hint="你提交或参与的电子票会显示在这里" />}
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
