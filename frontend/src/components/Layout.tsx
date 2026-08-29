import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import ehsLogo from '@/assets/ehs-logo.png';
import {
  LayoutDashboard,
  AlertTriangle,
  ClipboardList,
  Users,
  Shield,
  Building2,
  Settings,
  LogOut,
  Menu,
  X,
  KeyRound,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Repeat,
  UserPlus,
  CheckCircle,
  UserCircle,
  PenTool,
  Search,
  MonitorSmartphone,
  MonitorPlay,
  BadgeCheck,
  GraduationCap,
  BarChart3,
  Smartphone,
  FileSignature,
  FileText,
  DoorOpen,
  AlertOctagon,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { hasPerm } from '@/api/client';
import SkinSwitcher from '@/components/SkinSwitcher';
import NotificationBell from './NotificationBell';
import { Popover } from './Popover';
import MobileTabBar from './MobileTabBar';

interface SubNavItem {
  to: string;
  label: string;
  icon?: React.ReactNode;
  perms?: string[];
}

interface NavGroup {
  label: string;
  icon: React.ReactNode;
  perms?: string[];
  items: SubNavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: '总览',
    icon: <LayoutDashboard size={18} />,
    items: [{ to: '/', label: 'EHS仪表盘', icon: <LayoutDashboard size={16} /> }],
  },
  {
    label: '隐患管理',
    icon: <AlertTriangle size={18} />,
    items: [
      { to: '/hazards/report', label: '隐患填报', icon: <PenTool size={16} />, perms: ['hazard:create'] },
      { to: '/hazards/my', label: '我的隐患', icon: <UserCircle size={16} />, perms: ['hazard:view_own', 'hazard:view_all', 'hazard:view_department'] },
      { to: '/hazards/acceptance', label: '验收管理', icon: <CheckCircle size={16} />, perms: ['hazard:accept', 'hazard:view_all', 'hazard:view_department'] },
      { to: '/hazards/department', label: '部门隐患', icon: <Building2 size={16} />, perms: ['hazard:view_department', 'hazard:view_all'] },
    ],
  },
  {
    label: '作业票管理',
    icon: <Smartphone size={18} />,
    items: [
      { to: '/stats/annual', label: '年度作业统计', icon: <BarChart3 size={16} />, perms: ['work_permit:view_all'] },
      { to: '/e-applications', label: '作业票申请', icon: <FileSignature size={16} />, perms: ['epermit:create', 'epermit:view_all', 'epermit:view_own'] },
      { to: '/work-permits', label: '常规作业管理', icon: <ClipboardList size={16} />, perms: ['epermit:view_all', 'epermit:view_own'] },
      { to: '/hazard-work-permits', label: '危险作业管理', icon: <AlertOctagon size={16} />, perms: ['epermit:view_all', 'epermit:view_own'] },
      { to: '/e-approval', label: '电子审批台', icon: <BadgeCheck size={16} />, perms: ['epermit:review', 'epermit:approve', 'epermit:approve_ehs', 'epermit:view_all'] },
      { to: '/e-onsite', label: '电子现场台', icon: <MonitorSmartphone size={16} />, perms: ['epermit:onsite_check', 'epermit:view_all'] },
      { to: '/e-permits/entry-records', label: '入场记录管理', icon: <DoorOpen size={16} />, perms: ['epermit:view_all', 'epermit:view_own'] },
      { to: '/training', label: '一级安全培训', icon: <GraduationCap size={16} />, perms: ['epermit:view_all', 'epermit:view_own'] },
      { to: '/e-board', label: '作业看板', icon: <MonitorPlay size={16} />, perms: ['board:view', 'epermit:view_all'] },
    ],
  },
  {
    label: '员工与权限',
    icon: <Users size={18} />,
    items: [
      { to: '/users', label: '员工账号', icon: <Users size={16} />, perms: ['user:manage'] },
      { to: '/roles', label: '角色权限', icon: <Shield size={16} />, perms: ['role:manage'] },
      { to: '/departments', label: '部门管理', icon: <Building2 size={16} />, perms: ['department:manage'] },
    ],
  },
  {
    label: '系统设置',
    icon: <Settings size={18} />,
    items: [
      { to: '/settings', label: '基础设置', icon: <Settings size={16} />, perms: ['config:manage'] },
      { to: '/settings?tab=docs', label: '帮助文档', icon: <FileText size={16} />, perms: ['config:manage'] },
    ],
  },
];

