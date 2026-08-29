import React from 'react';
import { Card, CardContent, EmptyState, Label, IconBox, cn } from './ui';
import {
  FilePen,
  Hourglass,
  ScanEye,
  BadgeCheck,
  XCircle,
  Activity,
  PauseCircle,
  Flag,
  Archive,
  Ban,
} from 'lucide-react';

/** 作业票状态 → 图标（替代无区分度的彩色圆点） */
export const WP_STATUS_ICONS: Record<string, React.ReactNode> = {
  draft: <FilePen size={18} />,
  pending_review: <Hourglass size={18} />,
  reviewing: <ScanEye size={18} />,
  approved: <BadgeCheck size={18} />,
  rejected: <XCircle size={18} />,
  printed: <Activity size={18} />,
  paused: <PauseCircle size={18} />,
  finished: <Flag size={18} />,
  completed: <Archive size={18} />,
  voided: <Ban size={18} />,
};

/** 任意 CSS 颜色 → 柔底 + 主色文字（用于徽标/图标芯片） */
export function tint(color: string, fg = 'var(--foreground)'): React.CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${color} 13%, transparent)`,
    color: `color-mix(in srgb, ${color} 70%, ${fg})`,
  };
}

/* ============================ DataTable ============================ */
export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render?: (row: T, i: number) => React.ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  /** 响应式隐藏：sm=小屏隐藏，md=中屏隐藏 */
  hideOn?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowClassName,
  empty,
  loading = false,
  zebra = false,
  skeletonRows = 6,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string | number;
  onRowClick?: (row: T) => void;
  /** 行级样式钩子：用于危险作业票等需要整行高亮的场景 */
  rowClassName?: (row: T, i: number) => string | undefined;
  empty?: React.ReactNode;
  loading?: boolean;
  zebra?: boolean;
  skeletonRows?: number;
}) {
  const alignCls = (a?: 'left' | 'right' | 'center') =>
    a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';
  const hideCls = (h?: string) => (h === 'sm' ? 'hidden sm:table-cell' : h === 'md' ? 'hidden md:table-cell' : '');

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className={cn('ehs-table w-full', zebra && 'zebra')}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={cn(alignCls(c.align), hideCls(c.hideOn))} style={c.width ? { width: c.width } : undefined}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: skeletonRows }).map((_, r) => (
                <tr key={`sk-${r}`}>
                  {columns.map((c) => (
                    <td key={c.key} className={cn(alignCls(c.align), hideCls(c.hideOn))}>
                      <div className="skeleton h-4" style={{ width: `${50 + ((r + c.key.length) % 5) * 10}%` }} />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              rows.map((row, i) => (
                <tr
                  key={rowKey(row, i)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(onRowClick && 'cursor-pointer', rowClassName?.(row, i))}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn(alignCls(c.align), hideCls(c.hideOn), c.className)}>
                      {c.render ? c.render(row, i) : (row as any)[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="p-0">
                  {empty ?? <EmptyState title="暂无数据" hint="当前筛选条件下没有记录" />}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ============================ MetricTile / StatStrip ============================ */
export function MetricTile(props: {
  label: string;
  value: React.ReactNode;
  color?: string;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  actions?: React.ReactNode;
  className?: string;
}) {
  const { label, value, color, hint, icon, onClick, active = false, className } = props;
  const actions = props.actions;
  const c = color || 'hsl(var(--primary))';
  return (
    <div
      className={cn('metric-tile group', onClick && 'cursor-pointer', active && 'metric-tile-active', className)}
      onClick={onClick}
      style={{ '--metric-color': c } as React.CSSProperties}
    >
      {/* 右下角装饰光晕 */}
      <div className="metric-halo" aria-hidden />
      {/* 左右布局：图标左 + 数字/标签右，移动端 padding 收紧降低高度 */}
      <div className="relative z-10 flex h-full items-center gap-2.5 p-3 sm:gap-3 sm:p-[var(--pad-card)]">
        {icon && <span className="metric-icon shrink-0">{icon}</span>}
        <div className="min-w-0 flex-1 text-right">
          <div className="text-2xl font-bold leading-tight tabular-nums tracking-normal text-foreground sm:text-4xl">{value}</div>
          <div className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-[11px]">
            {label}
          </div>
        </div>
        {hint && <span className="shrink-0 text-[11px] text-muted-foreground">{hint}</span>}
        {actions && <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>{actions}</div>}
      </div>
    </div>
  );
}

const STATSTRIP_COLS: Record<string, string> = {
  '4': 'sm:grid-cols-3 lg:grid-cols-4',
  '5': 'sm:grid-cols-3 lg:grid-cols-5',
  '6': 'sm:grid-cols-4 lg:grid-cols-6',
};
export function StatStrip({ children, className, cols = '4' }: { children: React.ReactNode; className?: string; cols?: string }) {
  return <div className={cn('grid grid-cols-2 gap-[var(--gap-card)]', STATSTRIP_COLS[cols] || STATSTRIP_COLS['4'], className)}>{children}</div>;
}

/* ============================ FilterBar / SearchInput ============================ */
export function FilterBar({ children, right, className }: { children: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('card flex flex-wrap items-center gap-3 p-3.5', className)}>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
      {right && <div className="flex flex-wrap items-center gap-3">{right}</div>}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  onSearch,
  placeholder = '搜索…',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onSearch?: () => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-[var(--control-h)] w-full min-w-[200px] items-center gap-2 rounded-[var(--radius)] border border-input bg-card px-3',
        'focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/35',
        className,
      )}
    >
      <SearchIcon className="text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSearch?.()}
        placeholder={placeholder}
        className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
      />
    </div>
  );
}

function SearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" strokeLinecap="round" />
    </svg>
  );
}

/* ============================ StatusPill / Tag / Avatar ============================ */
export function StatusPill({
  color,
  children,
  className,
}: {
  color?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const c = color || 'hsl(var(--primary))';
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', className)}
      style={tint(c)}
    >
      <span className="dot" style={{ background: c }} aria-hidden />
      {children}
    </span>
  );
}

export function Tag({ children, color, className }: { children: React.ReactNode; color?: string; className?: string }) {
  const c = color || 'hsl(var(--muted-foreground))';
  return (
    <span
      className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs', className)}
      style={{ borderColor: `color-mix(in srgb, ${c} 32%, transparent)`, color: c }}
    >
      {children}
    </span>
  );
}

export function Avatar({ name, size = 36, color }: { name?: string; size?: number; color?: string }) {
  const initials = name ? name.trim().slice(0, 1) : '?';
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: color || 'hsl(var(--primary))', fontSize: size * 0.4 }}
    >
      {initials}
    </span>
  );
}

/* ============================ Section / Field / FormGrid ============================ */
export function Section({
  title,
  icon,
  action,
  description,
  children,
  className,
}: {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      {(title || action || description) && (
        <div className="mb-4 flex items-start justify-between gap-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {icon && <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>}
              <span className="relative inline-block">
                {title}
                <span className="absolute -bottom-1.5 left-0 h-0.5 w-5 rounded-full bg-primary/60" aria-hidden />
              </span>
            </div>
            {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2 min-w-0', className)}>
      {label && (
        <Label className="flex items-center gap-1 whitespace-nowrap">
          {required && <span className="text-destructive">*</span>}
          {label}
        </Label>
      )}
      {children}
      {hint && <p className="text-xs leading-relaxed text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

export function FormGrid({ children, cols = 2, className }: { children: React.ReactNode; cols?: 1 | 2 | 3; className?: string }) {
  const colCls = cols === 1 ? 'grid-cols-1' : cols === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2';
  return <div className={cn('grid grid-cols-1 gap-[var(--gap-card)]', colCls, className)}>{children}</div>;
}
