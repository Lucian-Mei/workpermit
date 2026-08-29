import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { Button, Input } from '@/components/ui';
import { StatusPill } from '@/components/kit';
import { WORK_PERMIT_STATUS } from '@/constants';
import ContractorBadge from '@/components/ContractorBadge';
import ehsLogo from '@/assets/ehs-logo.png';
import { QRCodeCanvas } from 'qrcode.react';
import {
  LayoutDashboard,
  Pause,
  Play,
  RefreshCw,
  MapPin,
  Maximize,
  Minimize,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Info,
  X,
  Settings,
  Hash,
  Building2,
  Building,
  FolderOpen,
  FileText,
  UserCog,
  User,
  Users,
  Clock,
  AlertTriangle,
  UserPlus,
  UserCheck,
} from 'lucide-react';
import dayjs from 'dayjs';

const BOTTOM_PAGE_SIZE = 8;
const CONFIG_KEY = 'ehs_board_config_v2';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 卡片可选字段定义（jobName / 状态 / 危险作业类型 始终显示，不在此列）
const FIELD_DEFS: Record<string, { label: string; icon: any; render: (a: any) => React.ReactNode }> = {
  permitNo: { label: '作业票号', icon: Hash, render: (a) => <span>{a.permitNo || '—'}</span> },
  projectName: { label: '作业项目', icon: FolderOpen, render: (a) => a.projectName || a.jobName || '—' },
  location: { label: '作业地点', icon: MapPin, render: (a) => a.location || '—' },
  content: {
    label: '作业内容',
    icon: FileText,
    render: (a) => <span className="line-clamp-2">{a.content || '—'}</span>,
  },
  department: { label: '管理部门', icon: Building2, render: (a) => a.department || '—' },
  managementPerson: { label: '管理部门人员', icon: UserCog, render: (a) => a.managementPerson || '—' },
  contractorUnit: { label: '承包商单位', icon: Building, render: (a) => a.contractorUnit || '—' },
  contractorHead: {
    label: '承包商负责人',
    icon: User,
    render: (a) => `${a.contractorHead || '—'}${a.contractorPhone ? `（${a.contractorPhone}）` : ''}`,
  },
  applicantName: { label: '申请人', icon: User, render: (a) => a.applicantName || '—' },
  operatorNames: {
    label: '作业人员',
    icon: Users,
    render: (a) => (Array.isArray(a.operatorNames) && a.operatorNames.length ? a.operatorNames.join('、') : '—'),
  },
  plan: {
    label: '计划时间',
    icon: CalendarDays,
    render: (a) => {
      if (!a.planStart) return '—';
      const wk = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const fmt = (v: string) => (
        <>
          {dayjs(v).format('MM-DD')} {dayjs(v).format('HH:mm')}{' '}
          <span style={{ fontSize: '0.85em', color: C.text }}>{wk[dayjs(v).day()]}</span>
        </>
      );
      const s = fmt(a.planStart);
      const e = a.planEnd ? fmt(a.planEnd) : '';
      return (
        <span>
          {s}
          {e && (
            <>
              <span style={{ color: C.muted }}> ~ </span>
              {e}
            </>
          )}
        </span>
      );
    },
  },
};
const ALL_FIELD_KEYS = Object.keys(FIELD_DEFS);
const DEFAULT_FIELDS = ['permitNo', 'location', 'content', 'department', 'managementPerson', 'contractorUnit', 'contractorHead', 'operatorNames', 'plan'];

// 嵌套危险作业卡片可选字段（精简集，卡片空间有限）
const HAZARD_FIELD_KEYS = ['permitNo', 'location', 'content', 'contractorHead', 'operatorNames', 'plan'];
const DEFAULT_HAZARD_FIELDS = ['permitNo', 'location', 'content', 'plan'];

type BoardConfig = {
  rows: number;
  cols: number;
  fields: string[];
  showPaused: boolean;
  rotateSeconds: number;
  layoutList: Array<[number, number]>;
  refreshSeconds: number;
  hazardFields: string[];
  fontSize: number | 'auto';
};
const DEFAULT_CONFIG: BoardConfig = {
  rows: 3,
  cols: 3,
  fields: DEFAULT_FIELDS,
  showPaused: true,
  rotateSeconds: 45,
  layoutList: [[2, 3], [3, 3], [3, 4], [3, 5]],
  refreshSeconds: 60,
  hazardFields: DEFAULT_HAZARD_FIELDS,
  fontSize: 'auto',
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
function loadConfig(): BoardConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      const fields = Array.isArray(c.fields) ? c.fields.filter((k: string) => ALL_FIELD_KEYS.includes(k)) : DEFAULT_FIELDS;
      const hazardFields = Array.isArray(c.hazardFields) ? c.hazardFields.filter((k: string) => HAZARD_FIELD_KEYS.includes(k)) : DEFAULT_HAZARD_FIELDS;
      return {
        rows: clamp(Number(c.rows) || 3, 2, 4),
        cols: clamp(Number(c.cols) || 3, 3, 5),
        fields: fields.length ? fields : DEFAULT_FIELDS,
        showPaused: c.showPaused !== false,
        rotateSeconds: clamp(Number(c.rotateSeconds) || 45, 0, 660),
        layoutList: Array.isArray(c.layoutList) ? c.layoutList : DEFAULT_CONFIG.layoutList,
        refreshSeconds: clamp(Number(c.refreshSeconds) || 60, 10, 600),
        hazardFields: hazardFields.length ? hazardFields : DEFAULT_HAZARD_FIELDS,
        fontSize: c.fontSize === 'auto' || (typeof c.fontSize === 'number' && c.fontSize >= 8 && c.fontSize <= 30) ? c.fontSize : 'auto',
      };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_CONFIG };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ====== 驾驶舱深色主题 ======
const C = {
  bg: '#05070e',
  panel: 'rgba(13,20,38,0.72)',
  panelSolid: '#0b1224',
  border: 'rgba(56,189,248,0.22)',
  borderStrong: 'rgba(56,189,248,0.45)',
  cyan: '#22d3ee',
  blue: '#3b82f6',
  green: '#34d399',
  amber: '#fbbf24',
  red: '#f87171',
  text: '#e6edf6',
  muted: '#93a4c0',
};

/** 透明背景 EHS Logo（盾形 + 十字 + 绿叶），用于监控大屏标题旁 */
function EHSLogo({ size = 132 }: { size?: number }) {
  return (
    <img
      src={ehsLogo}
      alt="EHS"
      width={size}
      height={size}
      className="shrink-0 object-contain"
      style={{
        filter: `
          drop-shadow(0 0 2px rgba(255,255,255,0.95))
          drop-shadow(0 0 6px rgba(255,255,255,0.75))
          drop-shadow(0 0 12px rgba(255,255,255,0.45))
          drop-shadow(0 0 20px rgba(255,255,255,0.25))
        `,
      }}
    />
  );
}