function hasAnyPerm(user: any, perms?: string[]) {
  if (!perms || perms.length === 0) return true;
  return perms.some((p) => hasPerm(user, p));
}

// 顶栏标题（按路由派生）
const TITLE_MAP: Record<string, string> = {
  '/': 'EHS 仪表盘',
  '/hazards': '隐患管理',
  '/hazards/report': '上报隐患',
  '/hazards/my': '我的隐患',
  '/hazards/acceptance': '验收管理',
  '/hazards/department': '部门隐患',
  '/e-applications': '作业票申请',
  '/e-permits': '电子票台账',
  '/work-permits': '常规作业管理',
  '/hazard-work-permits': '危险作业管理',
  '/e-approval': '电子审批台',
  '/e-permits/my': '我的电子票',
  '/e-onsite': '电子现场台',
  '/e-board': '作业看板',
  '/m-board': '今日作业看板',
  '/e-permits/entry-records': '入场记录管理',
  '/training': '一级安全培训',
  '/training/exam': '安全培训考试',
  '/e-board/screen': '电子车间大屏',
  '/stats/annual': '年度作业统计',
  '/users': '员工账号',
  '/roles': '角色与权限',
  '/departments': '部门管理',
  '/settings': '系统设置',
};
function titleFor(pathname: string): string {
  if (TITLE_MAP[pathname]) return TITLE_MAP[pathname];
  const base = '/' + (pathname.split('/')[1] || '');
  return TITLE_MAP[base] || 'EHS 隐患与作业管理系统';
}

function TopBar({
  title,
  user,
  accounts,
  switchAccount,
  logout,
  onMenu,
}: {
  title: string;
  user: any;
  accounts: any[];
  switchAccount: (id: string) => void;
  logout: () => void;
  onMenu?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-border bg-background/85 px-4 backdrop-blur-md md:px-7">
      <div className="flex items-center gap-2">
        <button
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
          onClick={onMenu}
          aria-label="菜单"
        >
          <Menu size={18} />
        </button>
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/')}
            className="hidden text-muted-foreground hover:text-foreground sm:inline cursor-pointer"
          >
            <ChevronLeft size={14} className="inline mr-1" />返回
          </button>
          <span className="font-semibold text-foreground">{title}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {/* 仿搜索框 */}
        <div className="hidden h-9 w-60 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-muted-foreground lg:flex">
          <Search size={15} />
          <span>搜索隐患 / 作业票 / 人员…</span>
        </div>
        {/* 实时运行状态 */}
        <div className="hidden items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground md:flex">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping-soft rounded-full bg-success/70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          系统运行中
        </div>
        <SkinSwitcher />
        <NotificationBell />
        <AccountMenu user={user} accounts={accounts} switchAccount={switchAccount} logout={logout} />
      </div>
    </header>
  );
}

