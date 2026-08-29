import React from 'react';
import { createPortal } from 'react-dom';

/** 轻量 className 合并（项目未引入 clsx） */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* ============================ IconBox（统一图标容器） ============================ */
type IconBoxTone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'mute' | 'neutral';
const ICONBOX_TONE: Record<IconBoxTone, string> = {
  primary: 'hsl(var(--primary))',
  success: 'hsl(var(--success))',
  warning: 'hsl(var(--warning))',
  danger: 'hsl(var(--destructive))',
  info: 'hsl(var(--info))',
  mute: 'hsl(var(--muted-foreground))',
  neutral: 'hsl(var(--foreground))',
};
const ICONBOX_SIZE = { sm: 34, md: 42, lg: 50 } as const;
export function IconBox({
  icon,
  tone = 'primary',
  size = 'md',
  variant = 'soft',
  className = '',
}: {
  icon: React.ReactNode;
  /** 预设色调或任意 CSS 颜色（如 hsl(var(--x)) / #hex） */
  tone?: IconBoxTone | string;
  size?: keyof typeof ICONBOX_SIZE;
  variant?: 'soft' | 'solid' | 'outline';
  className?: string;
}) {
  const c = ICONBOX_TONE[tone as IconBoxTone] ?? tone;
  const dim = ICONBOX_SIZE[size];
  const style: React.CSSProperties =
    variant === 'solid'
      ? { background: c, color: '#fff' }
      : variant === 'outline'
        ? { background: `color-mix(in srgb, ${c} 9%, transparent)`, color: c, border: `1px solid color-mix(in srgb, ${c} 38%, transparent)` }
        : { background: `color-mix(in srgb, ${c} 13%, transparent)`, color: c };
  return (
    <span
      className={cn('icon-box', className)}
      style={{ width: dim, height: dim, ...style }}
      aria-hidden
    >
      {icon}
    </span>
  );
}

/* ============================ Button ============================ */
type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'destructive' | 'ghost' | 'link' | 'danger';
type ButtonSize = 'sm' | 'default' | 'lg' | 'icon';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] text-sm font-medium ' +
  'transition-[transform,filter,background-color,box-shadow,border-color,color] active:scale-[0.98] ' +
  'disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-offset-1 focus-visible:ring-offset-background';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-foreground shadow-sm hover:brightness-105 hover:shadow-md active:brightness-95 ' +
    'bg-gradient-to-b from-white/15 to-transparent',
  secondary: 'bg-secondary text-secondary-foreground border border-border hover:bg-muted',
  outline: 'border border-border bg-card text-foreground hover:border-primary/40 hover:bg-muted/60',
  destructive:
    'bg-destructive text-destructive-foreground shadow-sm hover:brightness-105 active:brightness-95',
  ghost: 'border border-transparent text-primary hover:bg-primary/10',
  link: 'text-primary underline-offset-4 hover:underline px-0',
  // 兼容旧调用
  danger:
    'bg-destructive text-destructive-foreground shadow-sm hover:brightness-105 active:brightness-95',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  default: 'h-9.5 px-4 py-2',
  lg: 'h-11 px-6 text-[0.95rem]',
  icon: 'h-9.5 w-9.5',
};

export function Button({
  variant = 'primary',
  size = 'default',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    />
  );
}

/* ============================ Card ============================ */
export function Card({ className = '', children, hover = false }: { className?: string; children: React.ReactNode; hover?: boolean }) {
  return <div className={cn('card', hover && 'card-hover', className)}>{children}</div>;
}

