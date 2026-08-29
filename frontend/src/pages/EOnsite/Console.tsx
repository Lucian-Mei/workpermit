import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import api, { hasPerm } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, Button, Input, Textarea, Modal, Badge } from '@/components/ui';
import { StatusPill, Section, Tag, Field } from '@/components/kit';
import { SignaturePad } from '@/components/SignaturePad';
import { PhotoUploader } from '@/components/PhotoUploader';
import { WORK_PERMIT_STATUS, WORK_PERMIT_TYPES } from '@/constants';
import {
  Smartphone, ShieldCheck, ClipboardCheck, PenLine, Play, Pause, Ban, CheckCircle,
  Archive, ArrowLeft, Camera, RefreshCw, Trash2, Check, AlertTriangle, Sparkles,
} from 'lucide-react';
import dayjs from 'dayjs';

type Tab = 'briefing' | 'inspection' | 'sign' | 'control';

/* ======================= 移动端分步进度条 ======================= */
function StepRail({
  steps,
  active,
  onPick,
}: {
  steps: { key: Tab; label: string; icon: React.ReactNode; done: boolean }[];
  active: Tab;
  onPick: (t: Tab) => void;
}) {
  const activeIdx = steps.findIndex((s) => s.key === active);
  return (
    <div className="step-rail">
      {steps.map((s, i) => {
        const state = s.key === active ? 'on' : s.done ? 'done' : 'todo';
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onPick(s.key)}
            className={`step-pill ${state}`}
            aria-current={s.key === active ? 'step' : undefined}
          >
            <span className="bar" />
            <span className="lbl">
              <span className="num">{s.done && s.key !== active ? <Check size={11} /> : i + 1}</span>
              <span className="flex items-center gap-1">
                {s.icon}
                <span className="hidden sm:inline">{s.label}</span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function EOnsiteConsole() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const permitParam = params.get('permit');
  const tabParam = params.get('tab');
  const [d, setD] = useState<any>(null);
  const [tab, setTab] = useState<Tab>((tabParam as Tab) || 'briefing');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    // 单表合并：统一按作业票 id 加载（?permit=票id 优先，否则用 /e-onsite/:id）
    const targetId = permitParam || id;
    try {
      const { data: wp } = await api.get(`/e-permits/${targetId}`);
      setD({ ...wp, currentPermit: wp });
    } catch (e: any) {
      setErr(e.response?.data?.message || '加载失败');
    }
  }
  useEffect(() => { load(); }, [id, permitParam]);

  function toast(m: string, isErr = false) {
    if (isErr) { setErr(m); setMsg(''); } else { setMsg(m); setErr(''); }
    setTimeout(() => { setErr(''); setMsg(''); }, 4000);
  }

  if (!d) return <div className="p-6 text-muted-foreground">加载中…</div>;

  // 状态徽章：优先用作业票的实时状态（printed/approved/paused/finished/completed），
  // 仅当作业票未生成或为草稿时才回退到申请单状态（如「待部门审核」）。
  const wpLiveStatus = d.currentPermit?.status;
  const st = (wpLiveStatus && WORK_PERMIT_STATUS[wpLiveStatus])
    ? WORK_PERMIT_STATUS[wpLiveStatus]
    : (WORK_PERMIT_STATUS[d.status] || { label: d.status, color: '#94a3b8' });
  const missingHazard = d.missingHazardPermits || [];
  const canCheck = hasPerm(user, 'epermit:onsite_check');
  const canVoid = hasPerm(user, 'epermit:void');

  const briefingDone = d.briefing?.status === 'done' || d.briefing?.briefedAt;
  const currentPermit = d.currentPermit || null;
  // 暂停/恢复：与后端一致 —— 管理员 / 申请人本人 / 持有 epermit:pause 权限点的人员（安全员等现场干预角色）
  const canPause =
    (!!user && (user.roles?.includes('admin') || user.permissions?.includes('*'))) ||
    hasPerm(user, 'epermit:pause') ||
    d.applicantId === user?.id ||
    currentPermit?.applicantId === user?.id;
  const inspectionDone = currentPermit
    ? (currentPermit.checks?.length || 0) > 0
    : (d.inspections?.length || 0) > 0;
  const signDone = currentPermit
    ? (currentPermit.signatures?.length || 0) > 0
    : !d.involvesHazardous || (d.workPermits || []).every((w: any) => (w.signatures || []).length > 0);
  const controlDone = ['finished', 'completed'].includes(d.status);

  const steps: { key: Tab; label: string; icon: React.ReactNode; done: boolean }[] = [
    { key: 'briefing', label: '安全交底', icon: <ShieldCheck size={14} />, done: !!briefingDone },
    { key: 'inspection', label: '现场巡检', icon: <ClipboardCheck size={14} />, done: !!inspectionDone },
    { key: 'sign', label: '签字确认', icon: <PenLine size={14} />, done: !!signDone },
    { key: 'control', label: '作业控制', icon: <Play size={14} />, done: !!controlDone },
  ];

  return (
    <div className="page-fade mx-auto w-full max-w-4xl space-y-4 px-3 sm:px-0">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate('/e-onsite')}>
          <ArrowLeft size={16} className="mr-1" /> 返回
        </Button>
        <div className="ml-auto">
          <StatusPill color={st.color}>{st.label}</StatusPill>
        </div>
      </div>

      <Card>
        <CardContent className="py-3">
          <div className="flex items-start gap-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius)] bg-primary-soft text-primary">
              <Smartphone size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold leading-snug">{d.jobName || '未命名作业'}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                <span className="">{d.permitNo}</span>
                <br />
                {d.department || '—'}
                {d.location ? ' · ' + d.location : ''}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {err && <div className="rounded-lg bg-destructive/10 p-2.5 text-sm text-destructive">{err}</div>}
      {msg && <div className="rounded-lg bg-success/10 p-2.5 text-sm text-success">{msg}</div>}

      {missingHazard.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">危险作业票未开</div>
            <div className="mt-0.5 text-xs opacity-90">
              以下危险作业尚未开具对应《危险作业许可证》：{missingHazard.map((m: any) => m.label).join('、')}。请尽快在「危险作业票」菜单办理。
            </div>
          </div>
        </div>
      )}

      <StepRail steps={steps} active={tab} onPick={setTab} />

      {tab === 'briefing' && <BriefingTab d={d} canCheck={canCheck} userName={user?.name} reload={load} toast={toast} />}
      {tab === 'inspection' && <InspectionTab d={d} permit={currentPermit} canCheck={canCheck} userName={user?.name} reload={load} toast={toast} />}
      {tab === 'sign' && <SignTab d={d} canCheck={canCheck} reload={load} toast={toast} />}
      {tab === 'control' && (
        <ControlTab d={d} permit={currentPermit} canCheck={canCheck} canPause={canPause} canVoid={canVoid} reload={load} toast={toast} navigate={navigate} />
      )}
    </div>
  );
}