function AccountMenu({
  user,
  accounts,
  switchAccount,
  logout,
}: {
  user: any;
  accounts: any[];
  switchAccount: (id: string) => void;
  logout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  function pick(id: string) {
    switchAccount(id);
    setOpen(false);
    navigate('/');
  }

  return (
    <Popover
      align="right"
      width="min(calc(100vw - 2rem), 16rem)"
      padding={false}
      open={open}
      onOpenChange={setOpen}
      trigger={({ toggle, ref }) => (
        <button
          ref={ref}
          onClick={toggle}
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 transition-colors hover:border-primary/40"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary">
            {(user?.name || '?').slice(0, 1)}
          </div>
          <span className="hidden text-sm text-foreground sm:inline">{user?.name}</span>
          <ChevronDown size={14} className="hidden text-muted-foreground sm:inline" />
        </button>
      )}
    >
      <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-muted-foreground">
        切换账号
      </div>
      <div className="max-h-64 overflow-auto py-1">
        {accounts.length === 0 ? (
          <div className="px-4 py-3 text-sm text-muted-foreground">暂无其他已登录账号</div>
        ) : (
          accounts.map((a) => (
            <button
              key={a.id}
              role="menuitem"
              onClick={() => pick(a.id)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary">
                {(a.name || '?').slice(0, 1)}
              </div>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{a.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {a.username}
                  {a.department ? ' · ' + a.department : ''}
                </span>
              </span>
              <Repeat size={14} className="shrink-0 text-muted-foreground" />
            </button>
          ))
        )}
      </div>
      <div className="border-t border-border py-1">
        <button
          role="menuitem"
          onClick={() => {
            setOpen(false);
            navigate('/change-password');
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
        >
          <KeyRound size={16} className="text-muted-foreground" /> 修改密码
        </button>
        <button
          role="menuitem"
          onClick={() => {
            setOpen(false);
            navigate('/login');
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
        >
          <UserPlus size={16} className="text-muted-foreground" /> 登录其他账号
        </button>
        <button
          role="menuitem"
          onClick={() => {
            setOpen(false);
            logout();
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive transition-colors hover:bg-muted"
        >
          <LogOut size={16} /> 退出登录
        </button>
      </div>
    </Popover>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout, accounts, switchAccount } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    NAV_GROUPS.forEach((g) => (init[g.label] = true));
    return init;
  });

  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => hasAnyPerm(user, i.perms)),
  })).filter((g) => g.items.length > 0);

  // 计算当前应高亮的唯一导航目标
  const activeTo = useMemo(() => {
    const allTos = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.to));
    const curPath = location.pathname;
    const curParams = new URLSearchParams(location.search);
    let best = '';
    let bestScore = -1;
    for (const to of allTos) {
      const [p, q] = to.split('?');
      let score = -1;
      if (q) {
        const need = new URLSearchParams(q);
        const allHit = [...need.entries()].every(([k, v]) => curParams.get(k) === v);
        if (curPath === p && allHit) score = p.length + 1000 + q.length;
      } else if (p === '/') {
        if (curPath === '/') score = 1;
      } else if (curPath === p || curPath.startsWith(p + '/')) {
        score = p.length;
      }
      if (score > bestScore) {
        bestScore = score;
        best = to;
      }
    }
    return best;
  }, [location.pathname, location.search]);

  const isActive = (to: string) => to === activeTo;

  const sidebarContent = (
    <>
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-5">
        <img
          src={ehsLogo}
          alt="EHS"
          width={36}
          height={36}
          className="h-9 w-9 object-contain"
          style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.12))' }}
        />
        <span className="text-base font-bold tracking-tight text-sidebar-accent-foreground">隐患与作业管理</span>
      </div>

      <nav className="flex-1 space-y-2 overflow-auto px-3 py-3">
        {groups.map((g) => (
          <div key={g.label}>
            <button
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60 transition-colors hover:text-sidebar-accent-foreground"
              onClick={() => setExpanded((s) => ({ ...s, [g.label]: !s[g.label] }))}
            >
              <span className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sidebar-accent/70 text-sidebar-foreground">{g.icon}</span>
                {g.label}
              </span>
              {expanded[g.label] ? (
                <ChevronRight size={13} className="rotate-90 transition-transform" />
              ) : (
                <ChevronRight size={13} className="transition-transform" />
              )}
            </button>
            {expanded[g.label] && (
              <div className="mt-1 space-y-1">
                {g.items.map((i) => {
                  const active = isActive(i.to);
                  return (
                    <Link
                      key={i.to + i.label}
                      to={i.to}
                      className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                        active
                          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground'
                      }`}
                      onClick={() => setOpen(false)}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r bg-sidebar-primary" />
                      )}
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${active ? 'bg-sidebar-primary/16 text-sidebar-primary' : 'text-sidebar-foreground/70'}`}>
                        {i.icon}
                      </span>
                      <span className="flex-1 truncate">{i.label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </nav>
    </>
  );

  return (
    <div className="flex min-h-screen bg-transparent text-foreground">
      {/* 侧边栏（桌面）：sticky 固定在视口，logo 不随页面/目录滚动，仅菜单列表内部滚动 */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">{sidebarContent}</aside>

      {/* 移动端抽屉 */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setOpen(false)}>
          <div
            className="absolute bottom-0 left-0 top-0 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end p-3">
              <button onClick={() => setOpen(false)} aria-label="关闭">
                <X />
              </button>
            </div>
            {sidebarContent}
          </div>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={titleFor(location.pathname)}
          user={user}
          accounts={accounts}
          switchAccount={switchAccount}
          logout={logout}
          onMenu={() => setOpen(true)}
        />
        <div className="ehs-grid flex-1">
          <div className="mx-auto max-w-[1440px] page-fade p-4 pb-24 md:p-7">{children}</div>
        </div>
      </main>

      {/* 移动端底部导航（5 模块，仅 <768px 显示；桌面端保持侧边栏） */}
      <MobileTabBar user={user} />
    </div>
  );
}
