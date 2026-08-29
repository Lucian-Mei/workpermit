import React, { useEffect, useState } from 'react';
import { cn } from '@/components/ui';

function isValidDate(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d).getTime());
}
function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(t);
}

export interface DateTimeInputProps {
  value?: string;
  onChange?: (iso: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** 仅日期（不带时间）：单个 type=date；否则单个 type=datetime-local（一次同时选日期+时间） */
  dateOnly?: boolean;
}

/**
 * 统一日期/时间输入：单个浏览器原生控件。
 * - 含时间：type="datetime-local"，一个弹层同时选日期 + 时间，回传 YYYY-MM-DDTHH:mm
 * - 仅日期：type="date"，回传 YYYY-MM-DD
 * 两种格式均与后端及现有校验完全兼容（原并列 date+time 双控件即“选两次”的根源，已消除）。
 */
export function DateTimeInput({ value, onChange, placeholder, className, disabled, dateOnly = false }: DateTimeInputProps) {
  const [local, setLocal] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => { setLocal(value || ''); }, [value]);

  const invalid = touched && local !== '' && (() => {
    if (dateOnly) return !isValidDate(local);
    const [d, t] = local.split('T');
    return !isValidDate(d) || !isValidTime(t || '');
  })();

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setTouched(true);
    const v = e.target.value; // datetime-local 回传 YYYY-MM-DDTHH:mm；date 回传 YYYY-MM-DD
    setLocal(v);
    if (!v) { onChange?.(''); return; }
    if (dateOnly) {
      if (isValidDate(v)) onChange?.(v);
      return;
    }
    const [d, t] = v.split('T');
    if (isValidDate(d) && isValidTime(t || '')) onChange?.(`${d}T${t}`);
  }

  return (
    <div
      className={cn(
        'flex w-full items-center gap-2 overflow-hidden rounded-[var(--radius)] border border-input bg-card px-3 text-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/35',
        invalid && 'border-destructive focus-within:border-destructive focus-within:ring-destructive/35',
        disabled && 'opacity-50',
        className || '',
      )}
    >
      <input
        type={dateOnly ? 'date' : 'datetime-local'}
        disabled={disabled}
        value={local}
        onChange={handleChange}
        onBlur={() => setTouched(true)}
        className="flex-1 min-w-0 bg-transparent py-2 outline-none placeholder:text-muted-foreground/60"
        aria-label={dateOnly ? '日期' : '日期时间'}
      />
      {placeholder && !local && (
        <span className="sr-only">{placeholder}</span>
      )}
    </div>
  );
}

export default DateTimeInput;
