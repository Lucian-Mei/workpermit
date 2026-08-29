import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './ui';

// 统一弹出层：三个顶栏按钮（皮肤 / 消息 / 账号）共用，保证外观与移动端行为一致：
// - 通过 Portal 渲染到 body，避免被顶栏/滚动容器裁剪或变透明
// - 实底色背景（hsl(var(--card))），绝不使用半透明
// - fixed 定位，按触发按钮实时计算位置，移动端自动收口宽度并限高滚动
// - 点击外部 / Esc / 滚动 自动关闭
export function Popover({
  trigger,
  children,
  panelClassName,
  width = 'min(calc(100vw - 2rem), 20rem)',
  align = 'right',
  padding = true,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger: (args: { open: boolean; toggle: () => void; ref: React.Ref<HTMLButtonElement> }) => React.ReactNode;
  children: React.ReactNode;
  panelClassName?: string;
  width?: string;
  align?: 'right' | 'left';
  padding?: boolean;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? !!controlledOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternalOpen(v);
    onOpenChange?.(v);
  };

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right?: number; left?: number } | null>(null);

  function place() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const next: { top: number; right?: number; left?: number } = { top: r.bottom + 8 };
    if (align === 'right') next.right = Math.max(8, Math.round(window.innerWidth - r.right));
    else next.left = Math.max(8, Math.round(r.left));
    setPos(next);
  }

  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onReflow() {
      place();
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open]);

  return (
    <>
      {trigger({
        open,
        toggle: () => setOpen(!open),
        ref: triggerRef,
      })}
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            className={cn(
              'fixed z-[60] max-h-[min(80vh,30rem)] overflow-y-auto rounded-xl border border-border text-foreground shadow-xl',
              padding ? 'p-3' : 'p-0',
              panelClassName,
            )}
            style={{
              top: pos.top,
              right: pos.right,
              left: pos.left,
              width,
              backgroundColor: 'hsl(var(--card))',
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