export default function EBoard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [data, setData] = useState<any>(null);
  const [entryStats, setEntryStats] = useState<{ todayIn: number; inPlant: number }>({ todayIn: 0, inPlant: 0 });
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pauseFor, setPauseFor] = useState<any>(null);
  const [pauseHazards, setPauseHazards] = useState<string[]>([]);
  const [hazardDetail, setHazardDetail] = useState<any>(null);
  const [pauseErr, setPauseErr] = useState('');
  const [reason, setReason] = useState('');
  const [now, setNow] = useState(dayjs());
  const [config, setConfig] = useState<BoardConfig>(loadConfig);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(dayjs(date).startOf('month'));
  useEffect(() => {
    if (datePickerOpen) setPickerMonth(dayjs(date).startOf('month'));
  }, [datePickerOpen, date]);
  // 权限规则：
  //  - 管理员（持有 admin 角色或 * 通配符）可暂停/恢复大屏上任意作业
  //  - 其他人员仅能暂停/恢复「本人申请」的作业（applicantId === 当前登录用户）
  const isAdmin =
    !!user && (Boolean((user as any).roles?.includes('admin')) || Boolean(user.permissions?.includes('*')));
  const canControl = (a: any) => isAdmin || (!!user && a.applicantId === user.id);
  const isToday = date === dayjs().format('YYYY-MM-DD');

  const [topPage, setTopPage] = useState(0);
  const [bottomPage, setBottomPage] = useState(0);

  // 右上角按钮空闲自动隐藏：无操作 4s 后切换为 EHS logo
  const [controlsVisible, setControlsVisible] = useState(true);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data }, entry] = await Promise.all([
        api.get('/e-permits/board/today', { params: { date } }),
        // 入场/签出统计：今日入厂 + 当前在厂（signOutAt 为空）
        api.get('/e-permits/entry-records', { params: { pageSize: 1 } }),
      ]);
      setData(data);
      const s = entry?.data?.stats;
      if (s) setEntryStats({ todayIn: Number(s.todayIn ?? 0), inPlant: Number(s.inPlant ?? 0) });
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  // 实时时钟
  useEffect(() => {
    const t = setInterval(() => setNow(dayjs()), 1000);
    return () => clearInterval(t);
  }, []);

  // 无操作时隐藏右上角按钮，显示 EHS logo
  useEffect(() => {
    const IDLE_MS = 4000;
    const showControls = () => {
      setControlsVisible(true);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setControlsVisible(false), IDLE_MS);
    };
    showControls();
    const events: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, showControls));
    return () => {
      events.forEach((e) => window.removeEventListener(e, showControls));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  const activeItems = useMemo(() => (data?.items || []).filter((a: any) => a.status === 'printed'), [data]);
  const pausedItems = useMemo(() => (data?.items || []).filter((a: any) => a.status === 'paused'), [data]);

  // 自动适配布局：从勾选的 layoutList 中选择最合适的行*列，使页数最少
  const autoLayout = useMemo(() => {
    const n = activeItems.length;
    if (!config.layoutList || config.layoutList.length === 0) return { rows: config.rows, cols: config.cols };
    // 如果没有勾选布局或只有一个，使用第一个
    if (config.layoutList.length === 1) return { rows: config.layoutList[0][0], cols: config.layoutList[0][1] };
    // 计算每个布局的页数，选页数最少的（优先更大的cell数）
    let best = config.layoutList[0];
    let minPages = Math.ceil(n / (best[0] * best[1]));
    for (const [r, c] of config.layoutList) {
      const cells = r * c;
      const pages = Math.ceil(n / cells);
      if (pages < minPages || (pages === minPages && cells > best[0] * best[1])) {
        best = [r, c];
        minPages = pages;
      }
    }
    return { rows: best[0], cols: best[1] };
  }, [activeItems.length, config.layoutList]);

  // 自动字号：根据网格容器 + 布局计算（避免 ResizeObserver 反馈循环导致跳动）
  const gridRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const lastSizeRef = useRef({ w: 0, h: 0 });
  const rafIdRef = useRef(0);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    function measure() {
      if (!gridRef.current) return;
      const rect = gridRef.current.getBoundingClientRect();
      const cardH = autoLayout.rows > 0 ? (rect.height - 12 * (autoLayout.rows - 1)) / autoLayout.rows : rect.height;
      const cardW = autoLayout.cols > 0 ? (rect.width - 12 * (autoLayout.cols - 1)) / autoLayout.cols : rect.width;
      // 只有差异>0.5px才更新，避免因为 sub-pixel 渲染导致无限render
      const diffW = Math.abs(lastSizeRef.current.w - cardW);
      const diffH = Math.abs(lastSizeRef.current.h - cardH);
      if (diffW < 0.5 && diffH < 0.5) return;
      lastSizeRef.current = { w: cardW, h: cardH };
      // requestAnimationFrame 合并同一帧内的多次回调
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = requestAnimationFrame(() => {
        setCardSize({ w: cardW, h: cardH });
        rafIdRef.current = 0;
      });
    }
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    measure();
    return () => { ro.disconnect(); if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current); };
  }, [autoLayout.rows, autoLayout.cols, isFullscreen]);
  // 重新计算时重置差异阈值，确保全屏/布局切换立刻生效
  useEffect(() => { lastSizeRef.current = { w: 0, h: 0 }; }, [autoLayout.rows, autoLayout.cols, isFullscreen]);

  const autoFontSize = useMemo(() => {
    if (cardSize.h <= 20 || cardSize.w <= 20) return { value: 14, capped: false };
    // 核心字段（作业票号/项目/地点/内容）恒显 + 用户配置字段
    const N = Math.max(1, config.fields.length) + 4;
    // 卡片高度扣除：padding(32) + 顶高光(3) + 标题 margin-top(4) + 标签区(16) +
    //   字段前margin(8) + 字段后margin(8) + 底栏(12+8+8) ≈ 100px
    const overhead = 100 + 4 * N; // 每个字段间有 gap
    const usableH = cardSize.h - overhead;
    // 标题占1.2行（可折行）+ 标签1行 + 底栏1行 + N行字段
    const lineCount = 1.2 + 1 + 1 + N;
    const fs = usableH / (lineCount * 1.35);
    // 宽度也校准：每行至少容纳 12 个汉字（≈ 0.6em每个），label+icon约 90px
    // label+icon约 96px（6rem + 图标 + gap），加大左侧标题列
    const labelW = Math.min(cardSize.w * 0.36, 96);
    const fieldW = cardSize.w - labelW - 20;
    const charsFit = fieldW / (fs * 0.6);
    const MIN_FS = 8; // 溢出阈值降到 8：只有内容真需要 ≤8px 时才提示（避免正常卡片误报）
    let result: number;
    if (charsFit < 10) {
      const maxFs = fieldW / (10 * 0.6);
      result = Math.round((Math.min(fs, maxFs) - 0.5) * 10) / 10;
    } else {
      result = Math.round((fs - 0.5) * 10) / 10;
    }
    return { value: Math.max(MIN_FS, result), capped: result < MIN_FS };
  }, [cardSize.w, cardSize.h, config.fields.length]);

  const pageSize = autoLayout.rows * autoLayout.cols;
  const topPages = useMemo(() => chunk(activeItems, pageSize), [activeItems, pageSize]);
  const bottomPages = useMemo(() => chunk(pausedItems, BOTTOM_PAGE_SIZE), [pausedItems]);

  // 定时轮播 + 数据刷新
  useEffect(() => {
    if (!isToday) return;
    const t = setInterval(load, (config.refreshSeconds || 60) * 1000);
    return () => clearInterval(t);
  }, [isToday, load, config.refreshSeconds]);

  useEffect(() => {
    setTopPage(0);
  }, [topPages.length]);
  useEffect(() => {
    setBottomPage(0);
  }, [bottomPages.length]);

  useEffect(() => {
    const rotateMs = (config.rotateSeconds || 0) * 1000;
    if (rotateMs <= 0) return;
    if (topPages.length <= 1) return;
    const t = setInterval(() => {
      setTopPage((p) => (topPages.length > 1 ? (p + 1) % topPages.length : p));
      setBottomPage((p) => (bottomPages.length > 1 ? (p + 1) % bottomPages.length : p));
    }, rotateMs);
    return () => clearInterval(t);
  }, [topPages.length, bottomPages.length, config.rotateSeconds]);

  function updateConfig(patch: Partial<BoardConfig>) {
    setConfig((c) => {
      const next = { ...c, ...patch };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
      return next;
    });
  }
  function toggleField(key: string) {
    setConfig((c) => {
      const has = c.fields.includes(key);
      const fields = has ? c.fields.filter((k) => k !== key) : [...c.fields, key];
      const next = { ...c, fields };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
      return next;
    });
  }
  function toggleHazardField(key: string) {
    setConfig((c) => {
      const has = c.hazardFields.includes(key);
      const hazardFields = has ? c.hazardFields.filter((k) => k !== key) : [...c.hazardFields, key];
      const next = { ...c, hazardFields };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
      return next;
    });
  }

  function apiBaseFor() {
    return '/e-permits'; // 看板条目均为 work_permits 作业票（常规/危险），暂停走票级
  }

  async function doPause() {
    if (!pauseFor) return;
    if (!reason.trim()) {
      setPauseErr('请填写暂停原因');
      return;
    }
    setPauseErr('');
    const failed: string[] = [];
    try {
      // 先暂停关联危险作业（常规票暂停前置：其下无进行中危险票），再暂停常规票
      for (const hid of pauseHazards) {
        try {
          await api.put(`${apiBaseFor()}/${hid}/pause`, { reason });
        } catch (e: any) {
          failed.push(e.response?.data?.message || '危险作业暂停失败');
        }
      }
      await api.put(`${apiBaseFor()}/${pauseFor.id}/pause`, { reason });
      setPauseFor(null);
      setReason('');
      setPauseHazards([]);
      setPauseErr('');
      load();
      if (failed.length) {
        alert(`常规作业已暂停，但部分关联危险作业未暂停：\n${failed.join('\n')}`);
      }
    } catch (e: any) {
      setPauseErr(e.response?.data?.message || '暂停失败');
    }
  }
  async function doResume(a: any) {
    try {
      await api.put(`${apiBaseFor()}/${a.id}/resume`);
      load();
    } catch (e: any) {
      alert(e.response?.data?.message || '恢复失败');
    }
  }

  function toggleFullscreen() {
    const el = rootRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const viewDate = dayjs(date);
  // header 卡片：日期贴左 / Logo 标题居中 / 右侧按钮（flex 三段式，日期自然贴左不需 grid 对称）
  const header = (
    <div
      className="flex shrink-0 items-center justify-between gap-4 rounded-2xl px-3 py-3"
      style={{
        background: 'linear-gradient(90deg, rgba(34,211,238,0.10), rgba(59,130,246,0.04) 60%, transparent)',
        border: `1px solid ${C.border}`,
        boxShadow: '0 0 24px rgba(34,211,238,0.08) inset',
      }}
    >
      {/* 左侧：日期（上行） + 时钟（下行），贴左 */}
      <div
        className="flex shrink-0 cursor-pointer flex-col items-start leading-tight"
        onClick={() => setDatePickerOpen(true)}
        title="点击切换日期"
      >
        <div className="flex items-center gap-1.5 text-base font-semibold tabular-nums" style={{ color: '#aebccf' }}>
          <CalendarDays size={16} style={{ color: C.cyan }} />
          {viewDate.format('YYYY-MM-DD')}
          <span className="text-xs font-medium" style={{ color: 'rgba(147,164,192,0.7)' }}>{WEEKDAYS[viewDate.day()]}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-sm font-medium tabular-nums" style={{ color: 'rgba(147,164,192,0.85)' }}>
          <Clock size={13} />
          {now.format('HH:mm:ss')}
        </div>
      </div>

      {/* 居中：透明 EHS Logo + 标题（flex-1 + justify-center 自然居中） */}
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5">
        <div className="flex items-center justify-center gap-3">
          <EHSLogo size={108} />
          <h1
            className="font-black text-3xl md:text-4xl"
            style={{
              letterSpacing: '0.42em',
              paddingRight: '0.42em',
              fontWeight: 900,
              backgroundImage:
                'linear-gradient(90deg, #5eead4 0%, #22d3ee 38%, #e6edf6 72%, #67e8f9 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              color: 'transparent',
              filter: 'drop-shadow(0 2px 12px rgba(34,211,238,0.55))',
            }}
          >
            现场作业监控大屏
          </h1>
        </div>
        {/* 横线光晕：贴近标题（gap-1.5 ≈ 6px） */}
        <div
          className="h-[3px] w-[240px] rounded-full"
          style={{
            background:
              'linear-gradient(90deg, transparent, #22d3ee 30%, #67e8f9 50%, #22d3ee 70%, transparent)',
            boxShadow: '0 0 12px rgba(34,211,238,0.6)',
          }}
        />
      </div>

      <div className="relative w-[300px] justify-self-end">
        <div
          className={`absolute inset-y-0 right-0 flex items-center justify-end gap-2 transition-opacity duration-300 ${
            controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <Button variant="outline" size="sm" onClick={load} style={{ color: C.text, borderColor: C.border }}>
            <RefreshCw size={14} className="mr-1" /> 刷新
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} style={{ color: C.text, borderColor: C.border }} title="看板设置">
            <Settings size={14} className="mr-1" /> 设置
          </Button>
          <Button variant="outline" size="sm" onClick={toggleFullscreen} style={{ color: C.text, borderColor: C.border }}>
            {isFullscreen ? <Minimize size={14} className="mr-1" /> : <Maximize size={14} className="mr-1" />}
            {isFullscreen ? '退出' : '全屏'}
          </Button>
        </div>
        <div
          className={`absolute inset-y-0 right-[25px] flex items-center gap-4 transition-opacity duration-500 ${
            controlsVisible ? 'pointer-events-none opacity-0' : 'opacity-100'
          }`}
        >
          <div className="flex flex-col items-center gap-1">
            <div className="h-[50px] w-[50px] shrink-0">
              <ContractorBadge />
            </div>
            <div className="text-center text-xs leading-tight" style={{ color: 'rgba(147,164,192,0.6)', fontSize: '11px' }}>
              <div>扫码登记</div>
              <div>入厂核验</div>
            </div>
          </div>
          <div className="h-[110px] w-[110px] shrink-0 rounded-lg flex items-center justify-center" style={{ background: 'transparent' }}>
            <QRCodeCanvas value={`${window.location.origin}/public/entry-register`} size={100} level="L" fgColor="#cbd5e1" bgColor="transparent" />
          </div>
        </div>
      </div>
    </div>
  );

  const stats = (
    <div className="grid grid-cols-2 gap-3 shrink-0 md:grid-cols-3 lg:grid-cols-6">
      <StatBox label="当日作业" value={data?.total ?? '—'} color={C.cyan} icon={LayoutDashboard} />
      <StatBox label="进行中" value={data?.running ?? '—'} color={C.green} icon={Play} />
      <StatBox label="已暂停" value={data?.paused ?? '—'} color={C.amber} icon={Pause} />
      {/* 入厂/在厂人员指标（来自入场登记 signOutAt 统计） */}
      <StatBox label="今日入厂人员" value={entryStats.todayIn ?? '—'} color="#38bdf8" icon={UserPlus} />
      <StatBox label="在厂作业人员" value={entryStats.inPlant ?? '—'} color="#34d399" icon={UserCheck} />
      {/* 日期卡片：箭头在卡片内部右上角，hover 卡片时才显示（不需要时隐藏） */}
      <div className="group/date relative">
        <StatBox
          label="查看日期（点击切换）"
          value={date}
          color="#a78bfa"
          icon={CalendarDays}
          onClick={() => setDatePickerOpen(true)}
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity duration-200 group-hover/date:opacity-100">
          <button
            type="button"
            title="前一天"
            onClick={() => setDate(viewDate.subtract(1, 'day').format('YYYY-MM-DD'))}
            className="flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-white/10"
            style={{ color: '#a78bfa' }}
          >
            <ChevronLeft size={20} strokeWidth={3} />
          </button>
          <button
            type="button"
            title="后一天"
            onClick={() => setDate(viewDate.add(1, 'day').format('YYYY-MM-DD'))}
            className="flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-white/10"
            style={{ color: '#a78bfa' }}
          >
            <ChevronRight size={20} strokeWidth={3} />
          </button>
        </div>
      </div>
    </div>
  );

  function JobCard({ a, fontSize = 14 }: { a: any; fontSize?: number }) {
    const st = WORK_PERMIT_STATUS[a.status] || { label: a.status, color: '#94a3b8' };
    const isHazard = a.kind === 'hazard';
    const isRoutine = a.kind === 'routine';
    // 用 fontSize 反推各 Tailwind 字号的等比值（base 14px 为基准）
    const fsClass = `jcf-${String(fontSize).replace('.', '-')}`;
    return (
      <div
        className={`${fsClass} group/job relative flex h-full min-h-0 flex-col rounded-[14px] p-4 border border-[rgba(56,189,248,0.30)] shadow-[0_8px_26px_rgba(0,0,0,0.5),0_0_0_1px_rgba(34,211,238,0.12),inset_0_0_24px_rgba(120,150,200,0.06)] transition-all duration-300 hover:-translate-y-1 hover:border-[rgba(34,211,238,0.6)] hover:shadow-[0_18px_42px_rgba(0,0,0,0.65),0_0_30px_rgba(34,211,238,0.38)]`}
        style={{
          background: 'linear-gradient(160deg, rgba(28,36,56,0.95), rgba(14,19,32,0.97))',
          fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif",
          fontSize: `${fontSize / 16}rem`,
        }}
      >
        {/* 强制子元素按本卡 fontSize 缩放，避开 Tailwind text-* rem 单位覆盖 */}
        <style>{`.${fsClass} * { font-size: inherit !important; line-height: 1.35 !important; }`}</style>
        {/* 常驻顶部类型高光条（绿=常规 / 橙=危险），一眼区分卡片性质 */}
        <div
          className="pointer-events-none absolute inset-x-3 top-0 h-[3px] rounded-full"
          style={{
            background: isHazard
              ? 'linear-gradient(90deg, transparent, rgba(251,191,36,0.95), transparent)'
              : 'linear-gradient(90deg, transparent, rgba(52,211,153,0.95), transparent)',
            boxShadow: isHazard ? '0 0 10px rgba(251,191,36,0.55)' : '0 0 10px rgba(52,211,153,0.55)',
          }}
        />
        {/* 悬浮整体微光罩（保留，悬停才显现） */}
        <div className="pointer-events-none absolute inset-0 rounded-[14px] bg-gradient-to-br from-cyan-400/0 via-cyan-400/[0.03] to-cyan-400/[0.06] opacity-0 transition-opacity duration-300 group-hover/job:opacity-100" />
        <div className="relative z-[1] flex h-full min-h-0 flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="line-clamp-2 font-bold leading-tight transition-[text-shadow] duration-300 group-hover/job:[text-shadow:0_0_14px_rgba(34,211,238,0.5)]" style={{ color: C.text }}>
                {a.jobName || '未命名作业'}
              </span>
              {/* 常规票：作业票号以标签形式打在标题后面；危险票保留作业类型标签 */}
              {isRoutine && (
                <span className="shrink-0 rounded-md px-2 py-0.5 text-xs font-bold" style={{ color: C.green, border: `1px solid ${C.green}`, background: `${C.green}1a` }}>
                  {a.permitNo}
                </span>
              )}
              {isHazard && (
                <span className="shrink-0 rounded-md px-2 py-0.5 text-xs font-bold" style={{ color: C.amber, border: `1px solid ${C.amber}`, background: `${C.amber}1a`, boxShadow: `0 0 10px ${C.amber}55` }}>
                  {a.hazardTypeLabel || (Array.isArray(a.hazardTypeList) && a.hazardTypeList[0]) || '危险作业'}
                </span>
              )}
            </div>
          </div>
          <StatusPill color={st.color}>{st.label}</StatusPill>
        </div>

        <div className="mt-3 flex-1 flex flex-col justify-center space-y-1 overflow-hidden pr-1">
          {/* 核心字段（permitNo/location/content）始终展示，不受 config.fields 影响；"作业项目"作为默认标题已用 jobName，不再重复 */}
          {['permitNo', 'location', 'content'].map((k) => {
            const def = FIELD_DEFS[k];
            if (!def) return null;
            if (config.fields.includes(k)) return null; // 已在下方按配置渲染
            const Icon = def.icon;
            const isContent = k === 'content';
            return (
              <div key={k} className="flex items-start gap-2" style={{ color: C.muted }}>
                <Icon size={15} className="mt-0.5 shrink-0" style={{ color: C.cyan }} />
                <span className="w-[6rem] shrink-0 opacity-70 text-left whitespace-nowrap overflow-hidden text-ellipsis">{def.label}</span>
                <span
                  className={`min-w-0 flex-1 font-normal text-left break-words overflow-hidden ${isContent ? 'line-clamp-3' : 'text-ellipsis whitespace-nowrap'}`}
                  style={{ color: C.text }}
                  title={String(def.render(a) ?? '')}
                >
                  {def.render(a)}
                </span>
              </div>
            );
          })}
          {config.fields.length === 0 && (
            <div className="text-sm" style={{ color: C.muted }}>
              未选择显示字段（设置中开启）
            </div>
          )}
          {config.fields.filter((k) => k !== 'projectName').map((k) => {
            const def = FIELD_DEFS[k];
            if (!def) return null;
            const Icon = def.icon;
            const isContent = k === 'content';
            return (
              <div key={k} className="flex items-start gap-2" style={{ color: C.muted }}>
                <Icon size={15} className="mt-0.5 shrink-0" style={{ color: C.cyan }} />
                <span className="w-[6rem] shrink-0 opacity-70 text-left whitespace-nowrap overflow-hidden text-ellipsis">{def.label}</span>
                <span
                  className={`min-w-0 flex-1 font-normal text-left break-words overflow-hidden ${isContent ? 'line-clamp-3' : 'text-ellipsis whitespace-nowrap'}`}
                  style={{ color: C.text }}
                  title={String(def.render(a) ?? '')}
                >
                  {def.render(a)}
                </span>
              </div>
            );
          })}
        </div>

        {/* 关联危险作业网格 —— 紧贴"暂停"按钮右侧，字号更小；按钮行压缩 20% */}
        <div className="mt-auto flex shrink-0 items-center gap-1.5 border-t pt-1.5" style={{ borderColor: C.border }}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate(`/e-permits/view/${a.id}`)}
            style={{ color: C.cyan, padding: '2px 8px', height: 26 }}
          >
            <Info size={12} className="mr-0.5" /> 详情
          </Button>
          {canControl(a) && (
            <Button size="sm" variant="ghost" onClick={() => { setPauseFor(a); setReason(''); setPauseErr(''); setPauseHazards((a.hazards || []).filter((h: any) => ['printed', 'paused'].includes(h.status)).map((h: any) => h.id)); }} style={{ color: C.amber, padding: '2px 8px', height: 26 }}>
              <Pause size={12} className="mr-0.5" /> 暂停
            </Button>
          )}
          {/* 关联危险作业网格：≤4 张 grid-cols-2（2×2），>4 张 grid-cols-3（2×3） */}
          {/* 关联危险作业标签：优先一行分布（flex-wrap，放不下自动换行），收缩宽度让位常规内容 */}
          {Array.isArray(a.hazards) && a.hazards.length > 0 && (
            <div
              className="ml-auto flex max-w-[240px] flex-wrap justify-end gap-1"
              title="关联危险作业（鼠标悬停查看详情）"
            >
              {a.hazards.slice(0, 6).map((h: any) => {
                const paused = h.status === 'paused';
                // hover tooltip：按配置字段显示详情（文本化；时间格式与进行中卡片一致）
                const fmtDt = (v?: string) => (v ? `${dayjs(v).format('MM-DD HH:mm')} ${WEEKDAYS[dayjs(v).day()]}` : '—');
                const tip = (config.hazardFields || [])
                  .map((k) => {
                    const def = FIELD_DEFS[k];
                    if (!def) return null;
                    let val = h[k];
                    if (k === 'plan') val = `${fmtDt(h.planStart)} ~ ${fmtDt(h.planEnd)}`;
                    if (val === undefined || val === null) val = '';
                    if (Array.isArray(val)) val = val.join('、');
                    val = String(val);
                    return `${def.label}：${val || '—'}`;
                  })
                  .filter(Boolean)
                  .join('\n');
                return (
                  <div
                    key={h.id}
                    onClick={() => setHazardDetail(h)}
                    className="flex max-w-full cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 transition-colors hover:bg-white/10"
                    style={{
                      borderColor: paused ? 'rgba(249,115,22,0.45)' : 'rgba(251,146,60,0.4)',
                      background: paused ? 'rgba(249,115,22,0.10)' : 'rgba(251,146,60,0.10)',
                    }}
                    title={tip || h.permitNo}
                  >
                    <span className="shrink-0" style={{ color: paused ? C.amber : C.green }}>
                      {paused ? <Pause size={9} /> : <Play size={9} />}
                    </span>
                    <span className="truncate text-[10px] font-medium leading-tight" style={{ color: C.text }}>
                      {h.hazardTypeLabel || '危险作业'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </div>
      </div>
    );
  }

  function PausedCard({ a, fontSize = 14 }: { a: any; fontSize?: number }) {
    const fsClass = `pcf-${String(fontSize).replace('.', '-')}`;
    return (
      <div
        className={`${fsClass} group/paused flex items-center gap-3 rounded-lg px-3 py-2 border border-[rgba(249,115,22,0.3)] transition-all duration-300 hover:-translate-y-0.5 hover:border-[rgba(251,146,60,0.6)] hover:bg-[rgba(249,115,22,0.14)] hover:shadow-[0_8px_22px_rgba(249,115,22,0.22)]`}
        style={{ background: 'rgba(249,115,22,0.08)', fontSize: `${fontSize}px` }}
      >
        <style>{`.${fsClass} * { font-size: inherit !important; line-height: 1.3 !important; }`}</style>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(249,115,22,0.15)', color: C.amber }}>
          <Pause size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" style={{ color: C.text }}>
            {a.jobName || '未命名作业'}
            <span className="ml-2 text-xs font-normal" style={{ color: C.muted }}>
              {a.managementPerson || '—'}
            </span>
          </div>
          <div className="truncate text-xs" style={{ color: C.muted }}>
            作业地点：{a.location || '—'}
          </div>
          <div className="truncate text-xs" style={{ color: C.muted }}>
            {a.permitNo} · 暂停：{a.pauseReason || '未填写原因'}（{a.pausedByName || '—'}）
          </div>
        </div>
        {canControl(a) && (
          <Button size="sm" variant="ghost" onClick={() => doResume(a)} style={{ color: C.green, borderColor: C.border }}>
            <Play size={13} className="mr-1" /> 恢复
          </Button>
        )}
      </div>
    );
  }

  function PageDots({ count, current, onChange }: { count: number; current: number; onChange: (i: number) => void }) {
    if (count <= 1) return null;
    return (
      <div className="flex items-center justify-center gap-1.5 py-1">
        {Array.from({ length: count }).map((_, i) => (
          <button
            key={i}
            onClick={() => onChange(i)}
            className="h-1.5 rounded-full transition-all"
            style={{ width: i === current ? 20 : 6, background: i === current ? C.cyan : 'rgba(147,164,192,0.35)' }}
          />
        ))}
      </div>
    );
  }

  const body = (
    <>
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm" style={{ color: C.muted }}>
          加载中…
        </div>
      ) : activeItems.length === 0 && pausedItems.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-sm" style={{ color: C.muted }}>
          {isToday ? '今日暂无进行中的电子化作业。' : '该日期没有进行中的电子化作业记录。'}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          {/* 进行中 - 主区域（可配置 rows×cols 网格） */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold" style={{ color: C.text }}>
                <Play size={16} style={{ color: C.green }} /> 进行中（{activeItems.length}）
              </div>
              {topPages.length > 1 && (
                <div className="flex items-center gap-1">
                  <button className="rounded p-1 hover:bg-white/10" style={{ color: C.text }} onClick={() => setTopPage((p) => (p - 1 + topPages.length) % topPages.length)}>
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-xs" style={{ color: C.muted }}>
                    {topPage + 1}/{topPages.length}
                  </span>
                  <button className="rounded p-1 hover:bg-white/10" style={{ color: C.text }} onClick={() => setTopPage((p) => (p + 1) % topPages.length)}>
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>
            {topPages.length > 0 ? (
              <>
                <div
                  ref={gridRef}
                  className="grid min-h-0 flex-1 gap-3"
                  style={{ gridTemplateColumns: `repeat(${autoLayout.cols}, minmax(0,1fr))`, gridTemplateRows: `repeat(${autoLayout.rows}, minmax(0,1fr))` }}
                >
                  {topPages[topPage]?.map((a: any) => (
                    <JobCard key={a.id} a={a} fontSize={config.fontSize === 'auto' ? autoFontSize.value : config.fontSize} />
                  ))}
                </div>
                <PageDots count={topPages.length} current={topPage} onChange={setTopPage} />
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm" style={{ color: C.muted }}>
                暂无进行中作业
              </div>
            )}
          </div>

          {/* 已暂停 - 底部缩小区域 */}
          {config.showPaused && pausedItems.length > 0 && (
            <div className="shrink-0 border-t pt-2" style={{ borderColor: C.border }}>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: C.text }}>
                  <Pause size={16} style={{ color: C.amber }} /> 已暂停（{pausedItems.length}）
                </div>
                {bottomPages.length > 1 && (
                  <div className="flex items-center gap-1">
                    <button className="rounded p-1 hover:bg-white/10" style={{ color: C.text }} onClick={() => setBottomPage((p) => (p - 1 + bottomPages.length) % bottomPages.length)}>
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-xs" style={{ color: C.muted }}>
                      {bottomPage + 1}/{bottomPages.length}
                    </span>
                    <button className="rounded p-1 hover:bg-white/10" style={{ color: C.text }} onClick={() => setBottomPage((p) => (p + 1) % bottomPages.length)}>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {bottomPages[bottomPage]?.map((a: any) => (
                  <PausedCard key={a.id} a={a} fontSize={config.fontSize === 'auto' ? autoFontSize.value : config.fontSize} />
                ))}
              </div>
              <PageDots count={bottomPages.length} current={bottomPage} onChange={setBottomPage} />
            </div>
          )}
        </div>
      )}
    </>
  );

  return (
    <div
      ref={rootRef}
      className={`relative flex flex-col gap-4 ${isFullscreen ? 'fixed inset-0 z-50 p-4' : 'page-fade h-[calc(100vh-110px)]'}`}
      style={{
        background: `radial-gradient(1200px 600px at 15% -10%, rgba(34,211,238,0.10), transparent 60%), radial-gradient(1000px 500px at 100% 0%, rgba(59,130,246,0.10), transparent 55%), ${C.bg}`,
        color: C.text,
        backgroundImage: `linear-gradient(rgba(56,189,248,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.04) 1px, transparent 1px)`,
        backgroundSize: '40px 40px, 40px 40px',
      }}
    >
      {header}
      {stats}
      {body}

      {/* 设置抽屉 */}
      {settingsOpen && (
        <div className="absolute inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setSettingsOpen(false)}>
          <div
            className="h-full w-full max-w-sm overflow-auto p-5"
            style={{ background: C.panelSolid, borderLeft: `1px solid ${C.borderStrong}`, boxShadow: '-12px 0 40px rgba(0,0,0,0.5)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-base font-bold" style={{ color: C.text }}>
                <Settings size={18} style={{ color: C.cyan }} /> 看板设置
              </div>
              <button onClick={() => setSettingsOpen(false)} style={{ color: C.muted }}>
                <X size={18} />
              </button>
            </div>

            {/* 自动适配布局 */}
            <section className="mb-5">
              <div className="mb-2 text-sm font-semibold" style={{ color: C.cyan }}>
                自动布局适配
              </div>
              <div className="text-xs mb-2" style={{ color: C.muted }}>
                勾选可选布局，系统自动选最少页数的方案
              </div>
              <div className="flex flex-wrap gap-2">
                {([[2,2],[2,3],[2,4],[3,3],[3,4],[2,5],[3,5]] as Array<[number,number]>).map(([r,c]) => {
                  const checked = (config.layoutList || []).some(([lr,lc]) => lr===r && lc===c);
                  return (
                    <label key={`${r}x${c}`} className="flex cursor-pointer items-center gap-1 text-xs px-2 py-1 rounded border" style={{ color: C.text, borderColor: checked ? C.cyan : C.border, background: checked ? 'rgba(34,211,238,0.12)' : 'transparent' }}>
                      <input type="checkbox" checked={checked} onChange={() => {
                        let list = [...(config.layoutList || [])];
                        if (checked) list = list.filter(([lr,lc]) => !(lr===r && lc===c));
                        else list.push([r,c]);
                        if (list.length === 0) list = [[3,3]];
                        updateConfig({ layoutList: list });
                      }} style={{ accentColor: C.cyan, width: 14, height: 14 }} />
                      {r}x{c} ({r*c}格)
                    </label>
                  );
                })}
              </div>
              <div className="mt-2 text-xs" style={{ color: C.muted }}>
                当前适配：<span style={{ color: C.cyan }}>{autoLayout.rows}×{autoLayout.cols}</span>，每页 {autoLayout.rows * autoLayout.cols} 个
              </div>
            </section>

            {/* 自动字号 */}
            <section className="mb-5">
              <div className="mb-2 text-sm font-semibold" style={{ color: C.cyan }}>
                自动字号
              </div>
              <div className="text-xs" style={{ color: C.muted }}>
                当前 {autoLayout.rows}×{autoLayout.cols} 布局 · {config.fields.length} 个字段 → 字号 <span style={{ color: C.cyan }}>{autoFontSize.value}px</span>
              </div>
              <div className="mt-1 text-xs" style={{ color: 'rgba(147,164,192,0.4)' }}>
                格越小、字段越多 → 字越小（最小 8px），自动适配
              </div>
            </section>

            {/* 数据刷新频率 */}
            <section className="mb-5">
              <div className="mb-2 text-sm font-semibold" style={{ color: C.cyan }}>
                数据刷新频率：{config.refreshSeconds} 秒
              </div>
              <div className="flex gap-2">
                {[30, 60, 120, 300, 600].map((s) => (
                  <OptionBtn key={s} active={config.refreshSeconds === s} onClick={() => updateConfig({ refreshSeconds: s })}>
                    {s >= 60 ? `${s/60}分` : `${s}秒`}
                  </OptionBtn>
                ))}
              </div>
            </section>

            {/* 字号：自动 / 手动（可输入 0.5px 步长） */}
            <section className="mb-5">
              <div className="mb-2 text-sm font-semibold" style={{ color: C.cyan }}>
                字号：{config.fontSize === 'auto' ? '自动' : `${config.fontSize}px`}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step={0.5}
                  min={8}
                  max={30}
                  value={config.fontSize === 'auto' ? '' : (config.fontSize as number)}
                  placeholder={config.fontSize === 'auto' ? '自动' : ''}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!isNaN(v) && v >= 8 && v <= 30) updateConfig({ fontSize: v });
                  }}
                  className="w-24"
                  style={{ color: C.text, background: 'rgba(0,0,0,0.2)', borderColor: C.border }}
                />
                <span style={{ color: C.muted }}>px</span>
                <Button variant="ghost" size="sm" onClick={() => updateConfig({ fontSize: 'auto' })} style={{ color: config.fontSize === 'auto' ? C.cyan : C.muted }}>
                  自动
                </Button>
              </div>
            </section>

            {/* 卡片字段 */}
            <section className="mb-5">
              <div className="mb-2 text-sm font-semibold" style={{ color: C.cyan }}>
                卡片显示字段
              </div>
              <div className="space-y-1.5">
                {ALL_FIELD_KEYS.filter((k) => k !== 'projectName').map((k) => {
                  const def = FIELD_DEFS[k];
                  const checked = config.fields.includes(k);
                  return (
                    <label key={k} className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: C.text }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleField(k)} style={{ accentColor: C.cyan, width: 16, height: 16 }} />
                      {def.label}
                    </label>
                  );
                })}
              </div>
              <div className="mt-1 text-[11px]" style={{ color: C.muted }}>
                作业名称 / 状态 / 危险作业类型始终显示
              </div>
            </section>

            {/* 嵌套危险作业卡片字段 */}
            <section className="mb-5">
              <div className="mb-2 text-sm font-semibold" style={{ color: C.amber }}>
                嵌套危险作业卡片字段
              </div>
              <div className="space-y-1.5">
                {HAZARD_FIELD_KEYS.filter((k) => k !== 'permitNo').map((k) => {
                  const def = FIELD_DEFS[k];
                  const checked = config.hazardFields.includes(k);
                  return (
                    <label key={k} className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: C.text }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleHazardField(k)} style={{ accentColor: C.amber, width: 16, height: 16 }} />
                      {def.label}
                    </label>
                  );
                })}
              </div>
              <div className="mt-1 text-[11px]" style={{ color: C.muted }}>
                危险作业类型 / 编号 / 状态始终显示
              </div>
            </section>

            {/* 轮播切换时间 */}
            <section className="mb-5">
              <div className="mb-2 text-sm font-semibold" style={{ color: C.cyan }}>
                轮播切换时间
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={Math.floor(config.rotateSeconds / 60)}
                  onChange={(e) => {
                    const m = Number(e.target.value);
                    const s = config.rotateSeconds % 60;
                    updateConfig({ rotateSeconds: m * 60 + s });
                  }}
                  className="rounded-lg px-2 py-1.5 text-sm outline-none"
                  style={{ background: 'rgba(0,0,0,0.3)', color: C.text, border: `1px solid ${C.border}` }}
                >
                  {Array.from({ length: 11 }, (_, i) => i).map((m) => (
                    <option key={m} value={m}>{m} 分</option>
                  ))}
                </select>
                <select
                  value={(config.rotateSeconds % 60) - ((config.rotateSeconds % 60) % 5)}
                  onChange={(e) => {
                    const s = Number(e.target.value);
                    const m = Math.floor(config.rotateSeconds / 60);
                    updateConfig({ rotateSeconds: m * 60 + s });
                  }}
                  className="rounded-lg px-2 py-1.5 text-sm outline-none"
                  style={{ background: 'rgba(0,0,0,0.3)', color: C.text, border: `1px solid ${C.border}` }}
                >
                  {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((s) => (
                    <option key={s} value={s}>{s} 秒</option>
                  ))}
                </select>
              </div>
              <div className="mt-1 text-xs" style={{ color: C.muted }}>
                每 <span style={{ color: C.cyan }}>{config.rotateSeconds}</span> 秒自动切换到下一页（0 秒则关闭轮播）
              </div>
            </section>

            {/* 其他 */}
            <section className="mb-5">
              <div className="mb-2 text-sm font-semibold" style={{ color: C.cyan }}>
                其他
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: C.text }}>
                <input type="checkbox" checked={config.showPaused} onChange={(e) => updateConfig({ showPaused: e.target.checked })} style={{ accentColor: C.cyan, width: 16, height: 16 }} />
                显示「已暂停」底部区域
              </label>
            </section>

            <button
              className="mt-2 w-full rounded-lg py-2 text-sm font-medium"
              style={{ background: 'rgba(248,113,113,0.12)', color: C.red, border: `1px solid rgba(248,113,113,0.3)` }}
              onClick={() => {
                localStorage.removeItem(CONFIG_KEY);
                setConfig({ ...DEFAULT_CONFIG });
              }}
            >
              恢复默认设置
            </button>
          </div>
        </div>
      )}

      {/* 暂停原因浮层 */}
      {pauseFor && (
        <div className="absolute inset-x-0 top-20 z-50 mx-auto w-full max-w-md px-4">
          <div className="rounded-xl p-4" style={{ background: C.panelSolid, border: `1px solid ${C.borderStrong}`, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold" style={{ color: C.text }}>
                暂停作业 · {pauseFor.jobName || '未命名'}
              </div>
              <button onClick={() => { setPauseFor(null); setReason(''); }} style={{ color: C.muted }}>
                <X size={16} />
              </button>
            </div>
            <Input
              value={reason}
              onChange={(e) => { setReason(e.target.value); if (pauseErr) setPauseErr(''); }}
              placeholder="暂停原因（必填），如 现场隐患整改中"
              className="mb-2"
              style={{ color: C.text, background: 'rgba(0,0,0,0.3)', borderColor: pauseErr ? C.red : C.border }}
            />
            {pauseErr && (
              <div className="mb-2 text-xs" style={{ color: C.red }}>
                {pauseErr}
              </div>
            )}
            {/* 联动：关联危险作业（进行中/已暂停）可一并暂停 */}
            {(() => {
              const hazList = (pauseFor?.hazards || []).filter((h: any) => ['printed', 'paused'].includes(h.status));
              if (!hazList.length) return null;
              return (
                <div className="mb-3 rounded-lg border p-2.5" style={{ borderColor: 'rgba(251,146,60,0.4)', background: 'rgba(251,146,60,0.08)' }}>
                  <div className="mb-1.5 text-xs font-semibold" style={{ color: C.amber }}>
                    关联危险作业（{hazList.length}）—— 勾选可一并暂停
                  </div>
                  {hazList.map((h: any) => (
                    <label key={h.id} className="flex cursor-pointer items-center gap-2 py-1 text-sm" style={{ color: C.text }}>
                      <input
                        type="checkbox"
                        checked={pauseHazards.includes(h.id)}
                        onChange={(e) =>
                          setPauseHazards((prev) => (e.target.checked ? [...prev, h.id] : prev.filter((x) => x !== h.id)))
                        }
                        style={{ accentColor: C.amber, width: 15, height: 15 }}
                      />
                      {h.hazardTypeLabel || '危险作业'} · <span>{h.permitNo}</span>
                      {h.status === 'paused' && <span className="text-xs" style={{ color: C.muted }}>（已暂停）</span>}
                    </label>
                  ))}
                </div>
              );
            })()}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setPauseFor(null); setReason(''); }} style={{ color: C.muted }}>
                取消
              </Button>
              <Button variant="destructive" size="sm" onClick={doPause}>
                确认暂停
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 危险作业详情弹层（点击危险作业标签打开）：单个暂停 / 进入详情 */}
      {hazardDetail && (
        <div className="absolute inset-x-0 top-20 z-50 mx-auto w-full max-w-md px-4">
          <div className="rounded-xl p-4" style={{ background: C.panelSolid, border: `1px solid ${C.borderStrong}`, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold" style={{ color: C.amber }}>
                {hazardDetail.hazardTypeLabel || '—'}
              </div>
              <button onClick={() => setHazardDetail(null)} style={{ color: C.muted }}>
                <X size={16} />
              </button>
            </div>
            <div className="mb-3 space-y-1.5 rounded-lg border p-3" style={{ borderColor: C.border, background: 'rgba(0,0,0,0.2)' }}>
              {(config.hazardFields || []).map((k) => {
                const def = FIELD_DEFS[k];
                if (!def) return null;
                let val: any = hazardDetail[k];
                if (k === 'plan') {
                  const f = (v?: string) => (v ? `${dayjs(v).format('MM-DD HH:mm')} ${WEEKDAYS[dayjs(v).day()]}` : '—');
                  val = `${f(hazardDetail.planStart)} ~ ${f(hazardDetail.planEnd)}`;
                }
                if (val === undefined || val === null) val = '—';
                if (Array.isArray(val)) val = val.join('、');
                return (
                  <div key={k} className="flex items-start gap-2 text-xs" style={{ color: C.muted }}>
                    <span className="w-20 shrink-0 opacity-80">{def.label}</span>
                    <span className="min-w-0 flex-1" style={{ color: C.text }}>{String(val)}</span>
                  </div>
                );
              })}
              {hazardDetail.status === 'paused' && (
                <div className="pt-1 text-xs" style={{ color: C.amber }}>
                  已暂停：{hazardDetail.pauseReason || '未填写原因'}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => navigate(`/e-permits/view/${hazardDetail.id}`)} style={{ color: C.cyan }}>
                进入详情
              </Button>
              <Button variant="destructive" size="sm" onClick={() => { const h = hazardDetail; setHazardDetail(null); setPauseFor(h); setReason(''); setPauseErr(''); }}>
                暂停作业
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 查看日期弹层（日历选择历史某一天） */}
      {datePickerOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => setDatePickerOpen(false)}>
          <div
            className="w-full max-w-sm rounded-xl p-5"
            style={{ background: C.panelSolid, border: `1px solid ${C.borderStrong}`, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-bold" style={{ color: C.text }}>
                <CalendarDays size={18} className="mr-1 inline" style={{ color: C.cyan }} /> 选择查看日期
              </div>
              <button onClick={() => setDatePickerOpen(false)} style={{ color: C.muted }}>
                <X size={18} />
              </button>
            </div>

            <div className="mb-3 flex items-center justify-between">
              <button
                className="rounded p-1 transition-colors hover:bg-white/10"
                style={{ color: C.text }}
                onClick={() => setPickerMonth(pickerMonth.subtract(1, 'month'))}
              >
                <ChevronLeft size={20} />
              </button>
              <div className="text-sm font-semibold" style={{ color: C.text }}>
                {pickerMonth.format('YYYY 年 M 月')}
              </div>
              <button
                className="rounded p-1 transition-colors hover:bg-white/10"
                style={{ color: C.text }}
                onClick={() => setPickerMonth(pickerMonth.add(1, 'month'))}
              >
                <ChevronRight size={20} />
              </button>
            </div>

            <div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs" style={{ color: C.muted }}>
              {['日', '一', '二', '三', '四', '五', '六'].map((d) => (
                <div key={d} className="py-1">{d}</div>
              ))}
            </div>
            <div className="mb-4 grid grid-cols-7 gap-1">
              {(() => {
                const start = pickerMonth.startOf('month').startOf('week');
                const end = pickerMonth.endOf('month').endOf('week');
                const days: dayjs.Dayjs[] = [];
                let d = start;
                while (d.isBefore(end) || d.isSame(end, 'day')) {
                  days.push(d);
                  d = d.add(1, 'day');
                }
                return days.map((day) => {
                  const inMonth = day.month() === pickerMonth.month();
                  const selected = day.format('YYYY-MM-DD') === date;
                  const today = day.format('YYYY-MM-DD') === dayjs().format('YYYY-MM-DD');
                  return (
                    <button
                      key={day.format('YYYY-MM-DD')}
                      type="button"
                      onClick={() => { setDate(day.format('YYYY-MM-DD')); setDatePickerOpen(false); }}
                      className="flex aspect-square items-center justify-center rounded-lg text-sm transition-colors"
                      style={{
                        color: selected ? C.bg : inMonth ? C.text : C.muted,
                        background: selected ? C.cyan : 'transparent',
                        border: today && !selected ? `1px solid ${C.cyan}` : '1px solid transparent',
                      }}
                    >
                      {day.date()}
                    </button>
                  );
                });
              })()}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setDate(dayjs().format('YYYY-MM-DD')); setDatePickerOpen(false); }} style={{ color: C.muted }}>
                回到今天
              </Button>
              <Button size="sm" onClick={() => setDatePickerOpen(false)} style={{ color: C.bg, background: C.cyan }}>
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, color, icon: Icon, onClick, actions }: { label: string; value: React.ReactNode; color: string; icon: any; onClick?: () => void; actions?: React.ReactNode }) {
  return (
    <div
      onClick={onClick}
      className={`group/stat flex items-center gap-4 rounded-xl p-4 text-left border border-[rgba(56,189,248,0.24)] shadow-[0_6px_20px_rgba(0,0,0,0.45),0_0_0_1px_rgba(34,211,238,0.10)] transition-all duration-300 ${onClick ? 'cursor-pointer hover:-translate-y-1 hover:border-[rgba(34,211,238,0.5)] hover:shadow-[0_14px_32px_rgba(0,0,0,0.55),0_0_24px_rgba(34,211,238,0.3)] hover:brightness-110' : ''}`}
      style={{ background: C.panel }}
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg" style={{ background: `${color}1f`, color }}>
        <Icon size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm" style={{ color: C.muted }}>
          {label}
        </div>
        <div className="truncate text-3xl font-bold tabular-nums" style={{ color }}>
          {value}
        </div>
      </div>
      {actions && (
        <div className="flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover/stat:opacity-100" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}

function OptionBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors"
      style={{
        background: active ? 'rgba(34,211,238,0.18)' : 'rgba(255,255,255,0.04)',
        color: active ? C.cyan : C.muted,
        border: `1px solid ${active ? C.borderStrong : C.border}`,
      }}
    >
      {children}
    </button>
  );
}
