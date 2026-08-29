import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { hasPerm } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, Button, Input, Textarea, Select, PageHeader } from '@/components/ui';
import { StatusPill, Section } from '@/components/kit';
import { HAZARD_STATUS, RISK_LEVELS } from '@/constants';
import { ShieldAlert, ClipboardList, Camera, Sparkles, ArrowLeft, AlertTriangle, UserCheck, Send, RotateCcw, Undo2, Archive, Forward } from 'lucide-react';
import dayjs from 'dayjs';
import { PhotoUploader } from '@/components/PhotoUploader';
import { DateTimeInput } from '@/components/DateTimeInput';

const ACTION_LABELS: Record<string, string> = {
  assign: '派单整改',
  forward: '转发整改人',
  return: '退回重新派单',
  rectify: '整改完成',
  dept_review: '部门负责人审核',
  accept: 'EHS 验收',
  cancel: '撤销',
  archive: '管理员归档',
};

export default function HazardDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [h, setH] = useState<any>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [riskLevels, setRiskLevels] = useState<any[]>([]);

  async function load() {
    const { data } = await api.get(`/hazards/${id}`);
    setH(data);
  }
  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    api.get('/departments').then((res) => setDepartments(res.data || [])).catch(() => {});
    api.get('/risk-levels').then((res) => setRiskLevels(res.data || [])).catch(() => {});
  }, []);

  if (!h) return <div className="text-muted-foreground p-6">加载中…</div>;

  const activities = h.activities || [];

  return (
    <div className="page-fade space-y-[var(--gap-card)]">
      <PageHeader
        title="隐患详情"
        description={<span>{h.hazardNo}</span>}
        icon={<ShieldAlert size={20} />}
        actions={
          <Button variant="ghost" onClick={() => navigate('/hazards')}>
            <ArrowLeft size={16} className="mr-1" /> 返回
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[var(--gap-card)]">
        <div className="lg:col-span-2 space-y-[var(--gap-card)]">
          <Section title="基本信息" icon={<ClipboardList size={16} />}>
            <Card>
              <CardContent className="divide-y divide-border">
                <Row label="风险等级" value={<StatusPill color={RISK_LEVELS[h.riskLevel]?.color}>{RISK_LEVELS[h.riskLevel]?.label}</StatusPill>} />
                <Row label="上报人" value={`${h.submitterName}${h.isAnonymous ? '（扫码免登录）' : ''}`} />
                <Row label="位置" value={[h.building, h.floor, h.location].filter(Boolean).join(' / ') || '—'} />
                <Row label="隐患描述" value={<div className="whitespace-pre-wrap">{h.description || '—'}</div>} />
                <Row label="整改建议" value={<div className="whitespace-pre-wrap">{h.suggestAction || '—'}</div>} />
                <Row label="创建时间" value={dayjs(h.createdAt).format('YYYY-MM-DD HH:mm')} />
              </CardContent>
            </Card>
          </Section>

          {/* 按动作拆分的独立卡片（每个动作一张，标题+图标），按 activities 动态生成 */}
          {(() => {
            const cards: { key: string; icon: React.ReactNode; title: string; at: string; operator: string; comment?: string; rows: Array<{ label: string; value: React.ReactNode }> }[] = [];
            const lastOf = (action: string) => activities.filter((a: any) => a.action === action).slice(-1)[0];
            const a = lastOf('assign');
            if (a) cards.push({
              key: 'assign', icon: <Forward size={16} className="text-primary" />, title: '派单整改',
              at: a.createdAt, operator: a.operatorName, comment: a.comment,
              rows: [
                { label: '派单部门', value: (a.payload?.allocatedDepartment) || h.allocatedDepartment || '—' },
                { label: '整改人', value: (a.payload?.assigneeName) || h.assigneeName || '—' },
              ],
            });
            const r = lastOf('rectify');
            if (r) cards.push({
              key: 'rectify', icon: <RotateCcw size={16} className="text-primary" />, title: '提交整改',
              at: r.createdAt, operator: r.operatorName, comment: r.payload?.rectificationDesc || r.comment,
              rows: [{ label: '整改说明', value: r.payload?.rectificationDesc || r.comment || h.rectificationDesc || '—' }],
            });
            const rr = lastOf('return');
            if (rr) cards.push({
              key: 'return', icon: <RotateCcw size={16} className="text-warning" />, title: '继续整改（重新派单）',
              at: rr.createdAt, operator: rr.operatorName, comment: rr.comment,
              rows: [{ label: '退回原因', value: rr.comment || rr.payload?.reason || '—' }],
            });
            const dr = lastOf('dept_review');
            if (dr) cards.push({
              key: 'dept_review', icon: <UserCheck size={16} className="text-primary" />, title: '部门负责人审核确认',
              at: dr.createdAt, operator: dr.operatorName, comment: dr.comment,
              rows: [{ label: '审核结果', value: dr.payload?.result === 'pass' ? '通过' : dr.payload?.result === 'reject' ? `不通过：${dr.payload?.comment || dr.comment || ''}` : (dr.comment || '—') }],
            });
            const ac = lastOf('accept');
            if (ac) cards.push({
              key: 'accept', icon: <ShieldAlert size={16} className="text-success" />, title: 'EHS验收',
              at: ac.createdAt, operator: ac.operatorName, comment: ac.comment,
              rows: [{ label: '验收结果', value: ac.payload?.result === 'pass' ? '通过' : ac.payload?.result === 'fail' ? `不通过：${ac.payload?.rejectionReason || ac.comment || ''}` : (ac.comment || '—') }],
            });
            if (lastOf('cancel') || h.status === 'cancelled') {
              const c = lastOf('cancel');
              cards.push({
                key: 'cancel', icon: <Undo2 size={16} className="text-destructive" />, title: '撤销原因',
                at: c?.createdAt, operator: c?.operatorName, comment: c?.comment || h.cancelReason,
                rows: [{ label: '撤销原因', value: c?.comment || h.cancelReason || c?.payload?.reason || '—' }],
              });
            }
            if (lastOf('archive') || h.status === 'archived') {
              const ar = lastOf('archive');
              cards.push({
                key: 'archive', icon: <Archive size={16} className="text-muted-foreground" />, title: '管理员归档',
                at: ar?.createdAt || h.archivedAt, operator: ar?.operatorName || h.archivedByName, comment: ar?.comment || h.archivedReason,
                rows: [{ label: '归档原因', value: ar?.comment || h.archivedReason || '—' }],
              });
            }
            return cards.map((card) => (
              <Section key={card.key} title={card.title} icon={card.icon}>
                <Card>
                  <CardContent className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      {card.rows.map((r, idx) => (
                        <div key={idx} className="flex gap-3 py-2 border-b border-border last:border-b-0">
                          <div className="w-24 text-muted-foreground shrink-0">{r.label}</div>
                          <div className="flex-1 whitespace-pre-wrap">{r.value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
                      <span>操作人：<span className="text-foreground">{card.operator || '—'}</span></span>
                      {card.at && <span>· {dayjs(card.at).format('YYYY-MM-DD HH:mm')}</span>}
                      {card.comment && <span className="basis-full sm:basis-auto sm:ml-auto text-foreground/80">意见：{card.comment}</span>}
                    </div>
                  </CardContent>
                </Card>
              </Section>
            ));
          })()}

          {(h.photos?.length > 0 || h.rectificationFiles?.length > 0) && (
            <Section title="隐患照片" icon={<Camera size={16} />}>
              <Card>
                <CardContent className="space-y-4">
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <span className="rounded-md bg-warning/15 px-2 py-0.5 text-warning">整改前</span>
                      上报现场照片
                    </div>
                    {h.photos?.length > 0 ? (
                      <div className="flex gap-2 flex-wrap">
                        {h.photos.map((p: string, i: number) => (
                          <img key={i} src={p} className="w-28 h-28 object-cover rounded-lg border border-border" alt="整改前照片" />
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">暂无</div>
                    )}
                  </div>
                  <div className="border-t border-border pt-4">
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <span className="rounded-md bg-success/15 px-2 py-0.5 text-success">整改后</span>
                      整改完成照片（证据）
                    </div>
                    {h.rectificationFiles?.length > 0 ? (
                      <div className="flex gap-2 flex-wrap">
                        {h.rectificationFiles.map((p: string, i: number) => (
                          <img key={i} src={p} className="w-28 h-28 object-cover rounded-lg border border-border" alt="整改后照片" />
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">暂无（整改完成后自动展示）</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Section>
          )}

          <Section title="AI 分析" icon={<Sparkles size={16} />}>
            <Card>
              <CardContent>
                {h.aiDescription || h.aiSuggestion ? (
                  <div className="text-xs space-y-1 bg-muted rounded-lg p-3">
                    {h.aiCategory && <div><b>类别：</b>{h.aiCategory}</div>}
                    {h.aiRegulation && <div><b>法规：</b>{h.aiRegulation}</div>}
                    {h.aiSuggestion && <div><b>建议：</b>{h.aiSuggestion}</div>}
                    {h.aiRootCause && <div><b>根因：</b>{h.aiRootCause}</div>}
                    {h.aiControlMeasures && <div><b>措施：</b>{h.aiControlMeasures}</div>}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">暂无 AI 分析</div>
                )}
              </CardContent>
            </Card>
          </Section>
        </div>

        <div className="space-y-[var(--gap-card)]">
          {h.status === 'pending_assign' && hasPerm(user, 'hazard:assign') && (
            <AssignPanel h={h} reload={load} departments={departments} riskLevels={riskLevels} showArchive />
          )}
          {h.status === 'assigned' && (
            <>
              {canRectify(user, h) && <RectifyPanel h={h} reload={load} departments={departments} />}
              {!canRectify(user, h) && hasPerm(user, 'hazard:assign') && (
                <AssignPanel h={h} reload={load} departments={departments} riskLevels={riskLevels} title="重新派单" />
              )}
            </>
          )}
          {h.status === 'rejected' && (
            <>
              {canRectify(user, h) && <RectifyPanel h={h} reload={load} title="继续整改" departments={departments} />}
              {hasPerm(user, 'hazard:assign') && (
                <AssignPanel h={h} reload={load} departments={departments} riskLevels={riskLevels} title="重新派单" />
              )}
            </>
          )}
          {h.status === 'rectified' && canDeptReview(user, h) && <DeptReviewPanel h={h} reload={load} />}
          {h.status === 'dept_confirmed' && hasPerm(user, 'hazard:accept') && <AcceptPanel h={h} reload={load} />}
          {!['pending_assign', 'assigned', 'rejected', 'rectified', 'dept_confirmed'].includes(h.status) && (
            <Card>
              <CardContent className="text-xs text-muted-foreground">
                当前状态：{HAZARD_STATUS[h.status]?.label || h.status}。无可用操作。
              </CardContent>
            </Card>
          )}

          {activities.length > 0 && (
            <Section title="整改进度" icon={<AlertTriangle size={16} />}>
              <Card>
                <CardContent>
                  <div className="border-l border-border pl-4 space-y-5">
                    {activities.map((t: any, i: number) => (
                      <div key={i} className="relative">
                        <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-primary/15" />
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium text-foreground">{ACTION_LABELS[t.action] || t.action}</span>
                          <span className="text-xs text-muted-foreground">{dayjs(t.createdAt).format('MM-DD HH:mm')}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          操作人：<span className="text-foreground">{t.operatorName}</span>
                          {t.fromStatus && t.toStatus && t.fromStatus !== t.toStatus && (
                            <span className="ml-2">{HAZARD_STATUS[t.fromStatus]?.label || t.fromStatus} → {HAZARD_STATUS[t.toStatus]?.label || t.toStatus}</span>
                          )}
                        </div>
                        {t.comment && <div className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{t.comment}</div>}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2">
      <div className="w-24 text-muted-foreground shrink-0 text-sm">{label}</div>
      <div className="flex-1 text-sm">{value}</div>
    </div>
  );
}

function formatDateInput(d?: Date | string): string {
  if (!d) return '';
  const s = typeof d === 'string' ? d : d.toISOString();
  return s.slice(0, 10);
}

function deadlineByRisk(riskLevel: string, riskLevels: any[]): string {
  const rl = riskLevels.find((r) => r.level === riskLevel);
  const days = rl?.defaultDeadline ?? (riskLevel === 'critical' ? 1 : riskLevel === 'major' ? 3 : riskLevel === 'low' ? 30 : 7);
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 59, 999);
  return d.toISOString().slice(0, 10);
}

function AssignPanel({
  h,
  reload,
  departments,
  riskLevels,
  title = '派单整改',
  showArchive,
}: {
  h: any;
  reload: () => void;
  departments: any[];
  riskLevels: any[];
  title?: string;
  showArchive?: boolean;
}) {
  const { user } = useAuth();
  const [deptId, setDeptId] = useState(h.assignedDeptId || '');
  const [assigneeId, setAssigneeId] = useState(h.assigneeId || '');
  const [assigneeName, setAssigneeName] = useState(h.assigneeName || '');
  const [risk, setRisk] = useState(h.riskLevel || 'low');
  const [deadline, setDeadline] = useState('');
  const [deadlineTouched, setDeadlineTouched] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);

  const selectedDept = useMemo(() => departments.find((d) => d.id === deptId), [departments, deptId]);

  useEffect(() => {
    if (!deptId) {
      setUsers([]);
      return;
    }
    api.get(`/hazards/departments/${deptId}/users`).then((res) => {
      const list = res.data || [];
      setUsers(list);
      // 选择部门后，如果还没选整改人，自动带出部门默认整改人
      if (selectedDept && !assigneeId) {
        const def = list.find((u: any) => u.id === selectedDept.defaultRectifierId);
        if (def) {
          setAssigneeId(def.id);
          setAssigneeName(def.name);
        }
      }
    }).catch(() => setUsers([]));
  }, [deptId]);

  // 初始化：若隐患已有 deadline 且未被手动修改过，则保留；否则按风险等级默认计算
  useEffect(() => {
    if (!deadlineTouched) {
      const existing = formatDateInput(h.deadline);
      setDeadline(existing || deadlineByRisk(risk, riskLevels));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 风险等级变化时自动刷新整改期限（仅用户未手动修改过期限时）
  useEffect(() => {
    if (!deadlineTouched) {
      setDeadline(deadlineByRisk(risk, riskLevels));
    }
  }, [risk, riskLevels, deadlineTouched]);

  async function submit() {
    setErr('');
    if (!deptId) return setErr('请选择责任部门');
    if (!assigneeId) return setErr('请选择整改负责人');
    try {
      const dept = departments.find((d) => d.id === deptId);
      await api.put(`/hazards/${h.id}/assign`, {
        assignedDeptId: deptId,
        allocatedDepartment: dept?.name,
        assigneeId,
        assigneeName,
        deadline: deadline ? new Date(deadline).toISOString() : undefined,
        riskLevel: risk,
      });
      reload();
    } catch (e: any) { setErr(e.response?.data?.message || '操作失败'); }
  }

  async function archive() {
    setErr('');
    try {
      await api.put(`/hazards/${h.id}/archive`, { reason: archiveReason });
      setArchiveOpen(false);
      reload();
    } catch (e: any) { setErr(e.response?.data?.message || '归档失败'); }
  }

  return (
    <Section title={title} icon={<Forward size={16} className="text-primary" />}>
      <Card>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">责任部门</label>
          <Select value={deptId} onChange={(e) => { setDeptId(e.target.value); setAssigneeId(''); setAssigneeName(''); }}>
            <option value="">— 请选择 —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">整改负责人</label>
          <Select value={assigneeId} onChange={(e) => {
            const u = users.find((x) => x.id === e.target.value);
            setAssigneeId(e.target.value);
            setAssigneeName(u?.name || '');
          }}>
            <option value="">— 请选择 —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">风险等级</label>
          <Select value={risk} onChange={(e) => setRisk(e.target.value)}>
            {Object.entries(RISK_LEVELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">整改期限</label>
          <DateTimeInput dateOnly value={deadline} onChange={(v) => { setDeadlineTouched(true); setDeadline(v); }} />
        </div>
        {err && <div className="text-xs text-destructive">{err}</div>}
        <Button className="w-full" onClick={submit}><Send size={14} className="mr-1" /> 确认派单</Button>

        {showArchive && (
          <>
            <div className="border-t border-border pt-2">
              <Button variant="secondary" className="w-full" onClick={() => setArchiveOpen(true)}>
                <Archive size={14} className="mr-1" /> 直接归档（已完成）
              </Button>
            </div>
            {archiveOpen && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
                <label className="text-xs text-muted-foreground">归档原因 / 备注</label>
                <Textarea rows={2} value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} placeholder="请填写归档原因" />
                {err && <div className="text-xs text-destructive">{err}</div>}
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="flex-1" onClick={() => setArchiveOpen(false)}>取消</Button>
                  <Button size="sm" className="flex-1" onClick={archive}>确认归档</Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
    </Section>
  );
}

function canRectify(user: any, h: any): boolean {
  if (!user) return false;
  if (hasPerm(user, 'hazard:rectify')) {
    if (isSuper(user)) return true;
    // 分配给了具体用户，则只有该用户或管理员可操作
    if (h.assigneeId) return h.assigneeId === user.id;
    // 未分配具体用户时，有权限即可
    return true;
  }
  return false;
}

function isSuper(user: any): boolean {
  return (user.roles || []).includes('admin') || (user.permissions || []).includes('*') || (user.permissions || []).includes('hazard:assign');
}

function RectifyPanel({ h, reload, title = '提交整改', departments }: { h: any; reload: () => void; title?: string; departments: any[] }) {
  const { user } = useAuth();
  const [desc, setDesc] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState('');

  const [forwardOpen, setForwardOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [targetUserId, setTargetUserId] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (h.assignedDeptId) {
      api.get(`/hazards/departments/${h.assignedDeptId}/users`).then((res) => setUsers(res.data || [])).catch(() => {});
    } else if (h.allocatedDepartment) {
      const dept = departments.find((d) => d.name === h.allocatedDepartment);
      if (dept) api.get(`/hazards/departments/${dept.id}/users`).then((res) => setUsers(res.data || [])).catch(() => {});
    }
  }, [h.assignedDeptId, h.allocatedDepartment]);

  async function submit() {
    setErr('');
    if (!desc.trim()) return setErr('请填写整改说明');
    if (!date) return setErr('请填写整改完成日期');
    if (files.length === 0) return setErr('请上传整改附件作为证据');
    try {
      await api.put(`/hazards/${h.id}/rectify`, {
        rectificationDesc: desc,
        rectificationFiles: files,
        rectificationDate: new Date(date).toISOString(),
      });
      reload();
    } catch (e: any) { setErr(e.response?.data?.message || '操作失败'); }
  }

  async function forward() {
    setErr('');
    if (!targetUserId) return setErr('请选择接收人');
    const u = users.find((x) => x.id === targetUserId);
    try {
      await api.put(`/hazards/${h.id}/forward`, { assigneeId: targetUserId, assigneeName: u?.name || '', reason });
      setForwardOpen(false);
      reload();
    } catch (e: any) { setErr(e.response?.data?.message || '转发失败'); }
  }

  async function returnToManager() {
    setErr('');
    if (!reason.trim()) return setErr('请填写退回原因');
    try {
      await api.put(`/hazards/${h.id}/return`, { reason });
      setReturnOpen(false);
      reload();
    } catch (e: any) { setErr(e.response?.data?.message || '退回失败'); }
  }

  return (
    <Section title={title} icon={<RotateCcw size={16} className="text-primary" />}>
      <Card>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">整改完成日期 *</label>
          <DateTimeInput dateOnly value={date} onChange={(v) => setDate(v)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">整改说明 *</label>
          <Textarea rows={3} placeholder="请填写整改完成情况" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">整改后照片（证据）*</label>
          <PhotoUploader photos={files} onChange={setFiles} label="拍照 / 选图" />
        </div>
        {err && <div className="text-xs text-destructive">{err}</div>}
        <Button className="w-full" onClick={submit}><Send size={14} className="mr-1" /> 提交整改</Button>

        <div className="flex gap-2 border-t border-border pt-3">
          <Button variant="secondary" size="sm" className="flex-1" onClick={() => setForwardOpen(true)}>
            <Forward size={14} className="mr-1" /> 转发
          </Button>
          <Button variant="ghost" size="sm" className="flex-1 text-destructive" onClick={() => setReturnOpen(true)}>
            <Undo2 size={14} className="mr-1" /> 退回
          </Button>
        </div>

        {forwardOpen && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
            <label className="text-xs text-muted-foreground">转发给部门内其他人员</label>
            <Select value={targetUserId} onChange={(e) => setTargetUserId(e.target.value)}>
              <option value="">— 请选择 —</option>
              {users.filter((u) => u.id !== h.assigneeId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
            <Textarea rows={2} placeholder="转发原因（可选）" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="flex-1" onClick={() => { setForwardOpen(false); setErr(''); }}>取消</Button>
              <Button size="sm" className="flex-1" onClick={forward}>确认转发</Button>
            </div>
          </div>
        )}

        {returnOpen && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
            <label className="text-xs text-muted-foreground">退回原因 *</label>
            <Textarea rows={2} placeholder="请填写退回原因" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="flex-1" onClick={() => { setReturnOpen(false); setErr(''); }}>取消</Button>
              <Button size="sm" className="flex-1" variant="destructive" onClick={returnToManager}>确认退回</Button>
            </div>
          </div>
          )}
        </CardContent>
      </Card>
    </Section>
  );
}

// 部门负责人审核确认：整改完成后、EHS 验收前的必经环节
// 权限：持 hazard:dept_review 且为责任部门负责人；EHS/管理员（持 hazard:accept）作为兜底
function canDeptReview(user: any, h: any): boolean {
  if (!user) return false;
  const canReview = hasPerm(user, 'hazard:dept_review') || hasPerm(user, 'hazard:accept');
  if (!canReview) return false;
  if (hasPerm(user, 'hazard:accept')) return true; // EHS 兜底
  return Array.isArray(user.managedDepartments) && user.managedDepartments.includes(h.allocatedDepartment);
}

function DeptReviewPanel({ h, reload }: { h: any; reload: () => void }) {
  const { user } = useAuth();
  const [confirm, setConfirm] = useState(true);
  const [rejectReason, setRejectReason] = useState('');
  const [comment, setComment] = useState('');
  const [err, setErr] = useState('');
  async function submit() {
    setErr('');
    try {
      await api.put(`/hazards/${h.id}/dept-review`, {
        result: confirm ? 'confirm' : 'reject',
        rejectReason: confirm ? undefined : rejectReason,
        comment,
      });
      reload();
    } catch (e: any) { setErr(e.response?.data?.message || '操作失败'); }
  }
  return (
    <Section title="部门负责人审核确认" icon={<UserCheck size={16} className="text-primary" />}>
      <Card>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">整改完成后，须由责任部门负责人确认，方可流转至 EHS 验收。</p>
        <Select value={confirm ? 'confirm' : 'reject'} onChange={(e) => setConfirm(e.target.value === 'confirm')}>
          <option value="confirm">确认通过，流转验收</option>
          <option value="reject">驳回，继续整改</option>
        </Select>
        {!confirm && <Textarea rows={2} placeholder="驳回原因 *" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />}
        <Textarea rows={2} placeholder="补充说明" value={comment} onChange={(e) => setComment(e.target.value)} />
        {err && <div className="text-xs text-destructive">{err}</div>}
        <Button className="w-full" onClick={submit}>提交审核</Button>
        </CardContent>
      </Card>
    </Section>
  );
}

function AcceptPanel({ h, reload }: { h: any; reload: () => void }) {
  const { user } = useAuth();
  const [pass, setPass] = useState(true);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [err, setErr] = useState('');
  async function submit() {
    setErr('');
    try {
      await api.put(`/hazards/${h.id}/accept`, {
        result: pass ? 'pass' : 'fail',
        rejectionReason: pass ? undefined : reason,
        comment,
      });
      reload();
    } catch (e: any) { setErr(e.response?.data?.message || '操作失败'); }
  }
  return (
    <Section title="EHS 验收" icon={<ShieldAlert size={16} className="text-success" />}>
      <Card>
        <CardContent className="space-y-3">
          <Select value={pass ? 'pass' : 'fail'} onChange={(e) => setPass(e.target.value === 'pass')}>
          <option value="pass">通过</option>
          <option value="fail">不通过</option>
        </Select>
        {!pass && <Textarea rows={2} placeholder="不通过原因 *" value={reason} onChange={(e) => setReason(e.target.value)} />}
        <Textarea rows={2} placeholder="补充说明" value={comment} onChange={(e) => setComment(e.target.value)} />
        {err && <div className="text-xs text-destructive">{err}</div>}
        <Button className="w-full" onClick={submit}>提交验收</Button>
        </CardContent>
      </Card>
    </Section>
  );
}
