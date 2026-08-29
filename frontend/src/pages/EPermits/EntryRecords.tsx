import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/client';
import { Button, PageHeader, Input, Select, Card, CardContent, EmptyState } from '@/components/ui';
import { DataTable, StatStrip, MetricTile, SearchInput, FilterBar, StatusPill, Tag } from '@/components/kit';
import { ArrowLeft, Users, UserCheck, UserX, ClipboardList, LogIn, X, Loader2, Inbox, ShieldAlert, QrCode, ExternalLink } from 'lucide-react';
import dayjs from 'dayjs';
import { QRCodeCanvas } from 'qrcode.react';

interface EntryRecord {
  id: string;
  applicationId: string | null;
  workPermitId: string | null;
  contractorUnit: string;
  workerName: string;
  workerIdCard: string | null;
  workerPhone: string | null;
  trainingPassed: boolean;
  gate: string | null;
  registeredAt: string;
  signOutAt: string | null;
  workCode: string | null;
  permitNo: string | null;
  jobName: string | null;
  permitType?: string | null;
  isHazardous?: boolean | null;
}

const PAGE_SIZE = 20;

export default function EntryRecords() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<EntryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ total: 0, inPlant: 0, todayIn: 0, todayOut: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'in' | 'out'>('all');
  const [signOutId, setSignOutId] = useState<string | null>(null);

  const [showRegister, setShowRegister] = useState(false);
  const [regForm, setRegForm] = useState({ workCode: '', name: '', idCard: '' });
  const [regLoading, setRegLoading] = useState(false);
  const [regResult, setRegResult] = useState<any>(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (q) params.set('q', q);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const { data } = await api.get(`/e-permits/entry-records?${params}`);
      setRows(data.items || []);
      setTotal(data.total || 0);
      if (data.stats) setStats(data.stats);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q, statusFilter]);

  // 表格一键离厂签出（按记录 ID，无需重填信息）
  async function signOut(r: EntryRecord) {
    if (!confirm(`确认 ${r.workerName} 离厂签出？`)) return;
    setSignOutId(r.id);
    try {
      await api.post(`/e-permits/entry-records/${r.id}/sign-out`);
      load();
    } catch (e: any) {
      alert(e.response?.data?.message || e.response?.data?.reason || '签出失败');
    } finally {
      setSignOutId(null);
    }
  }

  async function doRegister(action: 'in' | 'out') {
    if (!regForm.workCode || !regForm.name || !regForm.idCard) {
      setRegResult({ ok: false, reason: '请填写完整信息' });
      return;
    }
    setRegLoading(true);
    setRegResult(null);
    try {
      const { data } = await api.post('/public/entry-by-code', { ...regForm, action, gate: '管理后台' });
      setRegResult(data);
      if (data.ok) {
        load();
        setTimeout(() => {
          setShowRegister(false);
          setRegForm({ workCode: '', name: '', idCard: '' });
          setRegResult(null);
        }, 1800);
      }
    } catch (e: any) {
      setRegResult({ ok: false, reason: e.response?.data?.reason || e.response?.data?.message || '网络错误' });
    } finally {
      setRegLoading(false);
    }
  }

  return (
    <div className="page-fade space-y-[var(--gap-card)]">
      <PageHeader
        title="作业人员登记入厂记录"
        description="承包商作业人员凭作业代码 + 身份证扫码进出厂；培训未通过或作业票超期将被拦截"
        icon={<Users size={20} />}
        actions={
          <>
            <Button variant="primary" onClick={() => setShowRegister(true)}>
              <LogIn size={16} className="mr-1" /> 入场登记
            </Button>
            <Button variant="ghost" onClick={() => navigate(-1)}>
              <ArrowLeft size={16} className="mr-1" /> 返回
            </Button>
          </>
        }
      />

      <StatStrip>
        <MetricTile label="累计登记" value={stats.total} icon={<ClipboardList size={18} />} />
        <MetricTile label="当前在厂" value={stats.inPlant} color="#16a34a" icon={<UserCheck size={18} />} />
        <MetricTile label="今日入场" value={stats.todayIn} color="#2563eb" icon={<LogIn size={18} />} />
        <MetricTile label="今日离厂" value={stats.todayOut} color="#64748b" icon={<UserX size={18} />} />
      </StatStrip>

      <Card>
        <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <QrCode size={16} className="text-emerald-600" />
              门卫扫码签到入口
            </div>
            <p className="text-xs text-muted-foreground max-w-md">
              保安用微信或浏览器扫描下方二维码，即可在手机端打开签到/签出页面；也可扫描作业票二维码自动填入 6 位作业代码。
            </p>
            <a
              href={`${window.location.origin}/entry`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
            >
              直接打开签到页 <ExternalLink size={11} />
            </a>
          </div>
          <div className="flex flex-col items-center gap-1 rounded-lg border border-border bg-white p-2">
            <QRCodeCanvas value={`${window.location.origin}/entry`} size={120} level="M" />
            <span className="text-[10px] text-muted-foreground">扫码打开 /entry</span>
          </div>
        </CardContent>
      </Card>

      <FilterBar>
        <SearchInput
          value={q}
          onChange={(v) => { setPage(1); setQ(v); }}
          placeholder="搜索姓名 / 单位 / 作业代码…"
        />
        <Select value={statusFilter} onChange={(e) => { setPage(1); setStatusFilter(e.target.value as any); }}>
          <option value="all">全部状态</option>
          <option value="in">在厂中</option>
          <option value="out">已离厂</option>
        </Select>
        <Button variant="secondary" onClick={() => { setPage(1); load(); }}>刷新</Button>
      </FilterBar>

      <DataTable
        loading={loading}
        rows={rows}
        rowKey={(r) => r.id}
        rowClassName={(r) => (r.isHazardous ? 'row-hazard' : undefined)}
        onRowClick={(r) => r.workPermitId && navigate(`/e-permits/view/${r.workPermitId}`)}
        columns={[
          {
            key: 'workerName',
            header: '作业人员',
            render: (r) => (
              <div>
                <div className="font-medium">{r.workerName}</div>
                <div className="text-[11px] text-muted-foreground font-mono">{r.workerIdCard || '—'}</div>
              </div>
            ),
          },
          { key: 'contractorUnit', header: '所属单位', hideOn: 'sm', render: (r) => r.contractorUnit || '—' },
          {
            key: 'workCode',
            header: '作业代码',
            render: (r) =>
              r.workCode ? <span className="text-orange-500 font-semibold">{r.workCode}</span> : '—',
          },
          {
            key: 'permitNo',
            header: '作业票',
            hideOn: 'md',
            render: (r) => (
              <div className="flex items-center gap-1.5">
                <span className="text-xs">{r.permitNo || '—'}</span>
                {r.isHazardous && <Tag color="#f97316">危险</Tag>}
              </div>
            ),
          },
          {
            key: 'jobName',
            header: '作业内容',
            hideOn: 'md',
            render: (r) => <span className="block max-w-[180px] truncate text-sm">{r.jobName || '—'}</span>,
          },
          {
            key: 'registeredAt',
            header: '入场时间',
            render: (r) => <span className="text-xs">{dayjs(r.registeredAt).format('MM-DD HH:mm')}</span>,
          },
          {
            key: 'signOutAt',
            header: '离场时间',
            render: (r) =>
              r.signOutAt ? (
                <span className="text-xs">{dayjs(r.signOutAt).format('MM-DD HH:mm')}</span>
              ) : (
                <StatusPill color="#16a34a">在厂中</StatusPill>
              ),
          },
          {
            key: 'trainingPassed',
            header: '培训',
            align: 'right',
            render: (r) =>
              r.trainingPassed ? (
                <StatusPill color="#16a34a">已通过</StatusPill>
              ) : (
                <StatusPill color="#f59e0b">未通过</StatusPill>
              ),
          },
          {
            key: 'ops',
            header: '操作',
            align: 'right',
            render: (r) =>
              r.signOutAt ? (
                <span className="text-xs text-muted-foreground">已离厂</span>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={signOutId === r.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    signOut(r);
                  }}
                >
                  {signOutId === r.id ? <Loader2 size={14} className="animate-spin" /> : '离厂签出'}
                </Button>
              ),
          },
        ]}
        empty={
          <EmptyState
            icon={<Inbox size={26} />}
            title="暂无入场记录"
            hint="作业票批准后生成作业代码，工人在门卫处扫码登记即可产生记录"
          />
        }
      />

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {total} 条</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={page * PAGE_SIZE >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      </div>

      {/* 入场登记弹窗 */}
      {showRegister && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowRegister(false)}
        >
          <div className="w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <Card>
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <LogIn size={18} /> 入场登记
                  </h3>
                  <button
                    onClick={() => setShowRegister(false)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X size={18} />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">输入作业人员的作业代码、姓名和身份证号</p>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground">作业代码（6位数字）</label>
                    <Input
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="例：451744"
                      className="font-mono text-lg text-center tracking-widest mt-1"
                      value={regForm.workCode}
                      onChange={(e) => setRegForm({ ...regForm, workCode: e.target.value.replace(/\D/g, '') })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">姓名</label>
                    <Input
                      placeholder="本人真实姓名"
                      className="mt-1"
                      value={regForm.name}
                      onChange={(e) => setRegForm({ ...regForm, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">身份证号</label>
                    <Input
                      placeholder="18位身份证号"
                      className="mt-1"
                      value={regForm.idCard}
                      onChange={(e) => setRegForm({ ...regForm, idCard: e.target.value })}
                    />
                  </div>
                </div>
                {regResult && (
                  <div
                    className={`rounded p-2.5 text-xs space-y-1 ${
                      regResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                    }`}
                  >
                    <div className="font-medium">
                      {regResult.ok ? `✅ ${regResult.message || '操作成功'}` : `❌ ${regResult.reason}`}
                    </div>
                    {regResult.permit && (
                      <div className="opacity-80">
                        {regResult.permit.permitNo} · {regResult.permit.jobName}
                        {regResult.permit.isHazardous ? ' · ⚠危险作业' : ''}
                      </div>
                    )}
                    {regResult.needTraining && (
                      <div className="flex items-center gap-1 pt-1">
                        <ShieldAlert size={13} />
                        <a href={regResult.trainingUrl} target="_blank" rel="noreferrer" className="underline">
                          前往安全培训考试
                        </a>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => doRegister('in')}
                    disabled={regLoading}
                  >
                    {regLoading ? <Loader2 className="animate-spin mr-1" size={16} /> : null}入厂签到
                  </Button>
                  <Button variant="secondary" className="flex-1" onClick={() => doRegister('out')} disabled={regLoading}>
                    离厂签出
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
