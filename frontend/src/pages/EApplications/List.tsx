import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api, { hasPerm } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { Button, PageHeader, Select, EmptyState, IconBox, SectionHeading } from '@/components/ui';
import { DataTable, FilterBar, SearchInput, StatusPill, Avatar, Tag } from '@/components/kit';
import { WORK_PERMIT_APPLICATION_STATUS } from '@/constants';
import { Smartphone, Trash2, Inbox, FilePlus2, Wrench, Flame, Mountain, Box, Truck, Shovel, Plug, Disc, AlertTriangle } from 'lucide-react';
import EApplicationApply from './Apply';
import dayjs from 'dayjs';

type TemplateKey = 'normal' | 'hazard' | 'contractor';
const TEMPLATES: { key: TemplateKey; label: string; desc: string }[] = [
  { key: 'normal', label: '常规作业', desc: '常规作业，无需危险作业票' },
  { key: 'hazard', label: '危险作业', desc: '动火/高处/受限空间等，需附危险作业票' },
  { key: 'contractor', label: '承包商作业培训', desc: '重点完成移动端安全培训手写签字' },
];
const FLOW = ['作业票申请', '安全培训(手写签)', '危险作业票', '提交送审'];

// 危险作业类型卡片（与统一入口 Apply.tsx 颜色/图标一致）
const SPECIAL_CARDS = [
  { key: 'hot_work', label: '动火作业', desc: '焊接、切割等明火', color: 'coral', Icon: Flame },
  { key: 'high_altitude', label: '高处作业', desc: '离地 2m 以上', color: 'sky', Icon: Mountain },
  { key: 'confined_space', label: '受限空间', desc: '封闭/部分封闭', color: 'purple', Icon: Box },
  { key: 'lifting', label: '起重吊装', desc: '使用起重设备', color: 'amber', Icon: Truck },
  { key: 'excavation', label: '动土作业', desc: '开挖、挖掘作业', color: 'teal', Icon: Shovel },
  { key: 'temporary_electricity', label: '临时用电', desc: '临时接电、配电箱', color: 'pink', Icon: Plug },
  { key: 'blind', label: '盲板抽堵', desc: '管道盲板抽堵', color: 'indigo', Icon: Disc },
  { key: 'other', label: '其他危险作业', desc: '不属于上述 7 类', color: 'red', Icon: AlertTriangle },
];
const COLOR_MAP: Record<string, { border: string; bg: string; text: string }> = {
  coral: { border: '#F0997B', bg: '#FAECE7', text: '#712B13' },
  blue:  { border: '#85B7EB', bg: '#E6F1FB', text: '#0C447C' },
  sky:   { border: '#74B8DA', bg: '#E5F2F9', text: '#0E5B83' },
  purple:{ border: '#AFA9EC', bg: '#EEEDFE', text: '#3C3489' },
  amber: { border: '#EF9F27', bg: '#FAEEDA', text: '#633806' },
  teal:  { border: '#5DCAA5', bg: '#E1F5EE', text: '#085041' },
  indigo:{ border: '#8E89D6', bg: '#E9E9F8', text: '#2E2A78' },
  pink:  { border: '#ED93B1', bg: '#FBEAF0', text: '#72243E' },
  red:   { border: '#F09595', bg: '#FCEBEB', text: '#791F1F' },
};
const BLUE = { border: '#85B7EB', bg: '#E6F1FB', text: '#0C447C', strong: '#185FA5' };

