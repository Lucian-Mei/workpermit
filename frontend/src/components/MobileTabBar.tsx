import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, AlertTriangle, Plus, ClipboardList, MonitorPlay, UserCircle, CheckCircle, Building2, PenTool, FileSignature, AlertOctagon, BadgeCheck, MonitorSmartphone, ChevronRight, FilePlus2 } from 'lucide-react';
import { hasPerm } from '@/api/client';

// ============================================================
// 移动端底部导航（仅 <768px 显示；桌面端保持侧边栏不变）
// 【可配置】后期调整 5 个底部菜单只需修改 MOBILE_TABS 数组。
// 每个 Tab：to 为直达链接；menu 为弹出菜单（未配置权限的不显示）。
// ============================================================

export interface MobileTabItem {
  to: string; // 完整路由（可带 query，如 /e-permits/apply?type=routine）
  label: string;
  icon: any;
  perms?: string[]; // 任一命中即可见
}

export interface MobileTab {
  key: string;
  label: string; // 底部按钮名
  icon: any;
  to?: string; // 直达链接（无 menu 时使用）
  menu?: MobileTabItem[]; // 弹出菜单（有 menu 时不直达）
}

export const MOBILE_TABS: MobileTab[] = [
  {
    key: 'home',
    label: '首页',
    icon: LayoutDashboard,
    to: '/',
  },
  {
    key: 'hazard',
    label: '隐患',
    icon: AlertTriangle,
    menu: [
      { to: '/hazards/my', label: '我的隐患', icon: UserCircle, perms: ['hazard:view_own', 'hazard:view_all', 'hazard:view_department'] },
      { to: '/hazards/acceptance', label: '验收管理', icon: CheckCircle, perms: ['hazard:accept', 'hazard:view_all', 'hazard:view_department'] },
      { to: '/hazards/department', label: '部门隐患', icon: Building2, perms: ['hazard:view_department', 'hazard:view_all'] },
    ],
  },
  {
    key: 'create',
    label: '新增',
    icon: Plus,
    menu: [
      { to: '/hazards/report', label: '隐患填报', icon: PenTool, perms: ['hazard:create'] },
      // 作业申请统一入口：进入作业票申请页，先选「常规作业 / 危险作业(8类)」再进入对应申请表单
      { to: '/e-permits/apply', label: '新增作业申请', icon: FilePlus2, perms: ['epermit:create', 'epermit:view_all', 'epermit:view_own'] },
    ],
  },
  {
    key: 'work',
    label: '作业',
    icon: ClipboardList,
    menu: [
      { to: '/work-permits', label: '常规作业管理', icon: FileSignature, perms: ['epermit:view_all', 'epermit:view_own'] },
      { to: '/hazard-work-permits', label: '危险作业管理', icon: AlertOctagon, perms: ['epermit:view_all', 'epermit:view_own'] },
      { to: '/e-approval', label: '电子审批台', icon: BadgeCheck, perms: ['epermit:review', 'epermit:approve', 'epermit:approve_ehs', 'epermit:view_all'] },
      { to: '/e-onsite', label: '电子现场台', icon: MonitorSmartphone, perms: ['epermit:onsite_check', 'epermit:view_all'] },
    ],
  },
  {
    key: 'board',
    label: '看板',
    icon: MonitorPlay,
    to: '/m-board', // 手机端·今日作业看板（桌面访问自动跳大屏 /e-board）
  },
];

function hasAnyPerm(user: any, perms?: string[]) {
  if (!perms || perms.length === 0) return true;
  return perms.some((p) => hasPerm(user, p));
}

/** 路由匹配：支持带 query 的 to（如 /e-permits/apply?type=routine） */
function isPathActive(pathname: string, to: string): boolean {
  const path = to.split('?')[0];
  if (path === '/') return pathname === '/';
  return pathname === path || pathname.startsWith(path + '/');
}

export default function MobileTabBar({ user }: { user: any }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [openKey, setOpenKey] = useState<string | null>(null);

  // 可见 Tab：直达项恒显示；弹出菜单项需至少一个子项有权限
  const tabs = MOBILE_TABS.filter((t) => {
    if (t.to) return true;
    return (t.menu || []).some((i) => hasAnyPerm(user, i.perms));
  });

  const openTab = tabs.find((t) => t.key === openKey);
  const visibleMenu = openTab?.menu ? openTab.menu.filter((i) => hasAnyPerm(user, i.perms)) : [];

  function close() {
    setOpenKey(null);
  }

  function go(item: MobileTabItem) {
    close();
    navigate(item.to);
  }

  return (
    <>
      {/* 弹出菜单遮罩：点击任意处关闭（仅移动端） */}
      {openKey && (
        <div className="fixed inset-0 z-20 bg-black/30 md:hidden" onClick={close} aria-hidden="true" />
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 md:hidden">
        {/* 弹出菜单面板（不透明背景，保证可读性） */}
        {openTab && visibleMenu.length > 0 && (
          <div className="mx-auto mb-2 w-[calc(100%-2rem)] max-w-sm overflow-hidden rounded-xl border border-border bg-[hsl(var(--card))] shadow-lg">
            <div className="border-b border-border px-4 py-2 text-xs font-semibold text-muted-foreground">
              {openTab.label}
            </div>
            {visibleMenu.map((item) => {
              const ItemIcon = item.icon;
              return (
                <button
                  key={item.to}
                  type="button"
                  onClick={() => go(item)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-foreground transition-colors hover:bg-muted/60 active:bg-muted"
                >
                  <ItemIcon size={18} className="shrink-0 text-primary" />
                  <span className="flex-1">{item.label}</span>
                  <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        )}

        {/* 底部导航条（不透明背景） */}
        <nav className="flex h-14 border-t border-border bg-[hsl(var(--background))]">
          {tabs.map((t) => {
            const TabIcon = t.icon;
            // 直达项与弹出项的高亮判断
            const active = t.to
              ? isPathActive(pathname, t.to)
              : (t.menu || []).some((i) => isPathActive(pathname, i.to));
            const isCreate = t.key === 'create';

            if (t.to) {
              return (
                <Link
                  key={t.key}
                  to={t.to}
                  onClick={close}
                  className={`flex flex-1 flex-col items-center justify-center gap-0.5 ${
                    active ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  <TabIcon size={20} />
                  <span className="text-[10px]">{t.label}</span>
                </Link>
              );
            }

            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setOpenKey((k) => (k === t.key ? null : t.key))}
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 ${
                  active ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                {isCreate ? (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                    <TabIcon size={17} />
                  </span>
                ) : (
                  <TabIcon size={20} />
                )}
                <span className="text-[10px]">{t.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </>
  );
}
