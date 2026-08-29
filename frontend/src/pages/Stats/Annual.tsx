import React, { useCallback, useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import api from '@/api/client';
import { Card, CardContent, Button, Select, PageHeader } from '@/components/ui';
import { MetricTile, StatStrip, Section } from '@/components/kit';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import { BarChart3, Download, FileSpreadsheet, ClipboardCheck, Ban, Pause } from 'lucide-react';

const PALETTE = ['#0ea5e9', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#ec4899', '#64748b'];

export default function AnnualStats() {
  const navigate = useNavigate();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/e-applications/stats/annual', { params: { year } });
      setData(data);
    } finally {
      setLoading(false);
    }
  }, [year]);
  useEffect(() => { load(); }, [load]);

  function exportExcel() {
    if (!data) return;
    const wb = XLSX.utils.book_new();
    const overview = [
      ['统计年度', data.year],
      ['作业申请单总数', data.totalApplications],
      ['危险作业票总数', data.totalPermits],
      ['巡检记录总数', data.totalInspections],
      ['作废次数', data.voided],
      ['暂停次数', data.paused],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(overview), '总览');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      data.byMonth.map((m: any) => ({ 月份: `${m.month}月`, 作业数: m.count })),
    ), '按月份');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      data.byType.map((t: any) => ({ 作业类型: t.type, 数量: t.count })),
    ), '按作业类型');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      data.byDept.map((t: any) => ({ 部门: t.dept, 作业数: t.count })),
    ), '按部门');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      data.byContractor.map((t: any) => ({ 承包商监护人: t.contractor, 作业数: t.count })),
    ), '按承包商');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      data.inspByMonth.map((m: any) => ({ 月份: `${m.month}月`, 巡检次数: m.count })),
    ), '巡检按月份');
    XLSX.writeFile(wb, `作业票年度统计_${data.year}.xlsx`);
  }

  const years = Array.from({ length: 5 }, (_, i) => thisYear - i);

  return (
    <div className="page-fade space-y-[var(--gap-card)]">
      <PageHeader
        title="作业票年度统计"
        description="按类型、月份、部门、承包商多维统计作业票与巡检记录，支持导出 Excel。"
        icon={<BarChart3 size={20} />}
        actions={
          <>
            <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-auto">
              {years.map((y) => <option key={y} value={y}>{y} 年</option>)}
            </Select>
            <Button onClick={exportExcel} disabled={!data}>
              <FileSpreadsheet size={16} className="mr-1" /> 导出 Excel
            </Button>
          </>
        }
      />

      {loading || !data ? (
        <div className="py-10 text-center text-sm text-muted-foreground">加载中…</div>
      ) : (
        <>
          <StatStrip>
            <MetricTile label="作业申请单" value={data.totalApplications} color="#0ea5e9" icon={<BarChart3 size={18} />} onClick={() => navigate('/e-applications')} />
            <MetricTile label="危险作业票" value={data.totalPermits} color="#f59e0b" onClick={() => navigate('/e-permits')} />
            <MetricTile label="巡检记录" value={data.totalInspections} color="#22c55e" icon={<ClipboardCheck size={18} />} onClick={() => navigate('/e-onsite/inspections')} />
            <MetricTile label="作废 / 暂停" value={`${data.voided} / ${data.paused}`} color="#ef4444" icon={<Ban size={18} />} onClick={() => navigate('/e-permits?status=voided,paused')} />
          </StatStrip>

          <div className="grid grid-cols-1 gap-[var(--gap-card)] lg:grid-cols-2">
            <Section title="每月作业数量" icon={<BarChart3 size={16} />}>
              <Card><CardContent>
                <ChartBar data={data.byMonth.map((m: any) => ({ name: `${m.month}月`, value: m.count }))} color="#0ea5e9" />
              </CardContent></Card>
            </Section>

            <Section title="每月巡检次数" icon={<ClipboardCheck size={16} />}>
              <Card><CardContent>
                <ChartBar data={data.inspByMonth.map((m: any) => ({ name: `${m.month}月`, value: m.count }))} color="#22c55e" />
              </CardContent></Card>
            </Section>

            <Section title="按危险作业类型" icon={<BarChart3 size={16} />}>
              <Card><CardContent>
                {data.byType.length === 0 ? <Empty /> :
                  <ChartBar data={data.byType.map((t: any) => ({ name: t.type, value: t.count }))} multicolor />}
              </CardContent></Card>
            </Section>

            <Section title="按部门" icon={<BarChart3 size={16} />}>
              <Card><CardContent>
                {data.byDept.length === 0 ? <Empty /> :
                  <ChartBar data={data.byDept.slice(0, 8).map((t: any) => ({ name: t.dept, value: t.count }))} color="#8b5cf6" />}
              </CardContent></Card>
            </Section>
          </div>

          <Section title="承包商 / 监护人作业量 Top 10" icon={<BarChart3 size={16} />}>
            <Card><CardContent>
              {data.byContractor.length === 0 ? <Empty /> : (
                <div className="divide-y divide-border">
                  {data.byContractor.slice(0, 10).map((c: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 py-2 text-sm">
                      <span className="w-5 text-muted-foreground">{i + 1}</span>
                      <span className="flex-1">{c.contractor}</span>
                      <span className="font-semibold tabular-nums">{c.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent></Card>
          </Section>
        </>
      )}
    </div>
  );
}

function ChartBar({ data, color = '#0ea5e9', multicolor = false }: { data: any[]; color?: string; multicolor?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} interval={0} angle={data.length > 8 ? -30 : 0} textAnchor={data.length > 8 ? 'end' : 'middle'} height={data.length > 8 ? 50 : 30} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
        <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} fill={color}>
          {multicolor && data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Empty() {
  return <div className="py-10 text-center text-xs text-muted-foreground">该年度暂无数据</div>;
}
