import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/client';
import { PageHeader, Card, CardContent, EmptyState, Button } from '@/components/ui';
import { ClipboardCheck, RefreshCw } from 'lucide-react';
import dayjs from 'dayjs';

/** 电子现场台 · 巡检记录（全量列表） */
export default function EOnsiteInspections() {
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [inspector, setInspector] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/e-onsite/inspections', { params: { inspector: inspector || undefined, from: from || undefined, to: to || undefined, limit: 200 } });
      setItems(data.items || []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="page-fade mx-auto max-w-5xl space-y-4">
      <PageHeader
        title="巡检记录"
        description="现场检查的完整记录（按时间倒序）"
        icon={<ClipboardCheck size={20} />}
        actions={
          <Button variant="secondary" onClick={load} disabled={loading}><RefreshCw size={14} className="mr-1" /> 刷新</Button>
        }
      />
      <Card>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs" style={{ color: 'var(--muted-foreground)' }}>检查人</label>
              <input value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="如 王刚" className="w-full rounded border px-2 py-1 text-sm" style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }} />
            </div>
            <div>
              <label className="mb-1 block text-xs" style={{ color: 'var(--muted-foreground)' }}>开始日期</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full rounded border px-2 py-1 text-sm" style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }} />
            </div>
            <div>
              <label className="mb-1 block text-xs" style={{ color: 'var(--muted-foreground)' }}>结束日期</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded border px-2 py-1 text-sm" style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }} />
            </div>
            <div className="flex items-end"><Button onClick={load} disabled={loading}>查询</Button></div>
          </div>
        </CardContent>
      </Card>
      {loading ? (
        <div className="text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>加载中…</div>
      ) : items.length === 0 ? (
        <EmptyState icon={<ClipboardCheck size={26} />} title="暂无巡检记录" hint="提交申请时现场检查会自动产生记录。" />
      ) : (
        <Card>
          <CardContent className="space-y-2">
            {items.map((it) => {
              const detailTo = it.workPermitId ? `/e-permits/view/${it.workPermitId}` : null;
              return (
                <div
                  key={it.id}
                  onClick={() => detailTo && navigate(detailTo)}
                  className={`rounded-lg border p-3 transition-colors ${detailTo ? 'cursor-pointer hover:bg-white/5' : ''}`}
                  style={{ borderColor: 'var(--border)' }}
                  title={detailTo ? '点击查看对应作业票详情' : ''}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <ClipboardCheck
                        size={14}
                        style={{ color: it.result === 'abnormal' ? 'var(--destructive)' : 'var(--success)' }}
                      />
                      <span className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                        {it.permitNo || '—'}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                        · {it.inspector}
                      </span>
                      {it.department && (
                        <span className="hidden truncate text-xs sm:inline" style={{ color: 'var(--muted-foreground)' }}>
                          · {it.department}
                        </span>
                      )}
                    </div>
                    <span
                      className="shrink-0 text-xs"
                      style={{ color: it.result === 'abnormal' ? 'var(--destructive)' : 'var(--success)' }}
                    >
                      {it.result === 'abnormal' ? '异常' : '正常'}
                    </span>
                  </div>
                  {it.jobName && (
                    <div className="mt-1 truncate text-xs" style={{ color: 'var(--foreground)' }}>
                      {it.jobName}
                    </div>
                  )}
                  {(it.area || it.location) && (
                    <div className="mt-0.5 truncate text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      {[it.area, it.location].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {it.contractorUnit && (
                    <div className="mt-0.5 truncate text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      承包商：{it.contractorUnit}
                    </div>
                  )}
                  <div
                    className="mt-1.5 flex items-center justify-between text-xs"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    <span>{dayjs(it.inspectedAt).format('YYYY-MM-DD HH:mm')}</span>
                    {detailTo && (
                      <span className="font-medium" style={{ color: 'var(--primary)' }}>
                        查看详情 →
                      </span>
                    )}
                  </div>
                  {it.note && (
                    <div className="mt-1 truncate text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      备注：{it.note}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
