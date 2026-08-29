import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { hasPerm } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, Button, Textarea, PageHeader } from '@/components/ui';
import { StatusPill, Section, Tag } from '@/components/kit';
import {
  WORK_PERMIT_APPLICATION_STATUS,
  WORK_PERMIT_TYPES,
  HAZARD_PERMIT_TYPES,
} from '@/constants';
import { FileText, GraduationCap, ClipboardList, ShieldCheck, Printer, ArrowLeft, AlertTriangle, Plus, PenLine, Activity } from 'lucide-react';
import TrainingEditor from '@/components/TrainingEditor';
import dayjs from 'dayjs';

export default function EApplicationDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  async function load() {
    const { data } = await api.get(`/e-applications/${id}`);
    setD(data);
  }
  useEffect(() => {
    load();
  }, [id]);

  if (!d) return <div className="text-muted-foreground p-6">加载中…</div>;

  const st = WORK_PERMIT_APPLICATION_STATUS[d.status] || { label: d.status, color: '#94a3b8' };
  const canEdit = d.status === 'draft' && (d.applicantId === user?.id || hasPerm(user, 'epermit:create'));
  const canDelete = d.status === 'draft' && (d.applicantId === user?.id || hasPerm(user, 'epermit:create'));

  // 业务规则：作业票申请先审批通过，危险作业票在申请单批准后再申请。
  // 因此申请单能否通过只与申请单自身状态有关，不与危险作业票审批状态挂钩。
  // 危险作业票待办提示：未开具 / 已开具但未完成审批，均给出明确提醒（仅提示，不阻断审批）。
  const hazardTickets = (d.workPermits || []).filter((w: any) => w.isHazardous);
  const pendingHazard = hazardTickets.filter((w: any) => w.status !== 'approved' && w.status !== 'completed');
  const hazardNotice = d.involvesHazardous
    ? hazardTickets.length === 0
      ? '本单含危险作业，请在申请单批准后及时开具对应危险作业票。'
      : pendingHazard.length > 0
        ? `危险作业票待办：以下危险作业票尚未完成审批（${pendingHazard.map((w: any) => w.permitNo).join('、')}）。`
        : ''
    : '';

  async function removeApp() {
    if (!confirm('确定删除该草稿申请单？')) return;
    try {
      await api.delete(`/e-applications/${id}`);
      navigate('/e-applications');
    } catch (e: any) {
      alert(e?.response?.data?.message || '删除失败');
    }
  }

  async function addHazard(type: string) {
    setErr('');
    // P0 统一入口：跳转到统一申请页创建新危险作业票申请
    navigate(`/e-applications?type=special&special=${type}`);
  }

  const training = d.training;

  return (
    <div className={`page-fade space-y-[var(--gap-card)] ${d.involvesHazardous ? 'permit-hazard-highlight' : ''}`}>
      <PageHeader
        title="作业票申请详情"
        description={<><span>{d.permitNo}</span> · {d.jobName || '未命名作业'}{d.involvesHazardous ? ' · ⚠含危险作业' : ''}</>}
        icon={<FileText size={20} />}
        actions={
          <>
            {canEdit && (
              <Button variant="secondary" onClick={() => navigate(`/e-applications?id=${id}`)}>
                编辑
              </Button>
            )}
            {canDelete && (
              <Button variant="destructive" onClick={removeApp}>
                删除
              </Button>
            )}
            <Button variant="ghost" onClick={() => navigate('/e-applications')}>
              <ArrowLeft size={16} className="mr-1" /> 返回
            </Button>
          </>
        }
      />

      {err && <div className="text-sm text-destructive bg-destructive/10 rounded p-2">{err}</div>}
      {msg && <div className="text-sm text-success bg-success/10 rounded p-2">{msg}</div>}
      {hazardNotice && (
        <div className="flex items-center gap-2 text-xs text-info bg-info/10 rounded p-2">
          <AlertTriangle size={15} /> {hazardNotice}
        </div>
      )}

      {d.missingHazardPermits?.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">危险作业票未开</div>
            <div className="mt-0.5 text-xs">
              以下危险作业尚未开具对应《危险作业许可证》：{d.missingHazardPermits.map((m: any) => m.label).join('、')}。请尽快在「危险作业票」菜单办理。
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[var(--gap-card)]">
        {/* ===== 左列：基础信息 + 内容 + JSA + 培训 + 检查记录 ===== */}
        <div className="lg:col-span-2 space-y-[var(--gap-card)]">
          <Section title="基本信息" icon={<FileText size={16} />}>
            <Card>
              <CardContent className="divide-y divide-border">
                <Row label="状态" value={<StatusPill color={st.color}>{st.label}</StatusPill>} />
                <Row label="作业名称" value={d.jobName || '—'} />
                <Row label="申请人" value={d.applicantName} />
                <Row label="部门" value={d.department || '—'} />
                <Row label="区域/地点" value={[d.area, d.location].filter(Boolean).join(' / ') || '—'} />
                <Row label="计划时间" value={(d.planStart ? dayjs(d.planStart).format('MM-DD HH:mm') : '?') + ' ~ ' + (d.planEnd ? dayjs(d.planEnd).format('MM-DD HH:mm') : '?')} />
                <Row label="作业人" value={(d.operatorNames || []).join('、') || '—'} />
                <Row label="监护人" value={`${d.supervisorName || '—'}${d.supervisorContact ? '（' + d.supervisorContact + '）' : ''}`} />
                <Row label="危险作业" value={d.involvesHazardous ? <Tag color="#ea580c">含危险作业</Tag> : '普通作业'} />
                <Row label="承包商单位" value={d.contractorUnit || '—'} />
                <Row label="承包商负责人" value={`${d.contractorHead || '—'}${d.contractorPhone ? '（' + d.contractorPhone + '）' : ''}`} />
                <Row label="管理部门" value={d.managementDept || '—'} />
                <Row label="管理人员" value={d.managementPerson || '—'} />
              </CardContent>
            </Card>
          </Section>

          <Section title="作业内容" icon={<ClipboardList size={16} />}>
            <Card>
              <CardContent>
                <div className="whitespace-pre-wrap text-sm">{d.content || '—'}</div>
              </CardContent>
            </Card>
          </Section>

          {/* JSA 分析内容：汇总关联危险作业票的 JSA；常规作业若未关联则提示 */}
          <Section title="JSA 分析内容" icon={<Activity size={16} />}>
            <Card>
              <CardContent className="space-y-3">
                {(d.workPermits || []).length === 0 && (
                  <div className="text-sm text-muted-foreground">本单未关联危险作业票；常规作业请在「作业内容」中描述步骤与风险。</div>
                )}
                {(d.workPermits || []).map((w: any) => {
                  const t = WORK_PERMIT_TYPES[w.type] || WORK_PERMIT_TYPES.other;
                  const jsas = Array.isArray(w.jsas) ? w.jsas : [];
                  return (
                    <div key={w.id} className={`rounded-lg border p-3 ${w.isHazardous ? 'border-orange-300/60 bg-orange-50/30' : 'border-border'}`}>
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">{t.label} <span className="text-xs text-muted-foreground">{w.permitNo}</span></div>
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/e-permits/view/${w.id}`)}>查看</Button>
                      </div>
                      {jsas.length === 0 ? (
                        <div className="mt-2 text-xs text-muted-foreground">尚未填写 JSA</div>
                      ) : (
                        <ol className="mt-2 space-y-2 list-decimal pl-4 text-sm">
                          {jsas.map((j: any, idx: number) => (
                            <li key={idx}>
                              <div className="font-medium">{j.step || `步骤 ${idx + 1}`}</div>
                              <div className="text-xs text-muted-foreground">危险因素：{j.hazard || '—'}</div>
                              <div className="text-xs text-success">管控措施：{j.control || '—'}</div>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </Section>

          {/* 安全交底内容 */}
          <Section title="交底内容" icon={<ClipboardList size={16} />}>
            <Card>
              <CardContent className="space-y-3">
                {!d.briefing || d.briefing.status !== 'done' ? (
                  <div className="text-sm text-muted-foreground">现场交底尚未完成。审批通过后，由作业负责人在现场组织交底并逐条确认。</div>
                ) : (
                  <>
                    {d.briefing.briefer && <div className="text-sm">交底人：{d.briefing.briefer}</div>}
                    {Array.isArray(d.briefing.points) && d.briefing.points.length > 0 && (
                      <div className="space-y-2">
                        {d.briefing.points.map((g: any, gi: number) => (
                          <div key={gi} className="rounded border border-border p-2">
                            <div className="text-xs font-medium text-muted-foreground">{g.title}</div>
                            <ul className="mt-1 space-y-1">
                              {(g.items || []).map((it: any, ii: number) => (
                                <li key={ii} className="flex items-start gap-1.5 text-sm">
                                  <span className={it.checked ? 'text-success' : 'text-muted-foreground'}>{it.checked ? '✓' : '·'}</span>
                                  <span className={it.checked ? '' : 'text-muted-foreground'}>{it.text}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                    {d.briefing.content && <div className="whitespace-pre-wrap text-sm">{d.briefing.content}</div>}
                  </>
                )}
              </CardContent>
            </Card>
          </Section>

          {/* 承包商培训（电子化手写签字） */}
          <TrainingEditor appId={id!} training={training} editable={canEdit} reload={load} />

        </div>

        {/* ===== 右列：审批进度 + 审批详情 + 关联作业票 ===== */}
        <div className="space-y-[var(--gap-card)]">
          {/* 提交后转作业票：审批在「常规/危险作业管理」中进行 */}
          <Section title="提交后转作业票" icon={<ShieldCheck size={16} />}>
            <Card>
              <CardContent className="space-y-2 text-sm">
                <p className="text-xs text-muted-foreground">
                  申请单提交后自动转为作业票，进入「常规作业管理」或「危险作业管理」进行审批。
                  此处仅保留草稿编辑。
                </p>
                {(d.workPermits || []).map((w: any) => (
                  <div key={w.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{w.permitNo}</div>
                      <div className="text-xs text-muted-foreground">
                        {WORK_PERMIT_APPLICATION_STATUS[w.status]?.label || w.status}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => navigate(`/e-permits/view/${w.id}`)}>前往作业票</Button>
                  </div>
                ))}
                {(d.workPermits || []).length === 0 && (
                  <div className="text-xs text-muted-foreground">尚未提交，提交后此处显示对应作业票。</div>
                )}
              </CardContent>
            </Card>
          </Section>

          {d.status === 'rejected' && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">申请单已被驳回，可编辑后重新提交。</div>
          )}

          {/* 关联危险作业票 */}
          <Section title="关联作业票" icon={<AlertTriangle size={16} />}>
            <Card>
              <CardContent className="space-y-2">
                {(d.status === 'approved' || d.status === 'completed') && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => setAddOpen((v) => !v)}>
                      <Plus size={14} className="mr-1" /> 添加危险作业票
                    </Button>
                    {addOpen && <span className="text-xs text-muted-foreground">选择危险作业类型：</span>}
                    {addOpen &&
                      HAZARD_PERMIT_TYPES.map((k) => {
                        const t = WORK_PERMIT_TYPES[k] || WORK_PERMIT_TYPES.other;
                        return (
                          <Button key={k} variant="secondary" size="sm" onClick={() => addHazard(k)}>
                            {t.label}
                          </Button>
                        );
                      })}
                  </div>
                )}
                {d.involvesHazardous &&
                  (d.status === 'approved' || d.status === 'completed') &&
                  (d.workPermits || []).some((w: any) => w.status === 'draft') && (
                    <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-accent px-3 py-2 text-xs text-primary">
                      <AlertTriangle size={15} /> 作业申请单已批准，请提交关联的危险作业票（点击右侧「继续填写」）。
                    </div>
                  )}
                {d.involvesHazardous &&
                  (d.status === 'pending_review' || d.status === 'reviewing') && (
                    <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                      <AlertTriangle size={15} /> 作业申请单审批中，审批通过后方可提交关联的危险作业票。
                    </div>
                  )}
                {(d.workPermits || []).length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    {d.involvesHazardous ? '尚未添加危险作业票。' : '本单为普通作业，无危险作业票。'}
                  </div>
                )}
                {(d.workPermits || []).map((w: any) => {
                  const t = WORK_PERMIT_TYPES[w.type] || WORK_PERMIT_TYPES.other;
                  return (
                    <div key={w.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">
                          {t.label}
                          {t.isHazardous && <Tag color="#ea580c" className="ml-1">特种</Tag>}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <StatusPill color={WORK_PERMIT_APPLICATION_STATUS[w.status]?.color}>
                            {WORK_PERMIT_APPLICATION_STATUS[w.status]?.label || w.status}
                          </StatusPill>
                          <span>{w.permitNo}</span>
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          navigate(w.status === 'draft' ? `/e-applications?id=${w.applicationId || w.id}` : `/e-permits/view/${w.id}`)
                        }
                      >
                        {w.status === 'draft' ? '继续填写' : '查看'}
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </Section>

          {(d.status === 'printed' || d.status === 'finished' || d.status === 'completed' || d.status === 'paused') && (
            <Section title="作业过程检查记录" icon={<ClipboardList size={16} />}>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2.5">
      <div className="w-24 shrink-0 text-sm text-muted-foreground">{label}</div>
      <div className="flex-1 text-sm">{value}</div>
    </div>
  );
}

function StepLine({
  title,
  done,
  who,
  when,
  opinion,
  rejected,
}: {
  title: string;
  done: boolean;
  who?: string;
  when?: string;
  opinion?: string;
  rejected?: boolean;
}) {
  return (
    <div className="flex gap-2.5">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
          rejected ? 'bg-destructive text-destructive-foreground' : done ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground'
        }`}
      >
        {rejected ? '✕' : done ? '✓' : '·'}
      </span>
      <div className="flex-1">
        <div className="text-sm font-medium">{title}</div>
        {(who || when) && (
          <div className="text-xs text-muted-foreground">
            {who || '—'}
            {when ? ` · ${dayjs(when).format('MM-DD HH:mm')}` : ''}
          </div>
        )}
        {opinion && <div className="mt-0.5 text-xs text-foreground">意见：{opinion}</div>}
      </div>
    </div>
  );
}
