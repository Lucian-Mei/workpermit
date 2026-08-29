import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { Button, Input, Textarea, Select, PageHeader, Card, CardContent, Modal } from '@/components/ui';
import { Section, Field, StatusPill } from '@/components/kit';
import { DateTimeInput } from '@/components/DateTimeInput';
import { SignaturePad } from '@/components/SignaturePad';
import { WORK_PERMIT_TYPES } from '@/constants';
import { rememberRecent, getRecent } from '@/utils/recentRecall';
import {
  FileText, AlertTriangle, Link2, FileUp, ShieldCheck, Sparkles, Plus, X, Smartphone, ClipboardList, Info, CheckCircle2, Send,
  Flame, Mountain, Box, Truck, Shovel, Plug, Disc, Wrench, PenLine,
} from 'lucide-react';
import dayjs from 'dayjs';

// ================= 设计稿色板（用于类型选择卡片、JSA 红绿文字等）=================
const C = {
  blue:  { t: '#185FA5', bg: '#E6F1FB', bd: '#85B7EB', dk: '#0C447C' },
  sky:   { t: '#0E5B83', bg: '#E5F2F9', bd: '#74B8DA', dk: '#0A445F' },
  amber: { t: '#854F0B', bg: '#FAEEDA', bd: '#EF9F27', dk: '#633806' },
  coral: { t: '#712B13', bg: '#FAECE7', bd: '#F0997B' },
  purple:{ t: '#3C3489', bg: '#EEEDFE', bd: '#AFA9EC' },
  teal:  { t: '#085041', bg: '#E1F5EE', bd: '#5DCAA5' },
  indigo:{ t: '#2E2A78', bg: '#E9E9F8', bd: '#8E89D6' },
  pink:  { t: '#72243E', bg: '#FBEAF0', bd: '#ED93B1' },
  red:   { t: '#791F1F', bg: '#FCEBEB', bd: '#F09595', strong: '#A32D2D' },
  green: { t: '#3B6D11', dk: '#27500A' },
};

// 危险作业类型卡片（与统一入口 / 首页 hero 颜色一致）
const SPECIAL_CARDS = [
  { key: 'hot_work', label: '动火作业', desc: '焊接、切割等明火', c: C.coral, Icon: Flame },
  { key: 'high_altitude', label: '高处作业', desc: '离地 2m 以上', c: C.sky, Icon: Mountain },
  { key: 'confined_space', label: '受限空间', desc: '封闭/部分封闭', c: C.purple, Icon: Box },
  { key: 'lifting', label: '起重吊装', desc: '使用起重设备', c: C.amber, Icon: Truck },
  { key: 'excavation', label: '动土作业', desc: '开挖、挖掘作业', c: C.teal, Icon: Shovel },
  { key: 'temporary_electricity', label: '临时用电', desc: '临时接电、配电箱', c: C.pink, Icon: Plug },
  { key: 'blind', label: '盲板抽堵', desc: '管道盲板抽堵', c: C.indigo, Icon: Disc },
  { key: 'other', label: '其他危险作业', desc: '不属于上述 7 类', c: C.red, Icon: AlertTriangle },
];

type MeasureGroup = { id: string; content: string; note?: string; checked: boolean; phase?: string };
type JsaRow = { step: string; hazard: string; control: string; risk?: string };