/* ============================ 页面容器 / 页头 ============================ */
export function PageContainer({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('animate-fade-in', className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
      <div className="flex items-start gap-3">
        {icon && <IconBox icon={icon} tone="primary" size="lg" variant="solid" />}
        <div>
          <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-tight text-foreground">{title}</h1>
          {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <h2 className={cn('mb-4 flex items-center gap-2 text-sm font-semibold text-foreground', className)}>{children}</h2>;
}

export function SectionHeading({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('mb-4 flex items-center gap-2', className)}>
      <span className="inline-block h-5 w-1 rounded-full bg-primary" aria-hidden />
      <h2 className="text-sm font-semibold text-foreground">{children}</h2>
    </div>
  );
}

export function CardHeader({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('flex flex-col space-y-1.5 p-[var(--pad-card)]', className)}>{children}</div>;
}

export function CardTitle({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('text-lg font-semibold leading-none tracking-tight', className)}>{children}</div>;
}

export function CardDescription({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('text-sm text-muted-foreground', className)}>{children}</div>;
}

export function CardContent({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('p-[var(--pad-card)]', className)}>{children}</div>;
}

export function CardFooter({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('flex items-center p-[var(--pad-card)] pt-0', className)}>{children}</div>;
}

/* ============================ Badge ============================ */
type BadgeVariant =
  | 'default'
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'destructive'
  | 'success'
  | 'warning'
  | 'info'
  | 'critical'
  | 'high'
  | 'medium'
  | 'low';

const BADGE_VARIANTS: Record<BadgeVariant, string> = {
  default: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/12 text-primary',
  secondary: 'bg-secondary text-secondary-foreground',
  outline: 'border border-border text-foreground',
  destructive: 'bg-destructive/12 text-destructive',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/13 text-warning',
  info: 'bg-info/12 text-info',
  critical: 'bg-risk-critical-bg text-risk-critical-text',
  high: 'bg-risk-high-bg text-risk-high-text',
  medium: 'bg-risk-medium-bg text-risk-medium-text',
  low: 'bg-risk-low-bg text-risk-low-text',
};

export function Badge({
  variant = 'default',
  color,
  icon,
  className = '',
  children,
}: {
  variant?: BadgeVariant;
  /** 兼容旧用法：直接传色值（十六进制），优先级高于 variant */
  color?: string;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const content = (
    <>
      {icon}
      {!icon && color && <span className="dot" style={{ backgroundColor: color }} aria-hidden />}
      {children}
    </>
  );
  if (color) {
    return (
      <span
        className={cn('inline-flex items-center gap-1.5 rounded-full border border-foreground/5 px-2.5 py-0.5 text-xs font-medium', className)}
        style={{
          backgroundColor: `color-mix(in srgb, ${color} 13%, transparent)`,
          color: `color-mix(in srgb, ${color} 70%, var(--foreground))`,
        }}
      >
        {content}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border border-foreground/5 px-2.5 py-0.5 text-xs font-medium', BADGE_VARIANTS[variant], className)}>
      {content}
    </span>
  );
}

/* ============================ 表单控件 ============================ */
const FIELD_BASE =
  'w-full h-[var(--control-h)] rounded-[var(--radius)] border border-input bg-card px-3 text-sm outline-none transition-[border-color,box-shadow,background-color] ' +
  'placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-ring/35 focus:bg-background disabled:cursor-not-allowed disabled:opacity-50 ' +
  'shadow-[inset_0_1px_2px_hsl(var(--shadow-color)/0.04)]';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input className={cn(FIELD_BASE, className || '')} {...rest} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return <textarea className={cn(FIELD_BASE, 'h-auto resize-y py-2.5 leading-relaxed', className || '')} {...rest} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, ...rest } = props;
  return <select className={cn(FIELD_BASE, 'cursor-pointer pr-8', className || '')} style={{ fontFamily: 'inherit', ...(rest.style || {}) }} {...rest} />;
}

export function Label({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <label className={cn('text-sm font-medium leading-none text-foreground/90', className)}>{children}</label>;
}

/* ============================ Switch ============================ */
export function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cn(
        'relative inline-flex h-5.5 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-muted',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-5' : 'translate-x-1',
        )}
      />
    </button>
  );
}

/* ============================ Progress ============================ */
export function Progress({ value = 0, className = '' }: { value?: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ============================ StatCard（监控磁贴） ============================ */
export function StatCard({
  label,
  value,
  color,
  hint,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  color?: string;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <Card className="relative overflow-hidden">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: color || 'hsl(var(--primary))' }} aria-hidden />
      <CardContent>
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
          {icon && <IconBox icon={icon} tone="primary" size="md" />}
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span
            className="text-3xl font-bold tabular-nums tracking-tight text-foreground"
            style={color ? { color } : undefined}
          >
            {value}
          </span>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================ EmptyState ============================ */
export function EmptyState({
  icon,
  title,
  hint,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && (
        <div className="mb-4">
          <IconBox icon={icon} tone="mute" size="lg" variant="soft" />
        </div>
      )}
      <div className="text-sm font-semibold text-foreground">{title}</div>
      {(description ?? hint) && <div className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">{description ?? hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ============================ Spinner ============================ */
export function Spinner({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
      {label}
    </div>
  );
}

/* ============================ Modal ============================ */
// 用 Portal 渲染到 body，脱离 Layout 容器，fixed 始终相对 viewport：
//   - 弹框始终全屏居中（与表格行位置无关）
//   - 灰色遮罩覆盖整个视口（不再"奇怪的范围"）
//   - 打开时锁定 body 滚动，防止背景滚动穿透
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  const widths: Record<string, string> = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className={cn('card max-h-[90vh] w-full overflow-auto shadow-2xl', widths[size])}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ============================ SegTabs（分段控件） ============================ */
export function SegTabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { key: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (k: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-[var(--radius)] border border-border bg-muted/50 p-1">
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            onClick={() => onChange(it.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[calc(var(--radius)-3px)] px-3 py-1.5 text-sm transition-colors',
              active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {it.icon}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/* ============================ Table 辅助 ============================ */
export function Table({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <table className={cn('ehs-table', className)}>{children}</table>;
}
export function Thead({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <thead className={className}>{children}</thead>;
}
export function Tbody({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <tbody className={className}>{children}</tbody>;
}
export function Th({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <th className={className}>{children}</th>;
}
export function Td({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <td className={className}>{children}</td>;
}