// 电子化作业申请单（channel=electronic），移动端优先。与纸质「作业申请单」完全隔离。
export default function EApplicationList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // 内嵌申请表单：URL query 驱动（?type=special&special=hot_work / ?type=routine / ?id=xxx）
  const formActive = Boolean(
    searchParams.get('type') || searchParams.get('tpl') || searchParams.get('routine') || searchParams.get('id'),
  );
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('draft'); // 默认显示「草稿」状态的申请单
  const [mine, setMine] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '15',
        ...(q ? { keyword: q } : {}),
        ...(status ? { status } : {}),
        ...(mine ? { mine: '1' } : {}),
      });
      const { data } = await api.get(`/e-applications?${params.toString()}`);
      setRows(data.items || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [page, status, mine]);

  function goTemplate(tpl: TemplateKey) {
    navigate(`/e-applications?tpl=${tpl}`);
  }

  async function remove(id: string) {
    if (!confirm('确定删除该草稿作业票申请？')) return;
    try {
      await api.delete(`/e-applications/${id}`);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.message || '删除失败');
    }
  }

  // 内嵌申请表单：URL 带 type/tpl/routine/id 时直接渲染申请页（不再跳独立 /e-applications/apply）
  if (formActive) {
    return <EApplicationApply />;
  }

  return (
    <div className="page-fade space-y-[var(--gap-card)]">
      <PageHeader
        title="作业票申请"
        description="全程线上、移动端优先：作业票申请 + 培训手写签字 + 危险作业票，无纸化管控入口"
        icon={<Smartphone size={20} />}
        actions={
          <Button variant="ghost" onClick={() => { setMine(!mine); setPage(1); load(); }}>
            {mine ? '查看全部' : '只看我的'}
          </Button>
        }
      />

      <section className="card relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <div className="relative">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <IconBox icon={<FilePlus2 size={18} />} tone="primary" size="md" variant="solid" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">无纸化 · 作业票申请</span>
            </div>
            <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">手机上完成一张作业票</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              选择作业类型后进入专属申请页。常规作业：填写作业内容与 JSA → 提交后自动生成作业码与培训二维码。
              危险作业：必须挂靠已批准的常规作业票，并按法规逐项落实安全措施。
            </p>
          </div>

          {/* 类型选择：常规作业票（GWP） */}
          <div className="mt-4 rounded-xl border border-border p-3.5">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-sm font-medium" style={{ color: BLUE.strong }}>常规作业票（GWP）</span>
              <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: BLUE.bg, color: BLUE.strong }}>入厂总许可</span>
            </div>
            <p className="mb-2.5 max-w-2xl text-xs text-muted-foreground">承包商入厂作业的总许可。申请时填写预计作业人数，批准后下发培训二维码与 6 位作业码。</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button
                type="button"
                onClick={() => navigate('/e-applications?type=routine')}
                className="group flex flex-col items-start gap-1.5 rounded-lg border p-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-md"
                style={{ borderColor: BLUE.border, background: BLUE.bg }}
              >
                <div className="flex items-center gap-1.5">
                  <Wrench size={15} style={{ color: BLUE.text }} />
                  <span className="text-sm font-medium" style={{ color: BLUE.text }}>常规作业</span>
                </div>
                <div className="text-[11px] text-muted-foreground">一般性检维修/安装</div>
              </button>
            </div>
          </div>

          {/* 类型选择：危险作业票 */}
          <div className="mt-3 rounded-xl border border-border p-3.5">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-sm font-medium" style={{ color: '#854F0B' }}>危险作业票</span>
              <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: '#FAEEDA', color: '#854F0B' }}>需关联常规票</span>
            </div>
            <p className="mb-2.5 max-w-2xl text-xs text-muted-foreground">常规作业中的高风险环节，必须挂靠在一张已批准且未完成的常规作业票之下。</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SPECIAL_CARDS.map((s) => {
                const c = COLOR_MAP[s.color];
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => navigate(`/e-applications?type=special&special=${s.key}`)}
                    className="group flex flex-col items-start gap-1.5 rounded-lg border p-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-md"
                    style={{ borderColor: c.border, background: c.bg }}
                  >
                    <div className="flex items-center gap-1.5">
                      <s.Icon size={15} style={{ color: c.text }} />
                      <span className="text-sm font-medium" style={{ color: c.text }}>{s.label}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{s.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <SectionHeading>作业票申请列表</SectionHeading>

      <FilterBar>
        <SearchInput value={q} onChange={setQ} onSearch={load} placeholder="搜索作业名称 / 编号" />
        <Select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
          <option value="">全部状态</option>
          {Object.entries(WORK_PERMIT_APPLICATION_STATUS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </Select>
        <Button variant="secondary" onClick={() => { setPage(1); load(); }}>刷新</Button>
      </FilterBar>

      <DataTable
        loading={loading}
        rows={rows}
        rowKey={(w) => w.id}
        rowClassName={(w) => (w.involvesHazardous ? 'row-hazard' : undefined)}
        onRowClick={(w) => navigate(`/e-applications/${w.id}`)}
        columns={[
          { key: 'permitNo', header: '编号', render: (w) => <span className="text-xs">{w.permitNo}</span> },
          { key: 'jobName', header: '作业名称', render: (w) => <span className="font-medium text-xs">{w.jobName || '—'}</span> },
          {
            key: 'applicantName',
            header: '申请人',
            hideOn: 'sm',
            render: (w) => (
              <span className="flex items-center gap-2 text-xs">
                <Avatar name={w.applicantName} size={26} />
                <span>{w.applicantName}</span>
              </span>
            ),
          },
          { key: 'department', header: '部门', hideOn: 'md', render: (w) => <span className="text-xs">{w.department || '—'}</span> },
          {
            key: 'hazard',
            header: '危险作业',
            hideOn: 'sm',
            render: (w) =>
              w.involvesHazardous ? <Tag color="#ea580c">含危险作业</Tag> : <span className="text-xs text-muted-foreground">普通作业</span>,
          },
          {
            key: 'status',
            header: '状态',
            render: (w) => (
              <StatusPill color={WORK_PERMIT_APPLICATION_STATUS[w.status]?.color}>
                {WORK_PERMIT_APPLICATION_STATUS[w.status]?.label || w.status}
              </StatusPill>
            ),
          },
          {
            key: 'createdAt',
            header: '时间',
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
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/e-applications/${w.id}`); }}>查看</Button>
                {(w.status === 'draft') && (w.applicantId === user?.id || hasPerm(user, 'epermit:create')) && (
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/e-applications?id=${w.id}`); }}>编辑</Button>
                )}
                {w.status === 'draft' && (w.applicantId === user?.id || hasPerm(user, 'epermit:create')) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); remove(w.id); }}
                  >
                    <Trash2 size={14} className="mr-1" /> 删除
                  </Button>
                )}
              </div>
            ),
          },
        ]}
        empty={<EmptyState icon={<Inbox size={26} />} title="暂无作业票申请" hint="使用上方「快捷模板」或「开始填写作业票申请」开始办理" />}
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