/* 风险 → 推荐控制措施映射（依据 EHS-II-008 作业交底 D03 知识库）。
   用于"已选风险 → 标'推荐'措施"——只标记，不自动勾选，确保人员人工决策。 */
const RISK_TO_CONTROLS: Record<string, string[]> = {
  // ========== 二、作业中存在的危害和潜在事故后果（风险） ==========
  '天气因素（风雨雪雷电等）': ['防风、雨、高温、雪、结冰的措施'],
  '生物危害（虫蛇等）': ['移走（或保护）危险物品及其它受影响物品', '长袖长裤', '防护手套'],
  '附近存放化学品': ['移走（或保护）危险物品及其它受影响物品', 'MSDS', '安全标签', '用容器收集有害物质', '容器密闭', '泄漏预防', '应急冲淋设施', '防护手套', '口罩'],
  '交叉作业': ['与受影响方沟通危害', '把作业区与非作业区隔开（关上门、设立警示带）', '警示标识'],
  '照度不足': ['增加照明'],
  '通道不顺畅': ['保持通道畅通', '整理整洁'],
  '绊倒': ['地面平整', '小心脚下', '整理整洁'],
  '滑倒': ['地面平整', '小心脚下', '整理整洁'],
  '行走失衡（沟槽、台阶、上下站立面落差大）': ['辅助站稳', '小心脚下', '地面平整'],
  '净高不足': ['警示标识', '安全帽'],
  '空间狭窄': ['辅助站稳', '安全帽'],
  // ========== 三、待修设备、设施的危害因素 ==========
  '设备储存的能量和压力': ['排净管线、容器', '能源隔离', '上锁、挂牌（LOTO）', '警示标识'],
  '有害物质': ['MSDS', '安全标签', '用容器收集有害物质', '容器密闭', '泄漏预防', '应急冲淋设施', '防护手套', '口罩', '防护眼镜'],
  '机械伤害（撞、割、挤压、缠绕、卷入）': ['安全防护罩', '设备安全连锁', '防护手套', '多人合作，步调一致'],
  '高温烫伤': ['长袖长裤', '防护手套', '应急冲淋设施'],
  '低温冻伤': ['长袖长裤', '防护手套'],
  '带电体裸露（触电）': ['绝缘', '接地', '漏电保护', '警示标识'],
  '登高操作': ['登高工具牢靠栓固', '辅助站稳', '安全帽'],
  '站立不稳': ['辅助站稳', '地面平整'],
  '姿势受限': ['多人合作，步调一致', '辅助站稳'],
  '尖角利边': ['防护手套', '长袖长裤'],
  '拆装的部件不利抓握': ['防护手套', '轻拿轻放', '多人合作，步调一致'],
  '重量危害': ['使用机械代替人力搬运', '多人合作，步调一致', '轻拿轻放', '防砸鞋'],
  // ========== 四、作业过程的危害因素 ==========
  '人工搬运（挤压、划伤）': ['使用机械代替人力搬运', '多人合作，步调一致', '防护手套'],
  '机械伤害': ['安全防护罩', '设备安全连锁', '防护手套'],
  '电动工具（触电、飞出物、刺伤）': ['绝缘', '接地', '漏电保护', '防护眼镜', '防护手套', '防冲击面屏'],
  '手动工具（砸伤、割伤、擦伤）': ['防护手套', '防护眼镜', '防砸鞋'],
  '使用登高工具': ['登高工具牢靠栓固', '辅助站稳', '安全帽'],
  '使用高压水枪或气体': ['防护眼镜', '防冲击面屏', '长袖长裤', '防护手套'],
  '电气操作（线路接驳、设备安装、检修）': ['绝缘', '接地', '漏电保护', '上锁、挂牌（LOTO）', '警示标识'],
  '切割、打磨（飞屑、断裂物飞出）': ['防冲击面屏', '防护眼镜', '防护手套', '长袖长裤'],
  '物体打击（坍塌、倾倒、掉落）': ['安全帽', '防砸鞋', '警示标识', '物品摆放稳固，朝向正确'],
  '用力过猛或工具使用不当，导致身体失衡、坠落': ['避免用力过猛', '辅助站稳', '多人合作，步调一致'],
  '噪声': ['降低噪声影响'],
  '使用化学品（毒害、腐蚀、易燃）': ['MSDS', '安全标签', '用容器收集有害物质', '泄漏预防', '应急冲淋设施', '防护手套', '口罩', '防护眼镜', '长袖长裤'],
};

