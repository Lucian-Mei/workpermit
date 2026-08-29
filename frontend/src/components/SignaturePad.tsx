import React, { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@/components/ui';
import { Eraser, Check, X, PenLine } from 'lucide-react';

/**
 * canvas 手写签名板（移动端触屏 / 桌面鼠标均可）。
 * 用于现场交底/作业票签字：承包商在陪同人员手机上手写签名，输出 base64 PNG。
 */
export function SignaturePad({
  onConfirm,
  onCancel,
  withName = true,
  role,
  height = 200,
}: {
  onConfirm: (payload: { name: string; role?: string; signImg: string }) => void;
  onCancel?: () => void;
  withName?: boolean;
  role?: string;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // 适配 DPR，保证清晰
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
  }, [height]);

  function pos(e: React.MouseEvent | React.TouchEvent): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const p = 'touches' in e ? e.touches[0] : (e as React.MouseEvent);
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
  }

  function start(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    drawing.current = true;
    last.current = pos(e);
  }
  function move(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext('2d')!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current!.x, last.current!.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    setDirty(true);
  }
  function end() {
    drawing.current = false;
    last.current = null;
  }

  function clear() {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setDirty(false);
  }

  function confirm() {
    if (!dirty) return;
    if (withName && !name.trim()) return;
    const dataUrl = canvasRef.current!.toDataURL('image/png');
    onConfirm({ name: name.trim(), role, signImg: dataUrl });
  }

  return (
    <div className="space-y-3">
      {withName && (
        <Input placeholder="签字人姓名（如承包商张三）" value={name} onChange={(e) => setName(e.target.value)} />
      )}
      <div className="rounded-[var(--radius)] border-2 border-dashed border-border bg-white">
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height, touchAction: 'none', display: 'block', borderRadius: 'var(--radius)' }}
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="mr-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          <PenLine size={13} /> 请在框内手写签名
        </span>
        <Button type="button" variant="outline" size="sm" onClick={clear}>
          <Eraser size={14} className="mr-1" /> 清除
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            <X size={14} className="mr-1" /> 取消
          </Button>
        )}
        <Button type="button" size="sm" onClick={confirm} disabled={!dirty || (withName && !name.trim())}>
          <Check size={14} className="mr-1" /> 确认签名
        </Button>
      </div>
    </div>
  );
}

export default SignaturePad;
