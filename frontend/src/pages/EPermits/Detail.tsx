import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { hasPerm } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, Button, Input, Textarea, PageHeader, Select, Modal } from '@/components/ui';
import { StatusPill, Section } from '@/components/kit';
import ApprovalFlow from '@/components/ApprovalFlow';
import { WORK_PERMIT_STATUS, WORK_PERMIT_TYPES, PERMIT_RISK_LEVELS } from '@/constants';
import { ClipboardList, FileText, ShieldCheck, Camera, ArrowLeft, PenLine, CheckCircle, Archive, Printer, Users, Link2, Smartphone, ClipboardCheck, Play, ImageDown, Calendar, Pause } from 'lucide-react';
import JsaSection from '@/components/JsaSection';
import SignPanel from '@/components/SignPanel';
import PrintView from '@/components/PrintView';
import CertOcrConfirm from '@/components/CertOcrConfirm';
import { QRCodeCanvas } from 'qrcode.react';
import dayjs from 'dayjs';

export default function EPermitDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [d, setD] = useState<any>(null);
  const [showPrint, setShowPrint] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState('');

  async function load() {
    const { data } = await api.get(`/e-permits/${id}`);
    setD(data);
  }
  useEffect(() => { load(); }, [id]);

  if (!d) return <div className="text-muted-foreground p-6">加载中…</div>;

  const operators = (() => {
    const o: any = d.operatorNames;
    if (Array.isArray(o)) return o;
    if (typeof o === 'string') return o.split(/[,，\s、]+/).filter(Boolean);
    return [];
  })();
  const t = WORK_PERMIT_TYPES[d.type] || WORK_PERMIT_TYPES.other;
  // 审批框仅当前审批节点的人员可见（admin 可代签）。判定：审批链第一个 pending 节点的 approverId 匹配当前用户；
  // admin 在无审批链/无当前节点时（历史票）也可见，便于代签
  const isSuper = user?.roles?.includes('admin') || user?.permissions?.includes('*');
  const pendingNode = (d.approvalChain || []).find((n: any) => n.status === 'pending');
  const isNodeApprover = isSuper || (pendingNode && (pendingNode.approverId === user?.id || pendingNode.actualApproverId === user?.id));
  // admin 永远可见（兜底），其他角色需满足：审批链上当前节点 OR 链为空的历史票（保持既有审批入口）
  const showApproval = isSuper || isNodeApprover || !pendingNode;
  const canReview = showApproval && (isSuper || hasPerm(user, 'epermit:review')) && d.status === 'pending_review';
  const canApprove = showApproval && (isSuper || hasPerm(user, 'epermit:approve')) && d.status === 'reviewing';
  const canApproveEhs = showApproval && (isSuper || hasPerm(user, 'epermit:approve_ehs')) && d.status === 'ehs_reviewing';
  const canCheck = hasPerm(user, 'epermit:onsite_check') && (d.status === 'approved' || d.status === 'printed' || d.status === 'paused' || d.status === 'finished');
  const canPrint = hasPerm(user, 'epermit:print') && (d.status === 'approved' || d.status === 'printed' || d.status === 'paused' || d.status === 'finished' || d.status === 'completed' || d.status === 'archived');
  // 与后端 update 越权校验口径一致：管理员 / 具备全量查看权限者 / 申请人本人，避免点了编辑却在保存时 403
  const canEdit = (d.status === 'draft' || d.status === 'rejected') && (isSuper || hasPerm(user, 'epermit:view_all') || d.applicantId === user?.id);
  // 暂停/恢复：与后端一致 —— 管理员 / 申请人本人 / 持有 epermit:pause 权限点的人员
  const canPauseTicket = isSuper || hasPerm(user, 'epermit:pause') || d.applicantId === user?.id;
  // P0-8：常规作业票（非特种）已批准且未完成时，可挂靠开具危险作业票
  const canOpenSpecial = !d.isHazardous && hasPerm(user, 'epermit:create') && ['approved', 'printed', 'paused'].includes(d.status);
  // 作业操作条：任一执行动作（暂停/恢复/完工/归档）可见时展示在页面顶部
  const showExecBar =
    (canPauseTicket && ['printed', 'paused'].includes(d.status)) ||
    (canCheck && ['approved', 'printed', 'paused', 'finished'].includes(d.status));

  async function decision(kind: 'review' | 'approve', approve: boolean, opinion: string) {
    await api.put(`/e-permits/${id}/${kind}`, { approve, opinion });
    load();
  }
  async function approveEhs(approve: boolean, opinion: string) {
    await api.put(`/e-permits/${id}/approve-ehs`, { approve, opinion });
    load();
  }
  async function finish() {
    await api.put(`/e-permits/${id}/finish`);
    load();
  }
  async function resume() {
    await api.put(`/e-permits/${id}/resume`);
    load();
  }
  async function confirmPause() {
    try {
      await api.put(`/e-permits/${id}/pause`, { reason: pauseReason || undefined });
      setPauseOpen(false);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.message || '暂停失败');
    }
  }
  async function archive() {
    await api.put(`/e-permits/${id}/archive`);
    load();
  }

  // 已勾选的线上安全措施（measureSelections）
  const measures: any[] = d.measureSelections || [];
  const checkedMeasures = measures.filter((m) => m.checked);
  const rawMeasures: string[] = d.safetyMeasures || [];

  return (
    <div className={`page-fade space-y-[var(--gap-card)] ${d.isHazardous ? 'permit-hazard-highlight' : ''}`}>
      <PageHeader
        title="作业票详情"
        description={<><span>{d.permitNo}</span> · {t.label}{d.isHazardous ? '（危险作业）' : ''}</>}
        icon={<ClipboardList size={20} />}
        actions={
          <>
            {/* 单表合并：编辑作业票直接跳转作业票申请向导（基于作业票 id） */}
            {canEdit && <Button variant="secondary" onClick={() => navigate(`/e-permits/apply/${id}`)}>编辑</Button>}
            {/* P0-8：常规作业票已批准且未完成时，可直接开具挂靠其下的危险作业票 */}
            {canOpenSpecial && (
              <Button variant="secondary" onClick={() => navigate(`/e-permits/apply?type=special&routine=${id}`)}>
                <Link2 size={16} className="mr-1" /> 开危险作业票
              </Button>
            )}
            {/* 现场快捷入口：未交底的常规票进入交底；交底完成或危险票进入现场检查 */}
            {(d.status === 'approved' || d.status === 'printed' || d.status === 'paused') && (
              <Button variant="secondary" onClick={() => navigate(`/e-onsite/${id}?permit=${id}&tab=${!d.isHazardous && !d.briefing?.briefedAt ? 'briefing' : 'inspection'}`)}>
                <Smartphone size={16} className="mr-1" />
                {!d.isHazardous && !d.briefing?.briefedAt ? '进入现场交底' : '进入现场检查'}
              </Button>
            )}
            {canPrint && (
              <Button variant="secondary" onClick={() => setShowPrint(true)}><Printer size={16} className="mr-1" /> 打印 / 导出PDF</Button>
            )}
            <Button variant="ghost" onClick={() => navigate('/e-permits')}>
              <ArrowLeft size={16} className="mr-1" /> 返回
            </Button>
          </>
        }
      />

      {/* 作业操作条：暂停/恢复/完工/归档等核心执行动作，置于页面顶部显眼位置（移动端优先） */}
      {showExecBar && (
        <section className="card flex flex-wrap items-center gap-3 p-3.5 sm:p-4">
          <div className="flex items-center gap-2">
            <CheckCircle size={17} className="text-primary" />
            <span className="text-sm font-semibold text-foreground">作业操作</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {d.status === 'printed' && canPauseTicket && (
              <Button onClick={() => { setPauseReason(''); setPauseOpen(true); }}>
                <Pause size={16} className="mr-1" /> 暂停作业
              </Button>
            )}
            {d.status === 'paused' && canPauseTicket && (
              <Button onClick={resume}><Play size={16} className="mr-1" /> 恢复作业</Button>
            )}
            {['approved', 'printed', 'paused'].includes(d.status) && canCheck && (
              <Button variant="secondary" onClick={finish}><CheckCircle size={16} className="mr-1" /> 标记作业完成</Button>
            )}
            {d.status === 'finished' && canCheck && (
              <Button variant="secondary" onClick={archive}><Archive size={16} className="mr-1" /> 归档（电子留档）</Button>
            )}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[var(--gap-card)]">
        <div className="lg:col-span-2 space-y-[var(--gap-card)]">
          <Section title="基本信息" icon={<ClipboardList size={16} />}>
            <Card>
              <CardContent className="divide-y divide-border">
                <Row label="类型" value={`${t.label}${d.isHazardous ? '（危险作业）' : ''}`} />
                <Row label="申请人" value={d.applicantName} />
                <Row label="部门" value={d.department || '—'} />
                <Row label="区域/地点" value={[d.area, d.location].filter(Boolean).join(' / ') || '—'} />
                <Row label="作业时间" value={(d.startTime ? dayjs(d.startTime).format('MM-DD HH:mm') : '?') + ' ~ ' + (d.endTime ? dayjs(d.endTime).format('MM-DD HH:mm') : '?')} />
                <Row label="作业人" value={operators.join('、') || (Array.isArray(d.application?.operatorNames) ? d.application.operatorNames.join('、') : '—')} />
                <Row label="监护人" value={d.supervisorName || d.application?.managementPerson || '—'} />
                {/* 承包商：与申请单字段保持一致（单位/负责人/电话合并为一行） */}
                <Row
                  label="承包商"
                  value={
                    [d.contractorUnit || d.application?.contractorUnit, d.contractorHead || d.application?.contractorHead, d.contractorPhone || d.application?.contractorPhone]
                      .filter(Boolean)
                      .join(' · ') || '—'
                  }
                />
                {/* P0-8：特殊票展示挂靠的常规作业票；常规票展示预计作业人数（P0-9） */}
                {d.isHazardous ? (
                  <Row
                    label="关联常规票"
                    value={d.linkedRoutineNo
                      ? <button type="button" className="text-primary hover:underline"
                          onClick={() => d.linkedRoutineId && navigate(`/e-permits/view/${d.linkedRoutineId}`)}>{d.linkedRoutineNo}</button>
                      : '—'}
                  />
                ) : (
                  <Row label="预计作业人数" value={d.expectedOperatorCount != null ? `${d.expectedOperatorCount} 人` : '—'} />
                )}
              </CardContent>
            </Card>
          </Section>

          <Section title="作业内容" icon={<FileText size={16} />}>
            <Card>
              <CardContent>
                <div className="whitespace-pre-wrap text-sm">{d.content}</div>
              </CardContent>
            </Card>
          </Section>

          {d.photos?.length > 0 && (
            <Section title="现场照片" icon={<Camera size={16} />}>
              <Card>
                <CardContent>
                  <div className="flex gap-2 flex-wrap">
                    {d.photos.map((p: string, i: number) => (
                      <img key={i} src={p} className="w-28 h-28 object-cover rounded-lg border border-border" alt="" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            </Section>
          )}

          {/* 线上安全措施（按勾选确认） */}
          {(checkedMeasures.length > 0 || rawMeasures.length > 0) && (
            <Section title="安全措施（线上勾选确认）" icon={<ShieldCheck size={16} />}>
              <Card>
                <CardContent>
                  {checkedMeasures.length > 0 ? (
                    <ul className="list-disc pl-5 text-sm space-y-1">
                      {checkedMeasures.map((m: any, i: number) => (
                        <li key={i}>
                          {m.content}
                          {m.note ? <span className="text-muted-foreground">（{m.note}）</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="list-disc pl-5 text-sm space-y-1">
                      {rawMeasures.map((m: string, i: number) => <li key={i}>{m}</li>)}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </Section>
          )}

          {/* JSA 独立小节（可在草稿态编辑） */}
          <JsaSection
            items={d.jsas || []}
            editable={d.status === 'draft'}
            onSave={async (items) => { await api.put(`/e-permits/${id}`, { jsas: items }); load(); }}
          />

          {(canReview || canApprove || canApproveEhs) && (
            <Section title="审批流程" icon={<ShieldCheck size={16} />}>
              {canReview && <DecisionPanel title="审核（安全员）" onDecide={(a, o) => decision('review', a, o)} />}
              {canApproveEhs && <DecisionPanel title="EHS工程师批准" onDecide={(a, o) => approveEhs(a, o)} />}
              {canApprove && <DecisionPanel title="批准（工程部经理）" onDecide={(a, o) => decision('approve', a, o)} />}
            </Section>
          )}

          {/* 作业人员登记入厂记录 */}
          <EntryLogSection wpId={id!} workCode={d.workCode} status={d.status} permitNo={d.permitNo} trainingQrToken={d.trainingQrToken} trainingQrExpiresAt={d.trainingQrExpiresAt} />

          {/* 现场控制：作业完工/暂停/归档按钮已移至右列「作业执行」Section，
              与审批动作并列。CheckPanel（现场检查签字）属于现场作业台 GWP，详情页不再展示。 */}
        </div>

        <div className="space-y-[var(--gap-card)]">
          <ApprovalFlow channel="permit" isHazardous={d.isHazardous} status={d.status} data={d} />
          {/* 审批链（按风险等级自动分配审批人层级）：与左侧内容区同步展示，方便右侧快速查看谁签 */}
          {d.approvalChain && (
            <Section title="审批链（风险分级）" icon={<ShieldCheck size={16} />}>
              <Card>
                <CardContent>
                  <ApprovalChainView chain={d.approvalChain} isHazardous={d.isHazardous} />
                </CardContent>
              </Card>
            </Section>
          )}

          {/* 作业执行操作已上移至页面顶部「作业操作」条（暂停/恢复/完工/归档） */}

          {/* 证书 OCR：仅危险作业展示 */}
          {d.isHazardous && (
            <Section title="特种作业证（OCR）" icon={<Camera size={16} />}>
              <Card>
                <CardContent>
                  {d.certificates?.length === 0 && <div className="text-xs text-muted-foreground">无</div>}
                  {d.certificates?.map((c: any) => (
                    <div key={c.id} className="border rounded p-2 mb-2 text-xs">
                      <img src={c.filePath} className="w-full h-32 object-contain bg-muted mb-1" alt="" />
                      <div>发证机关：{c.issuer || '未知'}</div>
                      <div>识别：{c.needManual ? <span className="text-warning">⚠ 人工确认</span> : <span className="text-success">已完成</span>}</div>
                      {!c.needManual && c.ocrFields && Object.keys(c.ocrFields).length > 0 && (
                        <div className="text-foreground mt-1">字段：{Object.entries(c.ocrFields).map(([k, v]) => `${k}:${v}`).join('，')}</div>
                      )}
                      <CertOcrConfirm
                        base="e-permits"
                        wpId={id!}
                        cert={c}
                        canEdit={hasPerm(user, 'epermit:review')}
                        onDone={load}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </Section>
          )}

          {/* 交底签字信息（已在交底页面完成，详情页只读展示） */}
          <Section title="交底签字信息" icon={<PenLine size={16} />}>
            <SignPanel
              wpId={id!}
              base="e-permits"
              signatures={d.signatures || []}
              isHazardous={d.isHazardous}
              type={d.type}
              canSign={false}
            />
          </Section>

          {/* 关联作业（右栏）：常规票→其下危险票；危险票→其依附的常规票（可互跳并进入对方现场检查） */}
          {d.isHazardous ? (
            d.routinePermit && (
              <Section title="关联常规作业" icon={<Link2 size={16} />}>
                <Card>
                  <CardContent className="space-y-2">
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          <span>{d.routinePermit.permitNo}</span> · {d.routinePermit.content || '常规作业'}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {WORK_PERMIT_STATUS[d.routinePermit.status]?.label || d.routinePermit.status}
                          {d.routinePermit.startTime ? ` · ${dayjs(d.routinePermit.startTime).format('MM-DD HH:mm')}` : ''}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/e-permits/view/${d.routinePermit.id}`)}>查看</Button>
                        <Button size="sm" onClick={() => navigate(`/e-onsite/${d.routinePermit.id}?permit=${d.routinePermit.id}&tab=inspection`)}>
                          <ClipboardCheck size={14} className="mr-1" /> 现场检查
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Section>
            )
          ) : (
            (d.hazardPermits || []).length > 0 && (
              <Section title={`关联危险作业（${d.hazardPermits.length}）`} icon={<Link2 size={16} />}>
                <Card>
                  <CardContent className="space-y-2">
                    {d.hazardPermits.map((h: any) => (
                      <div key={h.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            <span>{h.permitNo}</span> · {h.content || '危险作业'}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {WORK_PERMIT_TYPES[h.type]?.label || h.type}
                            {h.materialMissing ? ' · 资料缺' : ''}
                            {h.startTime ? ` · ${dayjs(h.startTime).format('MM-DD HH:mm')}` : ''}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <Button variant="ghost" size="sm" onClick={() => navigate(`/e-permits/view/${h.id}`)}>查看</Button>
                          {(h.status === 'printed' || h.status === 'paused') && (
                            <Button size="sm" onClick={() => navigate(`/e-onsite/${h.id}?permit=${h.id}&tab=inspection`)}>
                              <ClipboardCheck size={14} className="mr-1" /> 现场检查
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </Section>
            )
          )}
        </div>
      </div>

      {showPrint && <PrintView data={d} onClose={() => setShowPrint(false)} />}

      {/* 暂停作业：弹窗填原因（不用 window.prompt，iframe 预览/移动端可能被禁用） */}
      <Modal
        open={pauseOpen}
        title="暂停作业"
        onClose={() => setPauseOpen(false)}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPauseOpen(false)}>取消</Button>
            <Button onClick={confirmPause}>确认暂停</Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted-foreground">该作业将暂停，暂停后需「恢复作业」才能继续。请填写暂停原因（可选）：</p>
        <label className="text-xs font-medium text-muted-foreground">暂停原因</label>
        <Input value={pauseReason} onChange={(e) => setPauseReason(e.target.value)} placeholder="如 天气 / 交叉作业冲突 / 安全整改" className="mt-1" />
      </Modal>
    </div>
  );
}

/** 作业人员登记入厂记录：展示该作业票下工人的进出厂明细 */
function EntryLogSection({ wpId, workCode, status, permitNo, trainingQrToken, trainingQrExpiresAt }: { wpId: string; workCode?: string | null; status: string; permitNo?: string | null; trainingQrToken?: string | null; trainingQrExpiresAt?: string | null }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get(`/e-permits/entry-records?workPermitId=${wpId}&pageSize=100`);
      setRows(data.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [wpId]);

  const inPlant = rows.filter((r) => !r.signOutAt).length;
  const qrRef = useRef<any>(null);
  const [qrDays, setQrDays] = useState(7);
  const [qrBusy, setQrBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  async function renewQr() {
    if (qrBusy) return;
    setQrBusy(true);
    try {
      await api.post(`/e-permits/${wpId}/training-qr`, { days: qrDays });
      load();
    } catch (e: any) {
      setErr(e.response?.data?.message || '续期失败');
    } finally { setQrBusy(false); }
  }

  async function exportQrAsImage() {
    if (exportBusy) return;
    setExportBusy(true);
    setExportMsg('');
    setErr('');
    try {
      // 从页面中找到二维码 canvas（QRCodeCanvas 渲染）
      const qrCanvas = qrRef.current?.querySelector('canvas');
      if (!qrCanvas) throw new Error('未找到培训二维码，请先点击「续期」生成二维码');
      const qrImg = qrCanvas.toDataURL('image/png');

      // 纯 Canvas 绘制合成图：标题 + 作业票号 + 作业代码 + 二维码 + 截止时间
      const W = 620, H = 760, pad = 44;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d')!;
      // 背景
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
      // 顶部色带
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, '#0ea5e9'); grad.addColorStop(1, '#6366f1');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, 8);
      // 标题
      ctx.fillStyle = '#0f172a'; ctx.textAlign = 'center';
      ctx.font = 'bold 30px sans-serif'; ctx.fillText('EHS 作业票 · 培训签到', W / 2, pad + 30);
      // 作业票号
      ctx.fillStyle = '#475569'; ctx.font = '15px sans-serif';
      ctx.fillText(`作业票号：${permitNo || '—'}`, W / 2, pad + 62);
      // 作业代码（大字）
      if (workCode) {
        ctx.fillStyle = '#ea580c'; ctx.font = 'bold 26px monospace';
        ctx.fillText(`作业代码：${workCode}`, W / 2, pad + 104);
      }
      // 分隔线
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad + 20, pad + 126); ctx.lineTo(W - pad - 20, pad + 126); ctx.stroke();
      // 二维码
      const qrSize = 320;
      const img = new Image();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = qrImg; });
      const qrY = pad + 160;
      ctx.fillStyle = '#ffffff'; ctx.fillRect((W - qrSize) / 2 - 10, qrY - 10, qrSize + 20, qrSize + 20);
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
      ctx.strokeRect((W - qrSize) / 2 - 10, qrY - 10, qrSize + 20, qrSize + 20);
      ctx.drawImage(img, (W - qrSize) / 2, qrY, qrSize, qrSize);
      // 扫码提示
      ctx.fillStyle = '#64748b'; ctx.font = '14px sans-serif';
      ctx.fillText('承包商扫码 → 输入身份证 + 姓名 → 培训签到入场', W / 2, qrY + qrSize + 34);
      // 有效期
      ctx.fillStyle = '#ef4444'; ctx.font = 'bold 15px sans-serif';
      ctx.fillText(`有效期至 ${trainingQrExpiresAt ? dayjs(trainingQrExpiresAt).format('YYYY-MM-DD HH:mm') : '—'}`, W / 2, qrY + qrSize + 66);

      // 转 PNG
      const blob: Blob | null = await new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
      if (!blob) throw new Error('生成图片失败');
      // 只复制到剪贴板，不触发下载/保存（用户会切到微信等应用粘贴）
      let copied = false;
      try {
        if ((navigator as any).clipboard && (window as any).ClipboardItem) {
          await (navigator as any).clipboard.write([new (window as any).ClipboardItem({ 'image/png': blob })]);
          copied = true;
        }
      } catch { /* 浏览器不支持或权限被拒 */ }
      setExportMsg(copied
        ? '已复制到剪贴板，请到微信等应用粘贴'
        : '复制失败：当前浏览器不支持复制图片，请长按二维码截图后转发');
      setTimeout(() => setExportMsg(''), 4000);
    } catch (e: any) {
      setErr(e.message || '导出失败');
    } finally { setExportBusy(false); }
  }

  return (
    <Section title="作业人员登记入厂记录" icon={<Users size={16} />}>
      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">作业代码：</span>
            {workCode ? (
              <span className="text-lg font-bold tracking-widest text-orange-500">{workCode}</span>
            ) : (
              <span className="text-xs text-muted-foreground">作业票批准后自动生成作业代码</span>
            )}
            <span className="ml-auto flex items-center gap-3 text-xs">
              <span>累计 <b>{rows.length}</b> 人次</span>
              <StatusPill color="#16a34a">在厂 {inPlant} 人</StatusPill>
            </span>
          </div>

          {/* 培训二维码模块：含 QR + 有效期下拉 + 复制截图按钮（申请人/承包商转发用） */}
          {(trainingQrToken || workCode) && (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 space-y-2">
              {err && <div className="text-xs text-destructive">{err}</div>}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">培训二维码（有效期</span>
                <Select
                  value={String(qrDays)}
                  onChange={(e) => setQrDays(Number(e.target.value))}
                  className="!h-7 !py-0 !text-xs shrink-0"
                  style={{ width: 96 }}
                >
                  <option value="1">1 天</option>
                  <option value="3">3 天</option>
                  <option value="7">7 天</option>
                  <option value="14">14 天</option>
                  <option value="30">30 天</option>
                </Select>
                <span>）</span>
                {trainingQrExpiresAt && (
                  <span className="text-muted-foreground">
                    截止 {dayjs(trainingQrExpiresAt).format('YYYY-MM-DD HH:mm')}
                  </span>
                )}
                <Button size="sm" variant="secondary" onClick={renewQr} disabled={qrBusy}>
                  <Calendar size={13} className="mr-1" />{qrBusy ? '续期中…' : '续期'}
                </Button>
                <Button size="sm" onClick={exportQrAsImage} disabled={exportBusy}>
                  <ImageDown size={13} className="mr-1" />{exportBusy ? '导出中…' : '复制成截图'}
                </Button>
                {exportMsg && <span className="text-xs text-success">{exportMsg}</span>}
              </div>

              {trainingQrToken && (
                <div ref={qrRef} className="flex flex-col items-center gap-2 p-4 rounded-md bg-white border border-border">
                  <div className="text-center">
                    <div className="text-sm font-bold">EHS 作业票 · 培训签到</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      作业票号：<b className="text-foreground">{permitNo}</b>
                      {workCode && <>　·　作业代码：<b className="text-orange-500 text-base">{workCode}</b></>}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      承包商扫码 → 输入身份证 + 姓名 → 培训签到入场
                    </div>
                  </div>
                  <QRCodeCanvas
                    value={`${window.location.origin}/public/entry-register?token=${trainingQrToken}`}
                    size={150}
                    level="M"
                  />
                  <div className="text-[10px] text-muted-foreground">
                    截止 {dayjs(trainingQrExpiresAt).format('YYYY-MM-DD HH:mm')} 有效
                  </div>
                </div>
              )}
            </div>
          )}

          {loading ? (
            <div className="text-xs text-muted-foreground">加载中…</div>
          ) : rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              暂无入场记录。工人在门卫处扫码后输入
              <b className="text-foreground">作业代码 + 姓名 + 身份证号</b>
              完成登记；培训未通过或作业票超期将被拦截。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="ehs-table w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left">姓名</th>
                    <th className="text-left">身份证</th>
                    <th className="text-left">入场</th>
                    <th className="text-left">离场</th>
                    <th className="text-right">培训</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="font-medium">{r.workerName}</td>
                      <td className="font-mono text-[11px] text-muted-foreground">{r.workerIdCard || '—'}</td>
                      <td className="text-xs">{dayjs(r.registeredAt).format('MM-DD HH:mm')}</td>
                      <td className="text-xs">
                        {r.signOutAt ? dayjs(r.signOutAt).format('MM-DD HH:mm') : <StatusPill color="#16a34a">在厂中</StatusPill>}
                      </td>
                      <td className="text-right">
                        {r.trainingPassed ? (
                          <StatusPill color="#16a34a">已通过</StatusPill>
                        ) : (
                          <StatusPill color="#f59e0b">未通过</StatusPill>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {['printed', 'paused'].includes(status) && (
            <div className="text-[11px] text-muted-foreground">
              作业票已批准，门卫可受理入场登记。
            </div>
          )}
        </CardContent>
      </Card>
    </Section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2.5">
      <div className="w-24 text-muted-foreground shrink-0 text-sm">{label}</div>
      <div className="flex-1 text-sm">{value}</div>
    </div>
  );
}

/**
 * 审批链可视化（P1-1：已取消风险分级，审批链按票种固定）。
 * 常规作业票：区域负责人 → 承包商管理部门；
 * 危险作业票：申请部门主管 → EHS工程师 → 工程部经理。
 * 展示每个节点的：角色（含一人兼多职的 mergedRoles）、预分配审批人（含代签留痕）、
 * 处理状态（已签/待办/驳回）、意见与处理时间。当前待办节点高亮标记。
 */
function ApprovalChainView({ chain, isHazardous }: { chain?: any[]; isHazardous?: boolean }) {
  const r = isHazardous
    ? { color: '#f97316', label: '危险作业票' }
    : { color: '#22c55e', label: '常规作业票' };
  if (!chain || chain.length === 0) {
    return <div className="text-xs text-muted-foreground">该作业票尚未生成审批链（历史票或草稿态）。</div>;
  }
  const statusMeta: Record<string, { color: string; icon: string; label: string }> = {
    approved: { color: '#22c55e', icon: '✓', label: '已签' },
    pending: { color: '#94a3b8', icon: '·', label: '待办' },
    rejected: { color: '#ef4444', icon: '✕', label: '驳回' },
  };
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium"
          style={{ background: r.color + '1a', color: r.color }}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
          {r.label}
        </span>
        <span>共 {chain.length} 个审批节点</span>
      </div>

      <div className="space-y-1">
        {chain.map((node, i) => {
          const meta = statusMeta[node.status] || statusMeta.pending;
          const isLast = i === chain.length - 1;
          const merged = (node.mergedRoles || []).length > 0 ? `（兼：${node.mergedRoles.join('、')}）` : '';
          const actualDiffers =
            node.actualApproverId && node.actualApproverName && node.actualApproverName !== node.approverName;
          return (
            <div key={node.seq ?? i} className="flex gap-3">
              <div className="flex flex-col items-center" style={{ width: 20 }}>
                <span
                  className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ background: meta.color }}
                >
                  {meta.icon}
                </span>
                {!isLast && (
                  <span
                    className="my-1 w-px flex-1 rounded"
                    style={{ background: node.status === 'approved' ? '#22c55e' : '#e2e8f0', minHeight: 20 }}
                  />
                )}
              </div>
              <div className="flex-1 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {node.roleName}
                    {merged}
                  </span>
                  <span className="text-xs text-muted-foreground">第{node.seq}级</span>
                  {node.status === 'pending' && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">当前待办</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {node.approverName ? node.approverName : '待指定审批人'}
                  {actualDiffers && <span className="ml-1 text-warning">（实际：{node.actualApproverName}）</span>}
                </div>
                {node.actedAt && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    处理时间：{dayjs(node.actedAt).format('MM-DD HH:mm')}
                  </div>
                )}
                {node.opinion && <div className="mt-0.5 text-xs text-foreground">意见：{node.opinion}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DecisionPanel({ title, onDecide }: { title: string; onDecide: (approve: boolean, opinion: string) => void }) {
  const [opinion, setOpinion] = useState('');
  return (
    <Card>
      <CardContent className="space-y-2">
        <div className="font-medium">{title}</div>
        <Textarea rows={2} placeholder="审批意见" value={opinion} onChange={(e) => setOpinion(e.target.value)} />
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => onDecide(true, opinion)}>通过</Button>
          <Button variant="destructive" className="flex-1" onClick={() => onDecide(false, opinion)}>驳回</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CheckPanel({ wpId, checks, reload }: { wpId: string; checks: any[]; reload: () => void }) {
  const [checker, setChecker] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  async function add() {
    setErr('');
    try {
      await api.post(`/e-permits/${wpId}/checks`, { checkerName: checker, note });
      setChecker(''); setNote(''); reload();
    } catch (e: any) { setErr(e.response?.data?.message || '提交失败'); }
  }
  return (
    <Card>
      <CardContent className="space-y-2">
        <div className="font-medium">现场检查签字</div>
        <Input placeholder="检查人" value={checker} onChange={(e) => setChecker(e.target.value)} />
        <Textarea rows={2} placeholder="检查情况记录" value={note} onChange={(e) => setNote(e.target.value)} />
        {err && <div className="text-xs text-destructive">{err}</div>}
        <Button className="w-full" onClick={add}>记录检查</Button>
        {checks.length > 0 && (
          <div className="text-xs text-muted-foreground mt-2">已记录 {checks.length} 次（详见现场作业台）</div>
        )}
      </CardContent>
    </Card>
  );
}