/* "其它：" 行：checkbox + 输入框，输入框填写后才视为该行被勾选 */
function OtherItem({ it, canCheck, done, onChange, aiSuggested }: { it: any; gi: number; ii: number; canCheck: boolean; done: boolean; onChange: (checked: boolean, text?: string) => void; aiSuggested?: Set<string> }) {
  const isOther = typeof it.text === 'string' && (it.text.startsWith('其它') || it.text.startsWith('其他'));
  const userInput = isOther ? (it._userInput ?? '') : '';
  // AI 建议（基于作业内容+JSA）：命中且未被勾选时显示"推荐"标
  const suggested = !isOther && !it.checked && aiSuggested?.has(it.text);
  if (!isOther) {
    return (
      <label className={`os-check ${it.checked ? 'done' : ''} ${suggested ? 'border-l-2 border-l-primary/60' : ''}`}>
        <input
          type="checkbox"
          className="mt-0"
          checked={!!it.checked}
          disabled={!canCheck || done}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className={`text-sm ${it.checked ? 'text-foreground' : 'text-muted-foreground'}`}>{it.text}</span>
        {suggested && (
          <span className="ml-1.5 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground shrink-0">
            推荐
          </span>
        )}
      </label>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        className="mt-0"
        checked={!!it.checked}
        disabled={!canCheck || done}
        onChange={(e) => onChange(e.target.checked, userInput)}
      />
      <span className="shrink-0 text-sm text-foreground/80">其它：</span>
      <Input
        value={userInput}
        disabled={!canCheck || done}
        placeholder="请补充"
        className="h-7 text-xs"
        onChange={(e) => {
          const v = e.target.value;
          onChange(v.length > 0, v);
        }}
      />
    </div>
  );
}

/* ======================= 安全交底（现场逐条勾选 + 双方手写签字）======================= */
function BriefingTab({ d, canCheck, userName, reload, toast }: any) {
  const b = d.briefing;
  const [groups, setGroups] = useState<any[]>(b?.points || []);
  const [briefer, setBriefer] = useState(b?.briefer || userName || '');
  // 提交校验错误持续显示在按钮上方，便于用户看清还需改哪一项
  const [submitErr, setSubmitErr] = useState('');
  const [content, setContent] = useState(b?.content || '');
  const [photos, setPhotos] = useState<string[]>(b?.photos || []);
  const [signatures, setSignatures] = useState<Array<any>>(b?.signatures || []);
  const [loadLoading, setLoadLoading] = useState(false);
  const [signOpen, setSignOpen] = useState<null | 'contractor' | 'worker'>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const done = b?.status === 'done';
  // AI 智能识别的建议危害（风险项打"推荐"标）；勾选后该"推荐"标消失
  const [aiHazards, setAiHazards] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const aiSuggested = useMemo(() => new Set(aiHazards), [aiHazards]);
  // 一键选择弹窗：'hazard' = 按 AI 推荐批量勾选危害；'measure' = 按已选风险推荐批量勾选措施
  const [pickOpen, setPickOpen] = useState<null | 'hazard' | 'measure'>(null);

  // 进入交底页自动 AI 识别一次（作业内容 + JSA → 建议危害）
  useEffect(() => {
    if (done) return;
    let cancelled = false;
    (async () => {
      try {
        setAiLoading(true);
        const { data } = await api.post(`/e-permits/${d.id}/briefing/ai-hazards`);
        if (!cancelled && Array.isArray(data?.hazards)) setAiHazards(data.hazards);
      } catch {
        /* AI 识别失败静默，不阻断交底 */
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [d.id, done]);

  // 实时计算"已选风险 → 推荐控制措施"映射（仅标记，不自动勾选）
  const recommendedMap = useMemo(() => {
    const checkedRisks = groups
      .filter((g) => ['env', 'equip', 'process'].includes(g.key))
      .flatMap((g: any) =>
        g.items.filter((it: any) =>
          it.checked && !it.text.startsWith('其它') && !it.text.includes('：') && !it.text.includes(':'),
        ).map((it: any) => it.text),
      );
    const map: Record<string, string[]> = {};
    for (const risk of checkedRisks) {
      for (const ctrl of RISK_TO_CONTROLS[risk] || []) {
        (map[ctrl] = map[ctrl] || []).push(risk);
      }
    }
    return map;
  }, [groups]);

  const contractorSign = signatures.find((s) => s.role === 'contractor');
  const workerSign = signatures.find((s) => s.role === 'worker');
  const workerCount = signatures.filter((s) => s.role === 'worker' && s.signImg).length;

  // 进入交底页即按申请单第3步自动带出预设清单（无需点击）
  useEffect(() => {
    if (groups.length === 0 && !done) {
      (async () => {
        setLoadLoading(true);
        try {
          const { data } = await api.post(`/e-permits/${d.id}/briefing/generate`);
          setGroups(data.groups || []);
        } catch {
          /* 载入失败不阻断，空态可重试 */
        } finally {
          setLoadLoading(false);
        }
      })();
    }
  }, []);

  async function reloadPreset() {
    setLoadLoading(true);
    try {
      const { data } = await api.post(`/e-permits/${d.id}/briefing/generate`);
      setGroups(data.groups || []);
    } catch (e: any) {
      toast(e.response?.data?.message || '载入失败', true);
    } finally {
      setLoadLoading(false);
    }
  }

  function setItem(groupIdx: number, itemIdx: number, patch: any) {
    setGroups((arr) => arr.map((g, gi) => {
      if (gi !== groupIdx) return g;
      return { ...g, items: g.items.map((it: any, ii: number) => (ii === itemIdx ? { ...it, ...patch } : it)) };
    }));
  }

  // 「本次涉及的危险作业」：无危险作业 与 具体危险作业 互斥；具体危险作业之间可多选
  function onHazardCheck(groupIdx: number, itemIdx: number, checked: boolean) {
    setGroups((arr) => arr.map((g, gi) => {
      if (gi !== groupIdx || g.key !== 'hazard_types') return g;
      const isNone = g.items[itemIdx].text === '无危险作业';
      return {
        ...g,
        items: g.items.map((it: any, ii: number) => {
          if (ii === itemIdx) return { ...it, checked };
          if (isNone) {
            // 勾选「无危险作业」→ 清空所有具体危险作业；取消「无危险作业」→ 不动其余
            return it.text === '无危险作业' ? it : { ...it, checked: false };
          }
          // 勾选具体危险作业 → 仅清空「无危险作业」，其余危险作业保留（支持同时勾选多种）
          return it.text === '无危险作业' ? { ...it, checked: false } : it;
        }),
      };
    }));
  }

  async function saveDraft() {
    try {
      await api.put(`/e-permits/${d.id}/briefing`, { groups, signatures, briefer, content, photos });
      toast('交底内容已保存。');
      reload();
    } catch (e: any) {
      toast(e.response?.data?.message || '保存失败', true);
    }
  }

  // 一键选择危害：把 AI 推荐的危害（aiHazards）批量勾选到三组风险项
  function pickAllHazards() {
    setGroups((arr) => arr.map((g) => {
      if (!['env', 'equip', 'process'].includes(g.key)) return g;
      return {
        ...g,
        items: g.items.map((it: any) =>
          aiHazards.includes(it.text) ? { ...it, checked: true } : it,
        ),
      };
    }));
    setPickOpen(null);
    toast(`已按推荐勾选 ${aiHazards.length} 项危害。`);
  }

  // 一键选择措施：把已选风险匹配到的推荐措施批量勾选
  function pickAllMeasures() {
    const recTexts = Object.keys(recommendedMap);
    setGroups((arr) => arr.map((g) => {
      if (g.key !== 'measures') return g;
      return {
        ...g,
        items: g.items.map((it: any) =>
          recTexts.includes(it.text) ? { ...it, checked: true } : it,
        ),
      };
    }));
    setPickOpen(null);
    toast(`已按推荐勾选 ${recTexts.length} 项控制措施。`);
  }

  function validate(): string | null {
    for (const g of groups) {
      if (g.mode === 'choice') {
        for (const it of g.items || []) {
          if (!it.status) return `「${g.title}」中的「${it.text}」未选择 正常/异常`;
        }
      } else if (g.key === 'hazard_types') {
        // 本次涉及的危险作业：至少勾选一项（「无危险作业」或具体危险作业）
        if (!(g.items || []).some((it: any) => it.checked)) {
          return `请在「${g.title}」中至少勾选一项（如不涉及危险作业，请勾选「无危险作业」）`;
        }
      } else if (['env', 'equip', 'process'].includes(g.key)) {
        // 三组风险：允许部分勾选，但至少勾选一项
        if (!(g.items || []).some((it: any) => it.checked)) {
          return `请在「${g.title}」中至少勾选一项`;
        }
      } else if (g.key === 'measures') {
        // 控制措施：至少勾选一项（可手动取消部分匹配项）
        if (!(g.items || []).some((it: any) => it.checked)) {
          return '请至少保留一项风险控制措施';
        }
      }
    }
    if (!contractorSign?.signImg) return '请采集承包商（负责人/作业人员）手写签名';
    const workerCount = signatures.filter((s) => s.role === 'worker' && s.signImg).length;
    if (workerCount < 1) return '请至少采集 1 位作业人员手写签名';
    return null;
  }

  async function submit() {
    const err = validate();
    if (err) { setSubmitErr(err); toast(err, true); return; }
    setSubmitErr('');
    try {
      await api.post(`/e-permits/${d.id}/briefing/submit`, { groups, signatures, briefer, content, photos });
      toast('现场交底已完成提交。');
      reload();
    } catch (e: any) {
      const m = e.response?.data?.message || '提交失败';
      setSubmitErr(m);
      toast(m, true);
    }
  }

  return (
    <div className="space-y-4">
      {done && (
        <div className="flex items-center gap-2 rounded-lg bg-success/10 p-2.5 text-sm text-success">
          <CheckCircle size={15} /> 该作业的安全交底已完成（{b.briefedAt ? dayjs(b.briefedAt).format('MM-DD HH:mm') : ''}）
        </div>
      )}

      <Section title="现场安全交底" icon={<ShieldCheck size={16} />}
        action={loadLoading ? <span className="text-xs text-muted-foreground">正在带出预设…</span> : undefined}
      >
        <Card>
          <CardContent className="space-y-4">
            {groups.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                {loadLoading ? '正在按申请单第3步自动带出预设交底清单…' : (
                  <>未能自动带出预设清单，<button className="underline" onClick={reloadPreset}>点击重试</button>。</>
                )}
              </div>
            ) : (
              <>
                {/* 顶部：一、本次涉及的危险作业（独立整行） */}
                {groups.map((g, gi) => {
                  if (g.key !== 'hazard_types') return null;
                  const noneChecked = g.items.some((i: any) => i.text === '无危险作业' && i.checked);
                  return (
                    <div key={g.key}>
                      <div className="mb-1.5 text-sm font-semibold text-foreground">一、本次涉及的危险作业</div>
                      <div className="space-y-1">
                        {g.items.map((it: any, ii: number) => {
                          const hazardDisabled = it.text !== '无危险作业' && noneChecked;
                          return (
                            <label key={ii} className={`os-check ${it.checked ? 'done' : ''} ${it.text === '无危险作业' ? 'os-check-none' : ''} ${hazardDisabled ? 'opacity-50' : ''}`}>
                              <input
                                type="checkbox"
                                className="mt-0"
                                checked={!!it.checked}
                                disabled={!canCheck || done || hazardDisabled}
                                onChange={(e) => onHazardCheck(gi, ii, e.target.checked)}
                              />
                              <span className={`text-sm ${it.checked ? 'text-foreground' : 'text-muted-foreground'}`}>{it.text}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* 单列：二、风险分析（1./2./3.）→ 已选风险 → 三、风险控制措施 */}
                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">二、作业中存在的危害和潜在事故后果（风险）</span>
                    {!done && canCheck && (
                      <Button size="sm" variant="outline" onClick={() => setPickOpen('hazard')} disabled={aiHazards.length === 0}>
                        <Sparkles size={13} className="mr-1" /> 一键选择危害
                      </Button>
                    )}
                  </div>
                  {groups.map((g, gi) => {
                    if (!['env', 'equip', 'process'].includes(g.key)) return null;
                    const subMap: Record<string, string> = {
                      env: '1. 工作环境危害因素',
                      equip: '2. 待修设备、设施的危害因素',
                      process: '3. 作业过程的危害因素',
                    };
                    return (
                      <div key={g.key}>
                        <div className="mb-1 text-xs font-medium text-foreground/80 sm:text-sm">{subMap[g.key]}</div>
                        <div className="space-y-1">
                          {g.items.map((it: any, ii: number) => (
                            <OtherItem
                              key={ii}
                              it={it}
                              gi={gi}
                              ii={ii}
                              canCheck={!!canCheck}
                              done={done}
                              aiSuggested={aiSuggested}
                              onChange={(checked, text) => setItem(gi, ii, { checked, ...(text !== undefined ? { text } : {}) })}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {/* 已选风险列表（实时显示三组风险中勾选的项） */}
                  <div className="rounded-md border border-border bg-muted/30 p-2">
                    <div className="mb-1 text-xs font-medium text-foreground/80 sm:text-sm">已选风险</div>
                    {(() => {
                      const riskGroups = groups.filter((g) => ['env', 'equip', 'process'].includes(g.key));
                      const checkedAll = riskGroups.flatMap((g: any) =>
                        g.items.filter((it: any) => it.checked && !it.text.startsWith('其它') && !it.text.includes('：') && !it.text.includes(':'))
                      );
                      if (checkedAll.length === 0) {
                        return <div className="text-xs text-muted-foreground">请在上方勾选风险项</div>;
                      }
                      const groupsByKey: Record<string, any[]> = {};
                      riskGroups.forEach((g: any) => {
                        const items = g.items.filter((it: any) => it.checked && !it.text.startsWith('其它') && !it.text.includes('：') && !it.text.includes(':'));
                        if (items.length > 0) groupsByKey[g.key] = items;
                      });
                      const subMap: Record<string, string> = {
                        env: '1. 工作环境危害因素',
                        equip: '2. 待修设备、设施的危害因素',
                        process: '3. 作业过程的危害因素',
                      };
                      return (
                        <div className="space-y-2">
                          {Object.entries(groupsByKey).map(([key, items]) => (
                            <div key={key} className="text-xs">
                              <div className="mb-1 text-foreground/70">{subMap[key].replace(/^\d+\.\s*/, '')}</div>
                              <div className="flex flex-wrap gap-1.5">
                                {items.map((it: any, idx: number) => (
                                  <span
                                    key={idx}
                                    className="inline-flex items-center rounded-md border border-primary/30 bg-primary-soft px-2 py-0.5 text-[11px] text-foreground"
                                  >
                                    {it.text}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* 控制措施清单（放在作业过程的危害因素下面） */}
                  {groups.map((g, gi) => {
                    if (g.key !== 'measures') return null;
                    return (
                      <div key={g.key}>
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-foreground">三、风险控制措施</span>
                          {!done && canCheck && (
                            <Button size="sm" variant="outline" onClick={() => setPickOpen('measure')} disabled={Object.keys(recommendedMap).length === 0}>
                              <Sparkles size={13} className="mr-1" /> 一键选择措施
                            </Button>
                          )}
                        </div>
                        <div className="space-y-1">
                          {g.items.map((it: any, ii: number) => {
                            const sources = recommendedMap[it.text] || [];
                            // 勾选后"推荐"标消失
                            const matched = sources.length > 0 && !it.checked;
                            const tip = matched
                              ? `推荐用于：${sources.slice(0, 3).join('、')}${sources.length > 3 ? '…' : ''}`
                              : '';
                            return (
                              <label
                                key={ii}
                                title={tip}
                                className={`os-check ${it.checked ? 'done' : ''} ${matched ? 'border-l-2 border-l-primary/60' : ''}`}
                              >
                                <input
                                  type="checkbox"
                                  className="mt-0"
                                  checked={!!it.checked}
                                  disabled={!canCheck || done}
                                  onChange={(e) => setItem(gi, ii, { checked: e.target.checked })}
                                />
                                <span className={`text-sm ${it.checked ? 'text-foreground' : 'text-muted-foreground'}`}>{it.text}</span>
                                {matched && (
                                  <span className="ml-1.5 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground shrink-0">
                                    推荐
                                  </span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 底部：设备、工具检查结果（无"六、"） */}
                {groups.map((g, gi) => {
                  if (g.key !== 'tool_checks') return null;
                  return (
                    <div key={g.key}>
                      <div className="mb-1.5 text-sm font-semibold text-foreground">设备、工具检查结果</div>
                      <div className="space-y-1">
                        {g.items.map((it: any, ii: number) => {
                          const isOther = it.text?.includes('其它') || it.text?.includes('其他');
                          if (isOther) {
                            // 其它项：可输入填空（设备/工具其它类型）
                            return (
                              <div key={ii} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
                                <span className="text-sm shrink-0">{it.text}</span>
                                <Input
                                  value={it._userInput ?? ''}
                                  disabled={!canCheck || done}
                                  placeholder="请补充"
                                  className="h-7 text-xs"
                                  onChange={(e) => setItem(gi, ii, { _userInput: e.target.value })}
                                />
                              </div>
                            );
                          }
                          return (
                            <div key={ii} className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5">
                              <span className="text-sm">{it.text}</span>
                              <div className="flex shrink-0 gap-1">
                                {(['normal', 'abnormal'] as const).map((st) => (
                                  <button
                                    key={st}
                                    type="button"
                                    disabled={!canCheck || done}
                                    onClick={() => setItem(gi, ii, { status: st })}
                                    className={`rounded px-2 py-0.5 text-xs ${
                                      it.status === st
                                        ? st === 'normal' ? 'bg-success text-success-foreground' : 'bg-destructive text-destructive-foreground'
                                        : 'border border-border text-muted-foreground'
                                    }`}
                                  >
                                    {st === 'normal' ? '正常' : '异常'}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </CardContent>
        </Card>
      </Section>

      <Field label="交底人（承包商管理部门人员）">
        <Input value={briefer} disabled placeholder="系统自动填入当前登录人" />
      </Field>

      <Field label="补充说明（可选）">
        <Textarea rows={2} value={content} onChange={(e) => setContent(e.target.value)} disabled={!canCheck || done} placeholder="现场特殊风险提示等" />
      </Field>

      <Field label="现场交底照片">
        {done ? (
          <PhotoView photos={photos} />
        ) : (
          <PhotoUploader photos={photos} onChange={setPhotos} label="拍摄交底现场" />
        )}
      </Field>

      {/* 现场签字：仅承包商（负责人/作业人员）手写签名，无需管理部门签字 */}
      <Section title="现场签字确认（承包商负责人）" icon={<PenLine size={16} />}>
        <Card>
          <CardContent className="space-y-3">
            <div className="rounded-lg border border-border p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium">承包商（负责人/作业人员）签字</span>
                {!done && canCheck && (
                  <Button size="sm" variant="ghost" onClick={() => setSignOpen('contractor')}>手写签名</Button>
                )}
              </div>
              {contractorSign?.signImg ? (
                <div className="flex items-center gap-3">
                  <img src={contractorSign.signImg} alt="" className="h-14 rounded bg-white" />
                  <span className="text-xs text-success">已签字</span>
                  {!done && canCheck && (
                    <button className="ml-auto text-xs text-destructive" onClick={() => setSignatures((arr) => arr.filter((s) => s.role !== 'contractor'))}>重签</button>
                  )}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">尚未采集手写签名。</div>
              )}
            </div>

            {/* 作业人员签字：支持多人轮流签字（勾选后保留，可继续签下一个人） */}
            <div className="rounded-lg border border-border p-3">
              <div className="mb-1.5 text-xs text-foreground/80">
                我已理解并遵守以上作业安全的相关事项。
              </div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">作业人员签字（{signatures.filter((s) => s.role === 'worker' && s.signImg).length} 人）：</span>
                {!done && canCheck && (
                  <Button size="sm" variant="ghost" onClick={() => setSignOpen('worker')}>+ 新增签字</Button>
                )}
              </div>
              {signatures.filter((s) => s.role === 'worker').length === 0 ? (
                <div className="text-xs text-muted-foreground">尚未采集作业人员签字（至少 1 人）</div>
              ) : (
                <div className="space-y-2">
                  {signatures.map((sig, idx) => {
                    if (sig.role !== 'worker') return null;
                    const realIdx = signatures.indexOf(sig);
                    return (
                      <div key={realIdx} className="flex items-center gap-3 rounded-md border border-border p-2">
                        <img src={sig.signImg} alt="" className="h-12 rounded bg-white" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">作业人员 {idx + 1}</div>
                          <div className="text-xs text-muted-foreground">
                            {sig.signImg ? '已签字' : '未签字'}
                          </div>
                        </div>
                        {!done && canCheck && (
                          <button
                            className="text-xs text-destructive"
                            onClick={() => setSignatures((arr) => arr.filter((s, i) => i !== realIdx))}
                          >
                            删除
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </Section>

      {canCheck && !done && (
        <>
          {submitErr && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">尚不能提交</div>
                <div className="mt-0.5 text-xs opacity-90">{submitErr}</div>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="h-11 flex-1" onClick={saveDraft}>暂存</Button>
            <Button className="h-11 flex-1" onClick={() => setConfirmOpen(true)}>
              <CheckCircle size={16} className="mr-1" /> 完成交底
            </Button>
          </div>
        </>
      )}

      <Modal open={signOpen === 'contractor'} title="承包商手写签名" onClose={() => setSignOpen(null)} size="md">
        <SignaturePad
          role="contractor"
          withName={false}
          onConfirm={(payload) => {
            setSignatures((arr) => [
              ...arr.filter((s) => s.role !== 'contractor'),
              { role: 'contractor', name: '承包商（负责人/作业人员）', signImg: payload.signImg },
            ]);
            setSignOpen(null);
          }}
          onCancel={() => setSignOpen(null)}
        />
      </Modal>

      <Modal open={signOpen === 'worker'} title="作业人员手写签名" onClose={() => setSignOpen(null)} size="md">
        <SignaturePad
          role="worker"
          withName={false}
          onConfirm={(payload) => {
            // 多人签字：append 到数组（不替换同名），但替换最后一条未签字的占位
            setSignatures((arr) => [...arr, { role: 'worker', name: '作业人员', signImg: payload.signImg }]);
            setSignOpen(null);
          }}
          onCancel={() => setSignOpen(null)}
        />
      </Modal>

      <Modal open={confirmOpen} title="确认提交交底" onClose={() => setConfirmOpen(false)} size="md">
        <div className="space-y-3">
          <div className="rounded-md bg-muted/40 p-3 text-sm">
            确认作业人员为 <b className="text-primary">{workerCount}</b> 人，均已完成签字。
          </div>
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
            ⚠ 提交后作业票将进入"已交底"状态，不能再修改勾选项。请确认所有风险已正确识别。
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmOpen(false)}>取消</Button>
            <Button className="flex-1" onClick={() => { setConfirmOpen(false); submit(); }}>
              <CheckCircle size={16} className="mr-1" /> 确认完成交底
            </Button>
          </div>
        </div>
      </Modal>

      {/* 一键选择危害：列出 AI 推荐的危害，用户确认后批量勾选 */}
      <Modal open={pickOpen === 'hazard'} title="一键选择推荐危害" onClose={() => setPickOpen(null)} size="lg">
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            以下危害基于作业内容与 JSA 分析智能推荐（{aiHazards.length} 项）。确认后将自动勾选，也可只保留需要的项。
          </p>
          {(() => {
            const subMap: Record<string, string> = {
              env: '1. 工作环境危害因素',
              equip: '2. 待修设备、设施的危害因素',
              process: '3. 作业过程的危害因素',
            };
            return groups
              .filter((g) => ['env', 'equip', 'process'].includes(g.key))
              .map((g) => {
                const hits = g.items.filter((it: any) => aiHazards.includes(it.text));
                if (hits.length === 0) return null;
                return (
                  <div key={g.key}>
                    <div className="mb-1 text-xs font-medium text-foreground/80">{subMap[g.key]}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {hits.map((it: any) => (
                        <span key={it.text} className="inline-flex items-center rounded-md border border-primary/30 bg-primary-soft px-2 py-1 text-xs text-foreground">
                          <Check size={12} className="mr-1 text-primary" /> {it.text}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              });
          })()}
          {aiHazards.length === 0 && (
            <div className="py-4 text-center text-xs text-muted-foreground">暂无可推荐的危害（可先完成 AI 分析 JSA 后重新进入交底）。</div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setPickOpen(null)}>取消</Button>
            <Button className="flex-1" onClick={pickAllHazards} disabled={aiHazards.length === 0}>
              <Check size={16} className="mr-1" /> 确认勾选 {aiHazards.length} 项
            </Button>
          </div>
        </div>
      </Modal>

      {/* 一键选择措施：列出已选风险匹配的推荐措施，确认后批量勾选 */}
      <Modal open={pickOpen === 'measure'} title="一键选择推荐措施" onClose={() => setPickOpen(null)} size="lg">
        <div className="space-y-3">
          {(() => {
            const recTexts = Object.keys(recommendedMap);
            return (
              <>
                <p className="text-xs text-muted-foreground">
                  以下措施基于左侧已勾选风险自动匹配推荐（{recTexts.length} 项）。确认后将自动勾选，也可只保留需要的项。
                </p>
                {recTexts.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {recTexts.map((t) => (
                      <span key={t} className="inline-flex items-center rounded-md border border-primary/30 bg-primary-soft px-2 py-1 text-xs text-foreground">
                        <Check size={12} className="mr-1 text-primary" /> {t}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="py-4 text-center text-xs text-muted-foreground">暂无可推荐的措施（请先在左侧勾选风险）。</div>
                )}
              </>
            );
          })()}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setPickOpen(null)}>取消</Button>
            <Button className="flex-1" onClick={pickAllMeasures} disabled={Object.keys(recommendedMap).length === 0}>
              <Check size={16} className="mr-1" /> 确认勾选 {Object.keys(recommendedMap).length} 项
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ======================= 巡检记录（支持票级：permit 存在时按作业票记录）======================= */
function InspectionTab({ d, permit, canCheck, userName, reload, toast }: any) {
  const list = permit ? permit.checks || [] : d.inspections || [];
  const [inspector, setInspector] = useState(userName || '');
  const [result, setResult] = useState<'normal' | 'abnormal'>('normal');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string[]>([]);
  const [ocrLoading, setOcrLoading] = useState(false);

  async function add() {
    try {
      if (permit) {
        // 票级现场检查（常规/危险作业各自记录）
        await api.post(`/e-permits/${permit.id}/checks`, {
          checkerName: inspector,
          checkItems: { result: result === 'normal' },
          checkPhoto: photo[0],
          note,
        });
      } else {
        await api.post(`/e-permits/${d.id}/inspections`, {
          inspector, result, note, photo: photo[0],
        });
      }
      toast('巡检记录已提交。');
      setNote(''); setPhoto([]); setResult('normal');
      reload();
    } catch (e: any) {
      toast(e.response?.data?.message || '提交失败', true);
    }
  }

  async function uploadOcr(files: FileList | null) {
    if (!files || !files.length) return;
    setOcrLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', files[0]);
      const { data } = await api.post(`/e-permits/${d.id}/inspections/ocr`, fd);
      toast(data.message || '扫描件已上传。');
      reload();
    } catch (e: any) {
      toast(e.response?.data?.message || 'OCR 上传失败', true);
    } finally {
      setOcrLoading(false);
    }
  }

  async function removeInsp(inspId: string) {
    if (!confirm('删除该巡检记录？')) return;
    try {
      await api.delete(`/e-permits/${d.id}/inspections/${inspId}`);
      reload();
    } catch (e: any) {
      toast(e.response?.data?.message || '删除失败', true);
    }
  }

  return (
    <div className="space-y-4">
      {canCheck && (
        <Section
          title={permit ? `新增现场检查（${permit.isHazardous ? '危险作业' : '常规作业'}·${permit.permitNo || ''}）` : '新增巡检记录（现场拍照）'}
          icon={<ClipboardCheck size={16} />}
        >
          <Card>
            <CardContent className="space-y-3">
              <Field label="检查人">
                <Input value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="检查人姓名" />
              </Field>
              <Field label="检查结果">
                <div className="flex gap-2">
                  <Button className={`h-11 flex-1 ${result === 'normal' ? 'bg-primary text-primary-foreground' : 'border border-border bg-transparent text-foreground hover:bg-muted'}`} onClick={() => setResult('normal')}>正常</Button>
                  <Button className={`h-11 flex-1 ${result === 'abnormal' ? 'bg-destructive text-destructive-foreground' : 'border border-border bg-transparent text-foreground hover:bg-muted'}`} onClick={() => setResult('abnormal')}>异常</Button>
                </div>
              </Field>
              <Field label="备注">
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="现场情况说明" />
              </Field>
              <Field label="现场照片">
                <PhotoUploader photos={photo} onChange={setPhoto} max={1} label="拍摄巡检现场" />
              </Field>
              <div className="flex gap-2">
                <Button className="h-11 flex-1" onClick={add}><Camera size={16} className="mr-1" /> 提交检查</Button>
                {!permit && (
                  <label className="inline-flex">
                    <Button type="button" variant="outline" className="h-11" disabled={ocrLoading}>
                      <RefreshCw size={16} className="mr-1" /> {ocrLoading ? '识别中…' : '上传纸质扫描(OCR)'}
                    </Button>
                    <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => uploadOcr(e.target.files)} />
                  </label>
                )}
              </div>
            </CardContent>
          </Card>
        </Section>
      )}

      <Section title={`检查记录（${list.length}）`} icon={<ClipboardCheck size={16} />}>
        <Card>
          <CardContent className="space-y-2">
            {list.length === 0 && <div className="py-3 text-center text-xs text-muted-foreground">暂无检查记录。</div>}
            {list.map((r: any) => (
              <div key={r.id} className="flex items-start gap-3 rounded-lg border border-border p-2.5">
                {r.photo && <img src={r.photo} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />}
                {r.checkPhoto && <img src={r.checkPhoto} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={r.result === 'abnormal' ? 'destructive' : 'success'}>
                      {r.result === 'abnormal' ? '异常' : '正常'}
                    </Badge>
                    {r.source === 'ocr' && <Tag color="#8b5cf6">扫描OCR</Tag>}
                    <span className="text-xs text-muted-foreground">
                      {dayjs(r.inspectedAt || r.checkedAt).format('MM-DD HH:mm')}
                    </span>
                  </div>
                  <div className="mt-1 text-sm">{r.inspector || r.checkerName || '—'}</div>
                  {(r.note || r.note === undefined) && <div className="text-xs text-muted-foreground">{r.note}</div>}
                </div>
                {canCheck && !permit && (
                  <button className="text-muted-foreground hover:text-destructive" onClick={() => removeInsp(r.id)}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}

/* ======================= 作业票签字 ======================= */
function SignTab({ d, canCheck, reload, toast }: any) {
  const permits = d.workPermits || [];
  const [signFor, setSignFor] = useState<string | null>(null);

  async function addSign(permitId: string, payload: any) {
    try {
      await api.post(`/e-permits/${permitId}/signatures`, payload);
      setSignFor(null);
      toast('签字已保存。');
      reload();
    } catch (e: any) {
      toast(e.response?.data?.message || '签字失败', true);
    }
  }

  if (!d.involvesHazardous || permits.length === 0) {
    return (
      <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">
        本作业为普通作业，无危险作业票需签字。
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-3">
      {permits.map((w: any) => {
        const t = WORK_PERMIT_TYPES[w.type] || WORK_PERMIT_TYPES.other;
        const wst = WORK_PERMIT_STATUS[w.status] || { label: w.status, color: '#94a3b8' };
        const sigs = (w.signatures as any[]) || [];
        return (
          <Card key={w.id}>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium">{t.label}{t.isHazardous && <Tag color="#ea580c" className="ml-1">特种</Tag>}</div>
                <StatusPill color={wst.color} className="ml-auto">{wst.label}</StatusPill>
              </div>
              <div className="text-xs text-muted-foreground">{w.permitNo}</div>
              {sigs.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {sigs.map((s: any, i: number) => (
                    <div key={i} className="rounded-lg border border-border p-1.5 text-center">
                      <img src={s.signImg} alt="" className="h-12 w-24 object-contain" />
                      <div className="text-[11px]">{s.name || (s.role === 'worker' ? '作业人签字' : s.role || '签字')}</div>
                    </div>
                  ))}
                </div>
              )}
              {canCheck && (
                <Button size="sm" variant="secondary" onClick={() => setSignFor(w.id)}>
                  <PenLine size={14} className="mr-1" /> 添加签字
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Modal open={!!signFor} title="作业票手写签名" onClose={() => setSignFor(null)} size="md">
        {signFor && (
          <SignaturePad
            role="worker"
            withName={false}
            onConfirm={(payload) => addSign(signFor, payload)}
            onCancel={() => setSignFor(null)}
          />
        )}
      </Modal>
    </div>
  );
}

/* ======================= 作业控制 ======================= */
function ControlTab({ d, permit, canCheck, canPause, canVoid, reload, toast, navigate }: any) {
  const [reason, setReason] = useState('');
  const [voidOpen, setVoidOpen] = useState(false);
  const [reopen, setReopen] = useState(true);

  // 单表合并：暂停/恢复/完工/归档统一写回作业票（permit 上下文优先）
  async function act(path: string, body?: any, okMsg?: string) {
    try {
      const base = `/e-permits/${permit?.id || d.id}`;
      const { data } = await api.put(`${base}/${path}`, body || {});
      toast(okMsg || '操作成功。');
      if (data?.newId) { setTimeout(() => navigate(`/e-permits/view/${data.newId}`), 800); }
      reload();
    } catch (e: any) {
      toast(e.response?.data?.message || '操作失败', true);
    }
  }

  const s = permit ? permit.status : d.status;
  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-1 py-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">当前状态</span>
            <StatusPill color={(WORK_PERMIT_STATUS[s] || {}).color}>{(WORK_PERMIT_STATUS[s] || {}).label || s}</StatusPill>
          </div>
          {d.printedAt && <div className="flex justify-between"><span className="text-muted-foreground">开工时间</span><span>{dayjs(d.printedAt).format('MM-DD HH:mm')}</span></div>}
          {d.pausedAt && <div className="flex justify-between"><span className="text-muted-foreground">暂停</span><span>{d.pausedByName} · {dayjs(d.pausedAt).format('MM-DD HH:mm')}</span></div>}
          {d.pauseReason && <div className="text-xs text-warning">暂停原因：{d.pauseReason}</div>}
          {d.finishedAt && <div className="flex justify-between"><span className="text-muted-foreground">完工时间</span><span>{dayjs(d.finishedAt).format('MM-DD HH:mm')}</span></div>}
        </CardContent>
      </Card>

      {s === 'printed' && (
        <>
          {canPause && (
            <Card><CardContent className="space-y-2 py-3">
              <Field label="暂停原因（可选）"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如 天气/交叉作业冲突" /></Field>
              <Button variant="outline" className="h-11 w-full" onClick={() => act('pause', { reason }, '作业已暂停。')}>
                <Pause size={16} className="mr-1" /> 暂停作业
              </Button>
            </CardContent></Card>
          )}
          {canCheck && (
            <Button className="h-11 w-full" onClick={() => act('finish', {}, '已标记完工。')}>
              <CheckCircle size={16} className="mr-1" /> 作业完工
            </Button>
          )}
        </>
      )}

      {s === 'paused' && canPause && (
        <Button className="h-11 w-full" onClick={() => act('resume', {}, '作业已恢复。')}>
          <Play size={16} className="mr-1" /> 恢复作业
        </Button>
      )}

      {s === 'finished' && canCheck && (
        <Button className="h-11 w-full" onClick={() => act('archive', {}, '已归档。')}>
          <Archive size={16} className="mr-1" /> 归档（电子留档）
        </Button>
      )}

      {canVoid && !['voided', 'completed'].includes(s) && (
        <Button variant="destructive" className="h-11 w-full" onClick={() => setVoidOpen(true)}>
          <Ban size={16} className="mr-1" /> 作废作业
        </Button>
      )}

      {d.replacedByPermitNo && (
        <div className="rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
          已作废并重开新票：<span className="">{d.replacedByPermitNo}</span>
        </div>
      )}

      <Modal
        open={voidOpen}
        title="作废作业"
        onClose={() => setVoidOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setVoidOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={() => { setVoidOpen(false); act('void', { reason, reopen }, '已作废。'); }}>确认作废</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="作废原因"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="请填写作废原因，留痕备查" /></Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={reopen} onChange={(e) => setReopen(e.target.checked)} />
            作废后按原内容重开一张新票（生成新票号，留痕）
          </label>
        </div>
      </Modal>
    </div>
  );
}
function PhotoView({ photos }: { photos: string[] }) {
  if (!photos || photos.length === 0) return <div className="text-xs text-muted-foreground">无</div>;
  return (
    <div className="flex flex-wrap gap-2">
      {photos.map((p, i) => <img key={i} src={p} alt="" className="h-16 w-16 rounded-lg border border-border object-cover" />)}
    </div>
  );
}