export default function EApplicationApply() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id: editId } = useParams();
  const [params] = useSearchParams();
  // 内嵌模式（/e-applications 列表页 query 驱动）也支持：id 从 query 读
  const isEditing = Boolean(editId || params.get('id'));
  const effectiveEditId = editId || params.get('id') || '';
  const routineFromUrl = params.get('routine') || '';

  // ===== 页面层级：select（类型选择）/ routine / special =====
  const [mode, setMode] = useState<'select' | 'routine' | 'special'>(() => {
    if (isEditing) return 'select';
    const type = params.get('type');
    if (type === 'routine') return 'routine';
    // 危险作业必须指定具体类型（special=xxx），否则回退到类型选择页，避免渲染出空白的隐藏界面
    if (type === 'special') return params.get('special') ? 'special' : 'select';
    return 'select';
  });
  const [specialType, setSpecialType] = useState(() => params.get('special') || '');

  const [appId, setAppId] = useState('');
  const [permitNo, setPermitNo] = useState('');
  const [wpCreated, setWpCreated] = useState(false);
  const [wpId, setWpId] = useState(''); // 关联的作业票 id（提交时需同步 submit 进作业管理列表）
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [appStatus, setAppStatus] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const [areas, setAreas] = useState<any[]>([]);
  const [depts, setDepts] = useState<string[]>([]);

  // 作业表单字段
  const [form, setForm] = useState({
    jobName: '', department: '', building: '', floor: '', area: '', location: '', planStart: '', planEnd: '',
    operatorNames: '', supervisorName: '', supervisorContact: '', content: '',
    contractorUnit: '', contractorHead: '', contractorPhone: '', operatorCount: '',
    managementDept: '', managementPerson: '',
    guardianSignatures: [] as Array<{ role: 'company_guardian' | 'contractor_guardian'; name: string; signImg?: string; signedAt?: string }>,
  });
  // 危险作业票提交前置：现场检查 + 双监护人签名
  const [inspector, setInspector] = useState('');
  const [inspectItems, setInspectItems] = useState<Record<string, boolean>>({});
  const [inspectDone, setInspectDone] = useState(false);
  const [guardianOpen, setGuardianOpen] = useState<'company_guardian' | 'contractor_guardian' | null>(null);

  // 作业步骤 + JSA
  const [steps, setSteps] = useState<string[]>(['']);
  const [jsas, setJsas] = useState<JsaRow[]>([]);
  const [jsaBusy, setJsaBusy] = useState(false);

  // 承包商库：输入时自动联想；选中后自动带出负责人/电话；提交后自动入库
  const [contractorList, setContractorList] = useState<any[]>([]);
  const [contractorOpen, setContractorOpen] = useState(false);

  // 安全措施确认（仅危险作业票）
  const [measures, setMeasures] = useState<{ pre: MeasureGroup[]; during: MeasureGroup[]; post: MeasureGroup[] }>({ pre: [], during: [], post: [] });
  const [measuresLoaded, setMeasuresLoaded] = useState(false);

  // 危险作业票：关联常规票 + 特种证
  const [linkedRoutineId, setLinkedRoutineId] = useState(routineFromUrl);
  const [routines, setRoutines] = useState<any[]>([]);
  const [routinesLoading, setRoutinesLoading] = useState(false);
  const [certs, setCerts] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);

  const isHazard = mode === 'special';
  const t = isHazard ? (specialType ? WORK_PERMIT_TYPES[specialType] : null) : WORK_PERMIT_TYPES['routine'];
  const needCert = Boolean(t?.needCertificate);

  function setK(k: string, v: any) { setForm((f) => ({ ...f, [k]: v })); }

  // 常用信息本地记忆（作业人/监护人/承包商负责人等），以 datalist 下拉回显
  const [recall, setRecall] = useState(() => ({
    operatorNames: getRecent('operatorNames'),
    supervisorName: getRecent('supervisorName'),
    supervisorContact: getRecent('supervisorContact'),
    contractorHead: getRecent('contractorHead'),
    contractorPhone: getRecent('contractorPhone'),
    managementPerson: getRecent('managementPerson'),
  }));
  function recordRecall() {
    rememberRecent('operatorNames', form.operatorNames);
    rememberRecent('supervisorName', form.supervisorName);
    rememberRecent('supervisorContact', form.supervisorContact);
    rememberRecent('contractorHead', form.contractorHead);
    rememberRecent('contractorPhone', form.contractorPhone);
    rememberRecent('managementPerson', form.managementPerson);
    setRecall({
      operatorNames: getRecent('operatorNames'),
      supervisorName: getRecent('supervisorName'),
      supervisorContact: getRecent('supervisorContact'),
      contractorHead: getRecent('contractorHead'),
      contractorPhone: getRecent('contractorPhone'),
      managementPerson: getRecent('managementPerson'),
    });
  }
  function RecallDatalist() {
    return (
      <>
        <datalist id="rc-operatorNames">{recall.operatorNames.map((o, i) => <option key={i} value={o} />)}</datalist>
        <datalist id="rc-supervisorName">{recall.supervisorName.map((o, i) => <option key={i} value={o} />)}</datalist>
        <datalist id="rc-supervisorContact">{recall.supervisorContact.map((o, i) => <option key={i} value={o} />)}</datalist>
        <datalist id="rc-contractorHead">{recall.contractorHead.map((o, i) => <option key={i} value={o} />)}</datalist>
        <datalist id="rc-contractorPhone">{recall.contractorPhone.map((o, i) => <option key={i} value={o} />)}</datalist>
        <datalist id="rc-managementPerson">{recall.managementPerson.map((o, i) => <option key={i} value={o} />)}</datalist>
      </>
    );
  }

  // 承包商输入联想：按单位名模糊搜索，命中自动带出负责人/电话
  async function searchContractors(q: string) {
    if (!q.trim()) { setContractorList([]); setContractorOpen(false); return; }
    try {
      const { data } = await api.get(`/contractors?q=${encodeURIComponent(q.trim())}`);
      const items = Array.isArray(data) ? data : data?.items || [];
      setContractorList(items);
      setContractorOpen(items.length > 0);
    } catch { /* 联想失败静默 */ }
  }
  function pickContractor(c: any) {
    setK('contractorUnit', c.name);
    if (c.head) setK('contractorHead', c.head);
    if (c.phone) setK('contractorPhone', c.phone);
    setContractorOpen(false);
  }
  // 提交后自动入库（按单位+负责人去重）
  async function saveContractor() {
    const name = form.contractorUnit?.trim();
    if (!name) return;
    try {
      await api.post('/contractors', {
        name,
        head: form.contractorHead?.trim(),
        phone: form.contractorPhone?.trim(),
      });
    } catch { /* 入库失败不影响主流程 */ }
  }
  function setStep(i: number, v: string) { setSteps((s) => s.map((x, j) => (j === i ? v : x))); }
  function addStep() { setSteps((s) => [...s, '']); }
  function removeStep(i: number) { setSteps((s) => s.filter((_, j) => j !== i)); }

  useEffect(() => {
    Promise.all([api.get('/areas'), api.get('/departments')])
      .then(([a, d]) => {
        setAreas((a.data || []).filter((x: any) => x.enabled !== false));
        setDepts((d.data || []).map((x: any) => x.name));
      }).catch(() => {});
  }, []);

  const buildings = Array.from(new Set(areas.map((a: any) => a.building).filter(Boolean)));
  const floorOptions = (form.building ? Array.from(new Set(areas.filter((a: any) => a.building === form.building).map((a: any) => a.floor).filter(Boolean))) : []);
  const areaOptions = areas
    .filter((a: any) => {
      if (form.building && a.building !== form.building) return false;
      if (form.floor && a.floor !== form.floor) return false;
      return true;
    })
    .map((a: any) => a.name);

  useEffect(() => {
    if (!isHazard) { setRoutines([]); return; }
    setRoutinesLoading(true);
    api.get('/e-permits/linkable-routines', { params: { limit: 50 } })
      .then(({ data }) => setRoutines(data.items || []))
      .catch(() => setRoutines([]))
      .finally(() => setRoutinesLoading(false));
  }, [isHazard]);

  useEffect(() => {
    if (!isHazard || !specialType) { setMeasures({ pre: [], during: [], post: [] }); setMeasuresLoaded(false); return; }
    setMeasuresLoaded(false);
    api.get('/e-permits/measure-templates', { params: { type: specialType } })
      .then(({ data }) => {
        const toGroup = (arr: any[]): MeasureGroup[] => (arr || []).map((m) => ({ id: m.id, content: m.content, note: m.note || '', checked: false, phase: m.phase }));
        setMeasures({ pre: toGroup(data.pre), during: toGroup(data.during), post: toGroup(data.post) });
      }).catch(() => setMeasures({ pre: [], during: [], post: [] }))
      .finally(() => setMeasuresLoaded(true));
  }, [isHazard, specialType]);

  // 编辑模式：先试申请单，404 则试作业票（草稿票可能没有对应申请单）
  useEffect(() => {
    if (!effectiveEditId) return;
    setLoading(true);
    api.get(`/e-applications/${effectiveEditId}`).then(({ data }) => {
      setAppStatus(data.status);
      // 驳回时拼接驳回意见（依次为部门/EHS/经理，取最后一个非空）
      if (data.status === 'rejected') {
        // 申请单层面（部门/合同/EHS）+ 关联作业票（review/approve）的驳回意见
        const reasons = [
          data.areaApprovalOpinion, data.contractApprovalOpinion, data.ehsApprovalOpinion, data.approvalOpinion,
          ...((data.workPermits || []).map((w: any) => [w.reviewOpinion, w.ehsApprovalOpinion, w.approvalOpinion])).flat(),
        ].map((s: any) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
        setRejectReason(reasons.join(' / '));
      } else {
        setRejectReason('');
      }
      setAppId(data.id); setPermitNo(data.permitNo);
      const special = data.permitType === 'special';
      setMode(special ? 'special' : 'routine');
      if (special) {
        const wp = (data.workPermits || []).find((w: any) => w.isHazardous);
        if (wp?.type) setSpecialType(wp.type);
        if (data.linkedRoutineId) setLinkedRoutineId(data.linkedRoutineId);
      }
      setForm({
        jobName: data.jobName || '', department: data.department || '', building: data.building || '', floor: data.floor || '', area: data.area || '', location: data.location || '',
        planStart: data.planStart ? dayjs(data.planStart).format('YYYY-MM-DDTHH:mm') : '',
        planEnd: data.planEnd ? dayjs(data.planEnd).format('YYYY-MM-DDTHH:mm') : '',
        operatorNames: (data.operatorNames || []).join(', '), supervisorName: data.supervisorName || '',
        supervisorContact: data.supervisorContact || '', content: data.content || '',
        contractorUnit: data.contractorUnit || '', contractorHead: data.contractorHead || '',
        contractorPhone: data.contractorPhone || '', operatorCount: data.operatorCount || '',
        managementDept: data.managementDept || '', managementPerson: data.managementPerson || '',
        guardianSignatures: [],
      });
      if (Array.isArray(data.jsas) && data.jsas.length) setJsas(data.jsas);
      if (Array.isArray(data.steps) && data.steps.length) setSteps(data.steps);
      if (Array.isArray(data.safetyMeasures) && data.safetyMeasures.length) {
        const byPhase: any = { pre: [], during: [], post: [] };
        data.safetyMeasures.forEach((m: any, i: number) => {
          const grp = byPhase[m.phase || 'pre'] || (byPhase[m.phase || 'pre'] = []);
          grp.push({ id: m.id || `m${i}`, content: m.content, note: m.note || '', checked: !!m.checked, phase: m.phase });
        });
        setMeasures({ pre: byPhase.pre || [], during: byPhase.during || [], post: byPhase.post || [] });
        setMeasuresLoaded(true);
      }
      const firstWp = (data.workPermits || [])[0];
      if (firstWp?.id) { setWpId(firstWp.id); setWpCreated(true); }
      setCerts(data.certificates || []);
    }).catch(() => {
      return api.get(`/e-permits/${effectiveEditId}`).then(({ data: wp }) => {
        const isHazardWp = wp.isHazardous;
        setMode(isHazardWp ? 'special' : 'routine');
        if (isHazardWp && wp.type) setSpecialType(wp.type);
        if (wp.linkedRoutineId) setLinkedRoutineId(wp.linkedRoutineId);
        setAppId(wp.applicationId || '');
        setPermitNo(wp.permitNo);
        // 从作业票 id 进入编辑：必须复用该 wp，避免提交时又新建一张票（编号 +1 且旧票残留草稿）
        setWpId(effectiveEditId);
        setWpCreated(true);
        setForm({
          jobName: wp.jobName || '', department: wp.department || '', building: wp.building || '', floor: wp.floor || '', area: wp.area || '', location: wp.location || '',
          planStart: wp.startTime ? dayjs(wp.startTime).format('YYYY-MM-DDTHH:mm') : '',
          planEnd: wp.endTime ? dayjs(wp.endTime).format('YYYY-MM-DDTHH:mm') : '',
          operatorNames: (wp.operatorNames || []).join(', '), supervisorName: wp.supervisorName || '',
          supervisorContact: wp.supervisorContact || '', content: wp.content || '',
          contractorUnit: wp.contractorUnit || '', contractorHead: wp.contractorHead || '',
          contractorPhone: wp.contractorPhone || '',
          operatorCount: wp.expectedOperatorCount != null ? String(wp.expectedOperatorCount) : '',
          managementDept: '', managementPerson: '',
          guardianSignatures: [],
        });
        if (Array.isArray(wp.jsas) && wp.jsas.length) setJsas(wp.jsas);
        if (Array.isArray(wp.measureSelections) && wp.measureSelections.length) {
          const byPhase: any = { pre: [], during: [], post: [] };
          wp.measureSelections.forEach((m: any, i: number) => {
            const grp = byPhase[m.phase || 'pre'] || (byPhase[m.phase || 'pre'] = []);
            grp.push({ id: m.id || `m${i}`, content: m.content, note: m.note || '', checked: !!m.checked, phase: m.phase });
          });
          setMeasures({ pre: byPhase.pre || [], during: byPhase.during || [], post: byPhase.post || [] });
          setMeasuresLoaded(true);
        }
        if (Array.isArray(wp.certificates) && wp.certificates.length) setCerts(wp.certificates);
        setErr(wp.applicationId ? '' : '该作业票尚无对应申请单，保存将创建一个新申请单并关联此草稿作业票。');
      });
    }).catch(() => setErr('加载申请单失败')).finally(() => setLoading(false));
  }, [effectiveEditId]);

  // 选择关联常规作业后自动填写危险作业基本信息（支持修改）
  // 注意：此 hook 必须在任何条件 return 之前（React Hooks 规则）
  React.useEffect(() => {
    const rt = routines.find((r) => r.id === linkedRoutineId);
    if (!rt) return;
    setForm((prev: any) => ({
      ...prev,
      area: prev.area || rt.area || '',
      location: prev.location || rt.location || '',
      planStart: prev.planStart || rt.startTime || '',
      planEnd: prev.planEnd || rt.endTime || '',
      operatorNames: prev.operatorNames || (Array.isArray(rt.operatorNames) ? rt.operatorNames.join(', ') : ''),
      supervisorName: prev.supervisorName || rt.supervisorName || '',
      supervisorContact: prev.supervisorContact || rt.supervisorContact || '',
      contractorUnit: prev.contractorUnit || rt.contractorUnit || '',
      content: prev.content || rt.content || '',
      operatorCount: prev.operatorCount || (rt.expectedOperatorCount != null ? String(rt.expectedOperatorCount) : ''),
    }));
  }, [linkedRoutineId, routines]);

  function validate(): string {
    const required: Record<string, string> = isHazard
      ? { building: '楼栋', floor: '楼层', area: '区域', location: '具体地点', planStart: '开始时间', planEnd: '结束时间', content: '作业内容' }
      : { jobName: '作业名称', building: '楼栋', floor: '楼层', area: '区域', location: '具体位置', planStart: '计划开始时间', planEnd: '计划结束时间', contractorUnit: '承包商单位', contractorHead: '承包商负责人', contractorPhone: '负责人电话', operatorCount: '预计作业人数', managementDept: '承包商管理部门', managementPerson: '现场监护人', content: '作业内容' };
    for (const [k, label] of Object.entries(required)) {
      const v = (form as any)[k];
      if (!v) return `${label} 为必填项`;
    }
    if (isHazard && !specialType) return '请选择危险作业类型';
    if (isHazard && !linkedRoutineId) return '危险作业票必须关联一张已批准的常规作业票';
    if (steps.filter((s) => s.trim()).length === 0) return '请至少填写一个作业步骤';
    // JSA 校验：必须至少 1 条有效条目（步骤/危害/控制 任一非空）
    const validJsa = jsas.filter((j) => j.step?.trim() || j.hazard?.trim() || j.control?.trim()).length;
    if (validJsa === 0) return '请完成工作安全分析（JSA）：至少填写 1 条步骤/危害/控制措施';
    return '';
  }

  async function ensureApp(): Promise<string> {
    if (appId) return appId;
    if (effectiveEditId) { setAppId(effectiveEditId); return effectiveEditId; }
    const { data } = await api.post('/e-applications', { department: form.department || user?.department });
    setAppId(data.id); setPermitNo(data.permitNo);
    return data.id;
  }

  async function saveApp() {
    const id = await ensureApp();
    const safetyMeasures = isHazard
      ? [...measures.pre, ...measures.during, ...measures.post].map((m, i) => ({
          id: m.id || `m${i}`, content: m.content, checked: !!m.checked, note: m.note || '', phase: m.phase,
        }))
      : [];
    await api.put(`/e-applications/${id}`, {
      ...form,
      operatorNames: form.operatorNames ? form.operatorNames.split(/[,，\s]+/).filter(Boolean) : [],
      planStart: form.planStart || undefined, planEnd: form.planEnd || undefined,
      jobName: form.jobName || (isHazard ? `${t?.label || '特殊'}作业` : ''),
      involvesHazardous: isHazard,
      permitType: isHazard ? 'special' : 'routine',
      type: isHazard ? (specialType || 'other') : 'routine',
      jsas,
      steps: steps.filter((s) => s.trim()),
      safetyMeasures,
      linkedRoutineId: isHazard ? (linkedRoutineId || null) : null,
      expectedOperatorCount: !isHazard && form.operatorCount ? Number(form.operatorCount) : undefined,
      guardianSignatures: isHazard ? (form.guardianSignatures || []) : [],
    });
    // 承包商自动入库（下次输入联想）
    await saveContractor();
    return id;
  }

  async function runJsa() {
    setErr('');
    const cleanSteps = steps.filter((s) => s.trim());
    if (!form.content.trim() && cleanSteps.length === 0) { setErr('请先填写作业内容与作业步骤'); return; }
    setJsaBusy(true);
    try {
      const { data } = await api.post('/e-permits/ai-jsa', {
        content: form.content, steps: cleanSteps, type: isHazard ? (specialType || '危险作业') : '常规作业',
      });
      const rows: JsaRow[] = Array.isArray(data.jsas) ? data.jsas : [];
      setJsas(rows.length ? rows : cleanSteps.map((s) => ({ step: s, hazard: '', control: '', risk: '中' })));
    } catch (e: any) {
      setErr(e.response?.data?.message || 'JSA 分析失败');
    } finally { setJsaBusy(false); }
  }

  function setJsa(i: number, field: keyof JsaRow, v: string) {
    setJsas((js) => js.map((r, j) => (j === i ? { ...r, [field]: v } : r)));
  }
  function addJsa() { const last = jsas[jsas.length - 1]; setJsas((js) => [...js, { step: last?.step || '', hazard: '', control: '', risk: '中' }]); }
  function removeJsa(i: number) { setJsas((js) => js.filter((_, j) => j !== i)); }

  function setMeasureChecked(group: 'pre' | 'during' | 'post', i: number, checked: boolean) {
    setMeasures((m) => ({ ...m, [group]: m[group].map((it, j) => (j === i ? { ...it, checked } : it)) }));
  }
  function setMeasureNote(group: 'pre' | 'during' | 'post', i: number, note: string) {
    setMeasures((m) => ({ ...m, [group]: m[group].map((it, j) => (j === i ? { ...it, note } : it)) }));
  }

  async function submit() {
    setErr(''); setMsg('');
    const v = validate();
    if (v) { setErr(v); return; }
    // 危险作业票提交前置：现场检查 + 双监护人签名
    if (isHazard) {
      if (!inspectDone) { setErr('危险作业票提交前必须先完成现场检查（提交检查记录）'); return; }
      const roles = (form.guardianSignatures || []).map((g) => g.role);
      if (!roles.includes('company_guardian') || !roles.includes('contractor_guardian')) {
        setErr('危险作业票提交前须由新波监护人和承包商监护人完成签名'); return;
      }
    }
    try {
      setSaving(true);
      recordRecall();
      const id = await saveApp();
      // 只要还没有关联作业票就创建（无论是否编辑态）：保证提交后立刻在常规/危险作业管理中可见，
      // 不等审批。isEditing 时若已有 wp（主路径 firstWp/fallback wpCreated）则复用，不重复创建。
      if (!wpCreated) {
        const wpType = isHazard ? specialType : 'routine';
        const wpRes = await api.post('/e-permits', {
          type: wpType,
          applicationId: id,
          linkedRoutineId: isHazard ? (linkedRoutineId || null) : null,
          expectedOperatorCount: !isHazard && form.operatorCount ? Number(form.operatorCount) : undefined,
          // 带全作业票必填字段，确保 wp 创建后 submit 不因缺字段失败（提交即同步可见）
          jobName: form.jobName,
          content: form.content,
          building: form.building,
          floor: form.floor,
          area: form.area,
          location: form.location,
          startTime: form.planStart || undefined,
          endTime: form.planEnd || undefined,
          supervisorName: form.supervisorName,
          supervisorContact: form.supervisorContact,
          operatorNames: form.operatorNames ? form.operatorNames.split(/[,，\s]+/).filter(Boolean) : [],
        }).catch(() => null);
        if (wpRes?.data?.id) { setWpId(wpRes.data.id); setWpCreated(true); }
      }
      // 同步 JSA 到作业票本体（避免 EPermits/Detail 页 JSA 显示为空）
      if (wpId) {
        await api.put(`/e-permits/${wpId}`, { jsas: jsas.filter((j) => j.step?.trim() || j.hazard?.trim() || j.control?.trim()) }).catch(() => {});
      }
      // 提交作业票本体（draft→pending_review），确保出现在「常规/危险作业管理」列表。
      // 失败必须抛错（不静默吞掉），否则票停留在 draft 而被作业管理列表过滤，用户以为没同步。
      if (wpId) {
        await api.post(`/e-permits/${wpId}/submit`);
      }
      await api.post(`/e-applications/${id}/submit`);
      setMsg(isHazard ? '提交成功，危险作业票将进入三级审批。' : '提交成功，申请批准后自动生成作业票。');
      setTimeout(() => navigate(`/e-applications/${id}`), 1200);
    } catch (e: any) {
      setErr(e.response?.data?.message || '提交失败');
    } finally { setSaving(false); }
  }

  async function saveDraft() {
    setErr(''); setMsg('');
    try {
      recordRecall();
      await saveApp();
      setMsg('已保存草稿');
    } catch (e: any) { setErr(e.response?.data?.message || '保存失败'); }
  }

  if (loading) return <div className="text-muted-foreground p-6">加载中…</div>;

  const linkedRoutine = routines.find((r) => r.id === linkedRoutineId) || null;
  const allMeasures = [...measures.pre, ...measures.during, ...measures.post];

  // 驳回时在所有页面顶部展示驳回原因（让申请人知道为什么被驳回）
  const rejectedBanner = appStatus === 'rejected' ? (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 mb-4 text-sm">
      <div className="font-medium text-destructive mb-1">⚠ 申请单已被驳回，请修改后重新提交</div>
      {rejectReason && <div className="text-xs text-destructive/90 whitespace-pre-wrap">驳回原因：{rejectReason}</div>}
    </div>
  ) : null;

  // ============================================================
  // 页面 1 — 类型选择（统一入口）
  // ============================================================
  if (mode === 'select' && !isEditing) {
    return (
      <div className="page-fade space-y-[var(--gap-card)]">
        {rejectedBanner}
        <PageHeader
          title="作业票申请"
          description="选择作业类型后进入专属申请页"
          icon={<Smartphone size={20} />}
          actions={
            <Button variant="ghost" onClick={() => { if (window.history.length > 1) navigate(-1); else navigate('/e-applications'); }}>取消</Button>
          }
        />
        <Section title="选择作业类型" icon={<FileText size={16} />}>
          <Card>
            <CardContent className="space-y-5 p-6">
              {/* 常规作业票 */}
              <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
                <div className="mb-2 flex items-center gap-2">
                  <span style={{ color: C.blue.t }} className="text-sm font-semibold">常规作业票（GWP）</span>
                  <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: C.blue.bg, color: C.blue.t }}>入厂总许可</span>
                </div>
                <p className="mb-3 text-xs text-muted-foreground">承包商入厂作业的总许可。申请时填写预计作业人数，批准后下发培训二维码与 6 位作业码。</p>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <button type="button" onClick={() => setMode('routine')}
                    className="flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md"
                    style={{ borderColor: C.blue.bd, background: C.blue.bg }}>
                    <div className="flex items-center gap-2">
                      <Wrench size={16} style={{ color: C.blue.dk }} />
                      <span style={{ color: C.blue.dk }} className="text-sm font-semibold">常规作业</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">一般性检维修/安装</div>
                  </button>
                </div>
              </div>
              {/* 危险作业票 */}
              <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
                <div className="mb-2 flex items-center gap-2">
                  <span style={{ color: C.amber.t }} className="text-sm font-semibold">危险作业票</span>
                  <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: C.amber.bg, color: C.amber.t }}>需关联常规票</span>
                </div>
                <p className="mb-3 text-xs text-muted-foreground">常规作业中的高风险环节，必须挂靠在一张已批准且未完成的常规作业票之下。</p>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {SPECIAL_CARDS.map((s) => (
                    <button key={s.key} type="button" onClick={() => { setSpecialType(s.key); setMode('special'); }}
                      className="flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md"
                      style={{ borderColor: s.c.bd, background: s.c.bg }}>
                      <div className="flex items-center gap-2">
                        <s.Icon size={16} style={{ color: s.c.t }} />
                        <span style={{ color: s.c.t }} className="text-sm font-semibold">{s.label}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">{s.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </Section>
      </div>
    );
  }

  // ============================================================
  // 页面 2 — 常规 / 特殊 申请表单
  // ============================================================
  const accent = isHazard ? C.amber : C.blue;
  const headerTitle = isHazard ? `${t?.label || '特殊'}作业票申请` : '常规作业票申请';
  const headerSub = permitNo || '新建';

  return (
    <div className="page-fade space-y-[var(--gap-card)]">
      {rejectedBanner}
      <PageHeader
        title={headerTitle}
        description={headerSub}
        icon={<FileText size={20} />}
        actions={
          <>
            <Button variant="ghost" onClick={() => setMode('select')}>更换类型</Button>
            <Button variant="secondary" onClick={saveDraft} disabled={saving}>保存草稿</Button>
            <Button onClick={submit} disabled={saving}>
              <Send size={16} className="mr-1" /> 确认提交
            </Button>
            <Button variant="ghost" onClick={() => { if (window.history.length > 1) navigate(-1); else navigate('/e-applications'); }}>取消</Button>
          </>
        }
      />

      {err && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{err}</div>
      )}
      {msg && (
        <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-2 text-sm text-success">{msg}</div>
      )}

      <div className="grid grid-cols-1 gap-[var(--gap-card)] lg:grid-cols-3">
        {/* ==================== 左列 ==================== */}
        <div className="space-y-[var(--gap-card)] lg:col-span-2">

          {/* 特殊：关联常规作业票 */}
          {isHazard && (
            <Section title="关联常规票" icon={<Link2 size={16} />}>
              <Card>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">危险作业须挂靠在已批准且未完成的常规作业票下。</p>
                  <Select value={linkedRoutineId} onChange={(e) => setLinkedRoutineId(e.target.value)} disabled={routinesLoading}
                    className="w-full">
                    <option value="">{routinesLoading ? '加载中…' : '— 请选择 —'}</option>
                    {routines.map((r) => (
                      <option key={r.id} value={r.id}>{r.permitNo} · {(r.content || '').slice(0, 20)} · {r.status === 'approved' ? '已批准' : r.status}</option>
                    ))}
                  </Select>
                  {linkedRoutine && (
                    <div className="rounded-lg p-3 text-xs" style={{ background: C.amber.bg, color: C.amber.dk }}>
                      票号：{linkedRoutine.permitNo} · 申请人：{linkedRoutine.applicantName || '—'} {linkedRoutine.workCode ? `· 作业码：${linkedRoutine.workCode}` : ''} · 地点：{linkedRoutine.area || '—'} {linkedRoutine.location || ''}
                    </div>
                  )}
                  {!routinesLoading && routines.length === 0 && (
                    <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">当前没有可关联的常规作业票，请先申请并批准一张常规作业票。</div>
                  )}
                </CardContent>
              </Card>
            </Section>
          )}

          {/* 基本信息 — 与详情页对齐 */}
          <Section title="基本信息" icon={<FileText size={16} />}>
            <Card>
              <CardContent className="space-y-4">
                {isHazard ? (
                  <>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <Field label="楼栋" required>
                        <Select value={form.building} onChange={(e) => setK('building', e.target.value)} className="w-full">
                          <option value="">— 请选择 —</option>{buildings.map((b) => <option key={b} value={b}>{b}</option>)}
                        </Select>
                      </Field>
                      <Field label="楼层" required>
                        <Select value={form.floor} onChange={(e) => setK('floor', e.target.value)} className="w-full">
                          <option value="">— 请选择 —</option>{floorOptions.map((f) => <option key={f} value={f}>{f}</option>)}
                        </Select>
                      </Field>
                      <Field label="区域" required>
                        <Select value={form.area} onChange={(e) => setK('area', e.target.value)} className="w-full">
                          <option value="">— 请选择 —</option>{areaOptions.map((a) => <option key={a} value={a}>{a}</option>)}
                        </Select>
                      </Field>
                      <Field label="具体地点" required>
                        <Input value={form.location} onChange={(e) => setK('location', e.target.value)} placeholder="如 屋顶彩钢瓦更换区" />
                      </Field>
                      <Field label="开始时间" required><DateTimeInput value={form.planStart} onChange={(v) => setK('planStart', v)} placeholder="选择开始时间" /></Field>
                      <Field label="结束时间" required><DateTimeInput value={form.planEnd} onChange={(v) => setK('planEnd', v)} placeholder="选择结束时间" /></Field>
                      <Field label="承包商单位">
                        <div className="relative">
                          <Input
                            value={form.contractorUnit}
                            onChange={(e) => { setK('contractorUnit', e.target.value); searchContractors(e.target.value); }}
                            onFocus={() => searchContractors(form.contractorUnit)}
                            placeholder="输入单位名，自动联想已录入承包商"
                          />
                          {contractorOpen && contractorList.length > 0 && (
                            <div className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-card p-1 shadow-lg">
                              {contractorList.map((c: any) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                                  onClick={() => pickContractor(c)}
                                >
                                  <span className="font-medium">{c.name}</span>
                                  {c.head && <span className="ml-2 text-muted-foreground">{c.head}</span>}
                                  {c.phone && <span className="ml-1 text-muted-foreground">{c.phone}</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </Field>
                      <Field label="作业人"><Input value={form.operatorNames} onChange={(e) => setK('operatorNames', e.target.value)} list="rc-operatorNames" placeholder="赵六, 孙七" /></Field>
                      <Field label="监护人"><Input value={form.supervisorName} onChange={(e) => setK('supervisorName', e.target.value)} list="rc-supervisorName" placeholder="监护人姓名" /></Field>
                      <Field label="监护人电话"><Input value={form.supervisorContact} onChange={(e) => setK('supervisorContact', e.target.value)} list="rc-supervisorContact" placeholder="手机号" /></Field>
                    </div>
                  </>
                ) : (
                  <>
                    <Field label="作业名称" required><Input value={form.jobName} onChange={(e) => setK('jobName', e.target.value)} placeholder="如 2号车间设备检修" /></Field>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <Field label="楼栋" required>
                        <Select value={form.building} onChange={(e) => setK('building', e.target.value)} className="w-full">
                          <option value="">— 请选择 —</option>{buildings.map((b) => <option key={b} value={b}>{b}</option>)}
                        </Select>
                      </Field>
                      <Field label="楼层" required>
                        <Select value={form.floor} onChange={(e) => setK('floor', e.target.value)} className="w-full">
                          <option value="">— 请选择 —</option>{floorOptions.map((f) => <option key={f} value={f}>{f}</option>)}
                        </Select>
                      </Field>
                      <Field label="区域" required>
                        <Select value={form.area} onChange={(e) => setK('area', e.target.value)} className="w-full">
                          <option value="">— 请选择 —</option>{areaOptions.map((a) => <option key={a} value={a}>{a}</option>)}
                        </Select>
                      </Field>
                      <Field label="具体位置" required><Input value={form.location} onChange={(e) => setK('location', e.target.value)} placeholder="如 焊接区" /></Field>
                      <Field label="计划开始时间" required><DateTimeInput value={form.planStart} onChange={(v) => setK('planStart', v)} placeholder="选择开始时间" /></Field>
                      <Field label="计划结束时间" required><DateTimeInput value={form.planEnd} onChange={(v) => setK('planEnd', v)} placeholder="选择结束时间" /></Field>
                      <Field label="承包商单位" required>
                        <div className="relative">
                          <Input
                            value={form.contractorUnit}
                            onChange={(e) => { setK('contractorUnit', e.target.value); searchContractors(e.target.value); }}
                            onFocus={() => searchContractors(form.contractorUnit)}
                            placeholder="输入单位名，自动联想已录入承包商"
                          />
                          {contractorOpen && contractorList.length > 0 && (
                            <div className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-card p-1 shadow-lg">
                              {contractorList.map((c: any) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                                  onClick={() => pickContractor(c)}
                                >
                                  <span className="font-medium">{c.name}</span>
                                  {c.head && <span className="ml-2 text-muted-foreground">{c.head}</span>}
                                  {c.phone && <span className="ml-1 text-muted-foreground">{c.phone}</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </Field>
                      <Field label="预计作业人数" required>
                        <Input type="number" min={1} value={form.operatorCount} onChange={(e) => setK('operatorCount', e.target.value)} placeholder="如 5" />
                      </Field>
                      <Field label="承包商负责人" required><Input value={form.contractorHead} onChange={(e) => setK('contractorHead', e.target.value)} list="rc-contractorHead" placeholder="负责人姓名" /></Field>
                      <Field label="承包商电话" required><Input value={form.contractorPhone} onChange={(e) => setK('contractorPhone', e.target.value)} list="rc-contractorPhone" placeholder="11 位手机号" /></Field>
                      <Field label="管理部门" required>
                        <Select value={form.managementDept} onChange={(e) => { setK('managementDept', e.target.value); setK('managementPerson', ''); }} className="w-full">
                          <option value="">— 请选择 —</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}
                        </Select>
                      </Field>
                      <Field label="现场监护人" required><Input value={form.managementPerson} onChange={(e) => setK('managementPerson', e.target.value)} list="rc-managementPerson" placeholder="监护人姓名" /></Field>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </Section>

          <RecallDatalist />

          {/* 作业内容 */}
          <Section title="作业内容" icon={<ClipboardList size={16} />}>
            <Card>
              <CardContent>
                <Textarea rows={4} value={form.content} onChange={(e) => setK('content', e.target.value)} placeholder="详细描述作业步骤、范围、涉及物料等" />
              </CardContent>
            </Card>
          </Section>

          {/* 危险作业票提交前置：现场检查 + 双监护人签名 */}
          {isHazard && (
            <>
              <Section title="现场检查（提交前必做）" icon={<ShieldCheck size={16} />}>
                <Card>
                  <CardContent className="space-y-3">
                    <div className="space-y-1.5">
                      {[
                        '作业人员资质与证件齐全',
                        '安全防护用品穿戴到位（安全帽/防护用品等）',
                        '应急设施与消防器材已就位',
                        '现场环境条件符合作业要求',
                      ].map((it) => (
                        <label key={it} className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: 'var(--foreground)' }}>
                          <input type="checkbox" checked={!!inspectItems[it]} onChange={(e) => setInspectItems((p) => ({ ...p, [it]: e.target.checked }))} />
                          {it}
                        </label>
                      ))}
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Field label="检查人"><Input value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="现场检查人姓名" /></Field>
                      </div>
                      <Button
                        disabled={inspectDone}
                        onClick={async () => {
                          if (!inspector.trim()) { setErr('请填写现场检查人'); return; }
                          if (!Object.values(inspectItems).every(Boolean)) { setErr('请勾选全部现场检查项'); return; }
                          try {
                            const appId = await ensureApp();
                            await api.post(`/e-applications/${appId}/inspections`, {
                              inspector: inspector.trim(), result: 'normal', note: '现场检查完成（危险作业票提交前置）',
                            });
                            setInspectDone(true);
                            setErr(''); setMsg('现场检查已提交。');
                          } catch (e: any) {
                            setErr(e.response?.data?.message || '现场检查提交失败');
                          }
                        }}
                      >
                        {inspectDone ? '✓ 现场检查已提交' : '提交现场检查'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </Section>

              <Section title="监护人签名（提交前必做）" icon={<PenLine size={16} />}>
                <Card>
                  <CardContent className="space-y-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {([
                        ['company_guardian', '新波监护人'],
                        ['contractor_guardian', '承包商监护人'],
                      ] as const).map(([role, label]) => {
                        const g = (form.guardianSignatures || []).find((x) => x.role === role);
                        return (
                          <button
                            key={role}
                            type="button"
                            className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm"
                            style={{ borderColor: g ? 'rgba(34,197,94,0.5)' : 'var(--border)', color: 'var(--foreground)' }}
                            onClick={() => setGuardianOpen(role)}
                          >
                            <span>{label}{g && <span className="ml-1 text-xs" style={{ color: 'var(--success)' }}>✓ {g.name}</span>}</span>
                            <PenLine size={15} />
                          </button>
                        );
                      })}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      现场检查完成后，须由新波监护人和承包商监护人分别签名方可提交申请。
                    </div>
                  </CardContent>
                </Card>
              </Section>
            </>
          )}

          {/* 作业步骤 */}
          <Section title="作业步骤" icon={<Plus size={16} />}>
            <Card>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">填写作业步骤，点击「AI 分析」自动生成危害与措施，结果可手动编辑。</p>
                  <Button variant="secondary" size="sm" onClick={addStep}><Plus size={14} className="mr-1" />增加步骤</Button>
                </div>
                <div className="space-y-2">
                  {steps.map((s, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-6 text-center text-xs text-muted-foreground">{i + 1}</span>
                      <Input value={s} onChange={(e) => setStep(i, e.target.value)} placeholder={`第 ${i + 1} 个作业步骤`} />
                      {steps.length > 1 && (
                        <Button variant="ghost" size="sm" onClick={() => removeStep(i)}><X size={14} /></Button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <Button onClick={runJsa} disabled={jsaBusy} style={{ background: accent.t, color: '#fff' }}>
                    <Sparkles size={14} className="mr-1" />{jsaBusy ? '分析中…' : 'AI 分析 JSA'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Section>

          {/* JSA 分析结果（可编辑） */}
          {jsas.length > 0 && (
            <Section title="JSA 分析结果" icon={<Sparkles size={16} />}>
              <Card>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">危害描述 / 控制措施 ≤30 字，具体可执行；风险等级可选 低/中/高/重大。每个单元格可直接编辑。</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="text-muted-foreground border-b border-border">
                          <th className="text-left font-normal py-1.5 pr-2 w-12">步骤</th>
                          <th className="text-left font-normal py-1.5 pr-2 w-1/4">步骤内容</th>
                          <th className="text-left font-normal py-1.5 pr-2 w-1/4">危害描述</th>
                          <th className="text-left font-normal py-1.5 pr-2 w-20">风险等级</th>
                          <th className="text-left font-normal py-1.5 pr-2 w-1/4">控制措施</th>
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {jsas.map((r, i) => (
                          <tr key={i} className="border-b border-border/60 align-top">
                            <td className="py-1.5 pr-2 text-muted-foreground">步骤{i + 1}</td>
                            <td className="py-1.5 pr-2"><Textarea rows={2} value={r.step} onChange={(e) => setJsa(i, 'step', e.target.value)} placeholder="作业步骤" /></td>
                            <td className="py-1.5 pr-2"><Textarea rows={2} value={r.hazard} onChange={(e) => setJsa(i, 'hazard', e.target.value)} placeholder="危害描述（≤30字）" style={{ color: C.red.strong }} /></td>
                            <td className="py-1.5 pr-2">
                              <Select value={r.risk || '中'} onChange={(e) => setJsa(i, 'risk', e.target.value)} className="!h-8 !py-0 !text-xs">
                                {['低', '中', '高', '重大'].map((lv) => <option key={lv} value={lv}>{lv}</option>)}
                              </Select>
                            </td>
                            <td className="py-1.5 pr-2"><Textarea rows={2} value={r.control} onChange={(e) => setJsa(i, 'control', e.target.value)} placeholder="控制措施（≤30字）" style={{ color: C.green.dk }} /></td>
                            <td className="py-1.5">
                              <button className="text-destructive text-xs underline" onClick={() => removeJsa(i)}>删</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Button variant="secondary" size="sm" onClick={addJsa}><Plus size={14} className="mr-1" />手动添加一行</Button>
                </CardContent>
              </Card>
            </Section>
          )}

          {/* 安全措施确认（仅危险作业票；预设项目 + 每条备注） */}
          {isHazard && (
            <Section title="安全措施确认" icon={<ShieldCheck size={16} />}>
              <Card>
                <CardContent className="space-y-3">
                  {!measuresLoaded ? (
                    <div className="py-3 text-center text-xs text-muted-foreground">加载中…</div>
                  ) : allMeasures.filter((m) => m.content).length === 0 ? (
                    <div className="py-3 text-center text-xs text-muted-foreground">暂无预设模板，请直接填写。</div>
                  ) : (
                    <div className="space-y-3">
                      {['pre', 'during', 'post'].map((phase) => {
                        const items = (measures as any)[phase] as MeasureGroup[];
                        const label = phase === 'pre' ? '作业前' : phase === 'during' ? '作业中' : '作业后';
                        if (!items.length) return null;
                        return (
                          <div key={phase}>
                            <div className="mb-2 text-xs font-semibold text-muted-foreground">{label}（{items.length} 项）</div>
                            {items.map((m, i) => (
                              <div key={i} className="flex items-start gap-2 border-b pb-2 mb-2 last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                                <input type="checkbox" checked={m.checked} onChange={(e) => setMeasureChecked(phase as any, i, e.target.checked)} className="mt-1" />
                                <div className="flex-1 space-y-1">
                                  <div className="text-sm">{m.content}</div>
                                  <Input value={m.note || ''} onChange={(e) => setMeasureNote(phase as any, i, e.target.value)} placeholder="补充说明（备注）" className="text-xs" />
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Section>
          )}
        </div>

        {/* ==================== 右列 — 实时预览 ==================== */}
        <div className="space-y-[var(--gap-card)]">
          <Section title="作业类型" icon={<FileText size={16} />}>
            <Card>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">类型：</span><span className="font-medium" style={{ color: isHazard ? C.amber.t : C.blue.t }}>{isHazard ? (t?.label || '—') : '常规作业票'}</span></div>
                <div><span className="text-muted-foreground">性质：</span><StatusPill color={isHazard ? 'orange' : 'green'}>{isHazard ? '危险作业' : '常规'}</StatusPill></div>
                <div><span className="text-muted-foreground">状态：</span><StatusPill color="gray">草稿</StatusPill></div>
                {isHazard && needCert && <div className="text-xs" style={{ color: C.amber.t }}>需上传作业证</div>}
              </CardContent>
            </Card>
          </Section>

          {isHazard && needCert && (
            <Section title="特种作业证" icon={<FileUp size={16} />}>
              <Card>
                <CardContent className="space-y-2">
                  {certs.length > 0 && (
                    <div className="space-y-2">
                      {certs.map((c: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 rounded-lg border p-2 text-xs" style={{ borderColor: 'var(--border)' }}>
                          <span className="flex-1 truncate">{c.fileName || '证书' + (i + 1)}</span>
                          <Button variant="ghost" size="sm" onClick={() => setCerts((prev) => prev.filter((_, j) => j !== i))}><X size={12} /></Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <label className="block cursor-pointer rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground" style={{ borderColor: 'var(--border)' }}>
                    {uploading ? '上传中…' : <><FileUp size={14} className="mr-1 inline" />点击上传证书照片/PDF</>}
                    <input type="file" accept="image/*,.pdf" className="hidden" onChange={async (e) => {
                      if (!e.target.files?.[0]) return;
                      setUploading(true);
                      const fd = new FormData(); fd.append('file', e.target.files[0]);
                      try {
                        const id = await ensureApp();
                        const { data } = await api.post(`/e-permits/${id}/certificate/upload`, fd);
                        setCerts((prev) => [...prev, data]);
                      } catch {}
                      setUploading(false);
                    }} />
                  </label>
                </CardContent>
              </Card>
            </Section>
          )}

          <Section title="审批步骤" icon={<ShieldCheck size={16} />}>
            <Card>
              <CardContent className="space-y-2 text-xs">
                {isHazard ? (
                  <>
                    <div className="flex items-center gap-2"><span className="text-muted-foreground">1</span> 申请部门主管审核</div>
                    <div className="flex items-center gap-2"><span className="text-muted-foreground">2</span> EHS 工程师审批</div>
                    <div className="flex items-center gap-2"><span className="text-muted-foreground">3</span> 工程部经理批准</div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2"><span className="text-muted-foreground">1</span> 区域负责人审核</div>
                    <div className="flex items-center gap-2"><span className="text-muted-foreground">2</span> 承包商管理部门批准</div>
                    <div className="pl-5 text-muted-foreground">批准后抄送 EHS，不经 EHS 审批</div>
                  </>
                )}
              </CardContent>
            </Card>
          </Section>

          {!isHazard && (
            <Section title="申请信息" icon={<Info size={16} />}>
              <Card>
                <CardContent>
                  <p className="text-xs text-muted-foreground">提交后将生成常规作业票，审批人在「作业票管理」中处理。常规作业票的现场安全措施将在交底环节确认，无需在申请时填写。</p>
                </CardContent>
              </Card>
            </Section>
          )}
        </div>
      </div>

      {/* 监护人签名弹窗 */}
      {guardianOpen && (
        <Modal open title={guardianOpen === 'company_guardian' ? '新波监护人签名' : '承包商监护人签名'} onClose={() => setGuardianOpen(null)} size="md">
          <SignaturePad
            withName
            role={guardianOpen}
            height={180}
            onConfirm={(payload) => {
              setForm((f: any) => ({
                ...f,
                guardianSignatures: [
                  ...(f.guardianSignatures || []).filter((g: any) => g.role !== guardianOpen),
                  { role: guardianOpen, name: payload.name, signImg: payload.signImg, signedAt: new Date().toISOString() },
                ],
              }));
              setGuardianOpen(null);
              setMsg(`${guardianOpen === 'company_guardian' ? '新波监护人' : '承包商监护人'}签名已保存。`);
            }}
            onCancel={() => setGuardianOpen(null)}
          />
        </Modal>
      )}
    </div>
  );
}