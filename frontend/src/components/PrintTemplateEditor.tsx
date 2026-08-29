// 打印模板可视化编辑器：A4 画布 + 拖拽移动/缩放 + 字段库 + 属性面板
// 类似 PPT/Word 的所见即所得操作，无需写代码。支持撤销/重做、插入图片/表格。
import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, PageHeader } from '@/components/ui';
import {
  A4_W,
  A4_H,
  PRINT_FIELDS,
  PRINT_FIELD_GROUPS,
  newElement,
  uid,
  PrintElement,
  PrintTemplate,
  fieldLabel,
} from '@/utils/printTemplate';
import TemplateElement, { SAMPLE_PERMIT } from '@/components/TemplateElement';
import {
  Save, ArrowLeft, Type, Minus, PenLine, Trash2, MousePointer2, Copy,
  Undo2, Redo2, ImagePlus, Table2,
} from 'lucide-react';

// 画布 px/mm 比例动态测量：不同缩放（iframe 预览/浏览器 zoom）下精确跟随鼠标。
// 若测量失败回退 96dpi 标准值（1mm ≈ 3.78px）。
function measurePxPerMm(container: HTMLElement | null): number {
  const canvas = container?.querySelector<HTMLElement>('[data-a4]');
  if (canvas) {
    const w = canvas.getBoundingClientRect().width;
    if (w > 0) return w / 210; // A4 宽 210mm
  }
  return 96 / 25.4;
}

// 深拷贝元素（含 table 嵌套数组）
function cloneEl(e: PrintElement): PrintElement {
  return e.table ? { ...e, table: JSON.parse(JSON.stringify(e.table)) } : { ...e };
}

// 图片压缩：最长边 ≤1200px，JPEG 质量 0.8，返回 base64 dataURL
function compressImage(file: File): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const max = 1200;
      let { width, height } = img;
      if (width > max || height > max) {
        const r = Math.min(max / width, max / height);
        width = Math.round(width * r);
        height = Math.round(height * r);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
      try { resolve(canvas.toDataURL('image/jpeg', 0.8)); }
      catch { resolve(''); }
    };
    img.onerror = () => resolve('');
    img.src = URL.createObjectURL(file);
  });
}

export default function PrintTemplateEditor({
  template,
  onSave,
  onClose,
}: {
  template: PrintTemplate;
  onSave: (t: PrintTemplate) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(template.name);
  const [elements, setElements] = useState<PrintElement[]>(template.elements);
  const [selId, setSelId] = useState<string | null>(null);
  // 撤销/重做历史栈（存「操作前快照」）
  const historyRef = useRef<PrintElement[][]>([]);
  const redoRef = useRef<PrintElement[][]>([]);
  const [, setHistTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{
    id: string;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    ox: number;
    oy: number;
    ow: number;
    oh: number;
    pxPerMm: number;
    startSnapshot: PrintElement[];
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const sel = elements.find((e) => e.id === selId) || null;
  const canUndo = historyRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;

  // 提交一次变更：把当前 elements 快照压入撤销栈
  function pushHistory(snapshot: PrintElement[]) {
    historyRef.current.push(snapshot.map(cloneEl));
    if (historyRef.current.length > 60) historyRef.current.shift();
    redoRef.current = [];
    setHistTick((t) => t + 1);
  }
  function commit(next: PrintElement[]) {
    pushHistory(elements);
    setElements(next);
  }
  function undo() {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current.pop()!;
    redoRef.current.push(elements.map(cloneEl));
    setElements(prev);
    setHistTick((t) => t + 1);
  }
  function redo() {
    if (redoRef.current.length === 0) return;
    const next = redoRef.current.pop()!;
    historyRef.current.push(elements.map(cloneEl));
    setElements(next);
    setHistTick((t) => t + 1);
  }

  // Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y 重做
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      // 在输入框/文本域/下拉框内编辑时，保留原生撤销行为，不拦截
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
      else if (k === 'z') { e.preventDefault(); undo(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements]);

  // 属性面板修改：记录历史（可撤销）
  function patchEl(id: string, patch: Partial<PrintElement>) {
    commit(elements.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }
  // 拖拽中用：不记录历史，由 pointerup 统一提交
  function patchElLive(id: string, patch: Partial<PrintElement>) {
    setElements((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function clamp(v: number, min: number, max: number) {
    return Math.min(Math.max(v, min), max);
  }

  function onPointerDown(e: React.PointerEvent, id: string, mode: 'move' | 'resize') {
    e.preventDefault();
    e.stopPropagation();
    setSelId(id);
    const el = elements.find((x) => x.id === id);
    if (!el) return;
    drag.current = {
      id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      ox: el.x,
      oy: el.y,
      ow: el.w,
      oh: el.h,
      pxPerMm: measurePxPerMm(canvasRef.current),
      startSnapshot: elements.map(cloneEl),
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch { /* 忽略 */ }
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.pxPerMm;
    const dy = (e.clientY - d.startY) / d.pxPerMm;
    if (d.mode === 'move') {
      const el = elements.find((x) => x.id === d.id);
      const w = el?.w ?? 0;
      const h = el?.h ?? 0;
      patchElLive(d.id, { x: clamp(d.ox + dx, 0, A4_W - w), y: clamp(d.oy + dy, 0, A4_H - h) });
    } else {
      patchElLive(d.id, { w: clamp(d.ow + dx, 8, A4_W - (elements.find((x) => x.id === d.id)?.x || 0)), h: clamp(d.oh + dy, 3, A4_H - (elements.find((x) => x.id === d.id)?.y || 0)) });
    }
  }

  function onPointerUp() {
    const d = drag.current;
    if (d) {
      // 拖拽结束：以起始快照入撤销栈（若有实际位移）
      const el = elements.find((x) => x.id === d.id);
      if (el && (el.x !== d.ox || el.y !== d.oy || el.w !== d.ow || el.h !== d.oh)) {
        pushHistory(d.startSnapshot);
      }
    }
    drag.current = null;
  }

  function addFromField(key: string) {
    const def = PRINT_FIELDS.find((f) => f.key === key);
    if (!def) return;
    const el = newElement('field', 12, 12, 92, 8);
    el.fieldKey = key;
    el.label = def.label + '：';
    commit([...elements, el]);
    setSelId(el.id);
  }

  function addElement(type: 'text' | 'line' | 'sign' | 'image' | 'table') {
    const el = newElement(type);
    if (type === 'sign') {
      el.signRole = el.signRole || '签字';
      el.h = 16;
    }
    commit([...elements, el]);
    setSelId(el.id);
  }

  // 插入图片：触发文件选择 → 压缩 → base64 存入元素
  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const src = await compressImage(f);
    if (!src) { alert('图片处理失败，请换一张图片'); return; }
    const el = newElement('image', 12, 12, 60, 40);
    el.src = src;
    commit([...elements, el]);
    setSelId(el.id);
  }
  function replaceImage() {
    if (sel) fileRef.current?.click();
  }

  // 表格行列调整
  function resizeTable(id: string, dr: number, dc: number) {
    const el = elements.find((e) => e.id === id);
    if (!el?.table) return;
    const rows = clamp((el.table.rows || 1) + dr, 1, 30);
    const cols = clamp((el.table.cols || 1) + dc, 1, 12);
    const cells = Array.from({ length: rows }, (_, r) => {
      const rr = (el.table?.cells?.[r] || []).slice(0, cols);
      while (rr.length < cols) rr.push('');
      return rr;
    });
    commit(elements.map((e) => (e.id === id ? { ...e, table: { rows, cols, cells } } : e)));
  }
  function setTableCell(id: string, r: number, c: number, v: string) {
    const el = elements.find((e) => e.id === id);
    if (!el?.table) return;
    const cells = JSON.parse(JSON.stringify(el.table.cells || []));
    while (cells.length <= r) cells.push([]);
    while ((cells[r] || []).length <= c) cells[r].push('');
    cells[r][c] = v;
    commit(elements.map((e) => (e.id === id ? { ...e, table: { ...el.table, cells } } : e)));
  }

  function duplicate() {
    if (!sel) return;
    const copy = { ...cloneEl(sel), id: uid(), x: Math.min(sel.x + 3, A4_W - sel.w), y: Math.min(sel.y + 3, A4_H - sel.h) };
    commit([...elements, copy]);
    setSelId(copy.id);
  }

  function removeSel() {
    if (!sel) return;
    commit(elements.filter((e) => e.id !== sel.id));
    setSelId(null);
  }

  function save() {
    onSave({ ...template, name: name || '未命名模板', elements, updatedAt: new Date().toISOString() });
  }

  return (
    <div className="flex h-full flex-col">
      {/* 隐藏文件选择（插入图片用） */}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFilePicked} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="w-56" placeholder="模板名称" />
        <Button variant="secondary" onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)"><Undo2 size={15} /></Button>
        <Button variant="secondary" onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)" ><Redo2 size={15} /></Button>
        <Button onClick={save}><Save size={15} className="mr-1" /> 保存模板</Button>
        <Button variant="ghost" onClick={onClose}><ArrowLeft size={15} className="mr-1" /> 返回</Button>
        <span className="ml-auto text-xs text-muted-foreground">
          画布为 A4（210×297mm），选中元素后可拖拽移动、拖右下角缩放；Ctrl+Z 撤销 / Ctrl+Shift+Z 重做
        </span>
      </div>

      <div className="flex flex-1 gap-3 overflow-hidden">
        {/* 左栏：字段库 + 元素工具 */}
        <div className="w-52 shrink-0 space-y-3 overflow-auto rounded-xl border border-border bg-[hsl(var(--card))] p-3">
          <div className="text-xs font-semibold text-muted-foreground">添加元素</div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => addElement('text')}><Type size={13} className="mr-1" />文本</Button>
            <Button size="sm" variant="secondary" onClick={() => addElement('sign')}><PenLine size={13} className="mr-1" />签字框</Button>
            <Button size="sm" variant="secondary" onClick={() => addElement('line')}><Minus size={13} className="mr-1" />分隔线</Button>
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}><ImagePlus size={13} className="mr-1" />图片</Button>
            <Button size="sm" variant="secondary" onClick={() => addElement('table')}><Table2 size={13} className="mr-1" />表格</Button>
          </div>
          <div className="text-xs font-semibold text-muted-foreground">系统字段（点击添加）</div>
          {PRINT_FIELD_GROUPS.map((g) => {
            const items = PRINT_FIELDS.filter((f) => f.group === g.key);
            return (
              <div key={g.key}>
                <div className="mb-1 text-[11px] font-medium text-muted-foreground/70">{g.label}</div>
                <div className="flex flex-wrap gap-1">
                  {items.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => addFromField(f.key)}
                      className="rounded border border-border px-1.5 py-0.5 text-[11px] text-foreground transition hover:border-primary hover:text-primary"
                      title={`${f.label}（${f.key}）`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* 中栏：A4 画布 */}
        <div
          ref={canvasRef}
          className="flex-1 overflow-auto rounded-xl border border-border bg-muted/40 p-4"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <div
            data-a4
            className="relative mx-auto bg-white shadow-2xl"
            style={{ width: `${A4_W}mm`, height: `${A4_H}mm` }}
            onClick={() => setSelId(null)}
          >
            {elements.filter((e) => (e.page || 1) === 1).map((el) => {
              const isSel = el.id === selId;
              return (
                <div
                  key={el.id}
                  data-elid={el.id}
                  onPointerDown={(e) => onPointerDown(e, el.id, 'move')}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute"
                  style={{
                    left: `${el.x}mm`,
                    top: `${el.y}mm`,
                    width: `${el.w}mm`,
                    height: `${el.h}mm`,
                    outline: isSel ? '1px solid #3b82f6' : 'none',
                    cursor: 'move',
                    zIndex: isSel ? 10 : 1,
                  }}
                >
                  <TemplateElement el={el} data={SAMPLE_PERMIT} />
                  {isSel && (
                    <>
                      {/* 选中边框（虚线） */}
                      <div className="pointer-events-none absolute -inset-px border border-dashed border-primary" />
                      {/* 右下角缩放柄 */}
                      <div
                        onPointerDown={(e) => onPointerDown(e, el.id, 'resize')}
                        className="absolute -right-1.5 -bottom-1.5 h-3.5 w-3.5 cursor-se-resize rounded-sm border border-primary bg-primary"
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 右栏：属性面板 */}
        <div className="w-64 shrink-0 space-y-3 overflow-auto rounded-xl border border-border bg-[hsl(var(--card))] p-3">
          {sel ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">元素属性</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={duplicate} title="复制"><Copy size={14} /></Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={removeSel} title="删除"><Trash2 size={14} /></Button>
                </div>
              </div>

              <label className="block text-xs text-muted-foreground">
                类型
                <span className="mt-0.5 block text-sm text-foreground">
                  {sel.type === 'field' ? '系统字段' : sel.type === 'text' ? '文本' : sel.type === 'sign' ? '签字框' : sel.type === 'image' ? '图片' : sel.type === 'table' ? '表格' : '分隔线'}
                </span>
              </label>

              {sel.type === 'field' && (
                <>
                  <label className="block text-xs text-muted-foreground">
                    绑定字段
                    <select
                      className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-sm"
                      value={sel.fieldKey}
                      onChange={(e) => patchEl(sel.id, { fieldKey: e.target.value })}
                    >
                      {PRINT_FIELDS.map((f) => (
                        <option key={f.key} value={f.key}>{f.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-muted-foreground">
                    前缀标签（可改）
                    <Input value={sel.label || ''} onChange={(e) => patchEl(sel.id, { label: e.target.value })} className="mt-0.5" />
                  </label>
                </>
              )}
              {sel.type === 'text' && (
                <label className="block text-xs text-muted-foreground">
                  文本内容
                  <Input value={sel.text || ''} onChange={(e) => patchEl(sel.id, { text: e.target.value })} className="mt-0.5" />
                </label>
              )}
              {sel.type === 'sign' && (
                <label className="block text-xs text-muted-foreground">
                  签字角色名
                  <Input value={sel.signRole || ''} onChange={(e) => patchEl(sel.id, { signRole: e.target.value })} className="mt-0.5" />
                </label>
              )}
              {sel.type === 'image' && (
                <Button size="sm" variant="secondary" className="w-full" onClick={() => fileRef.current?.click()}>
                  <ImagePlus size={13} className="mr-1" /> 更换图片
                </Button>
              )}
              {sel.type === 'table' && (
                <>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>行列</span>
                    <div className="flex items-center gap-1">
                      <span>行</span>
                      <Button size="sm" variant="ghost" onClick={() => resizeTable(sel.id, -1, 0)}>-</Button>
                      <span className="w-5 text-center text-foreground">{sel.table?.rows ?? 0}</span>
                      <Button size="sm" variant="ghost" onClick={() => resizeTable(sel.id, 1, 0)}>+</Button>
                      <span className="ml-1">列</span>
                      <Button size="sm" variant="ghost" onClick={() => resizeTable(sel.id, 0, -1)}>-</Button>
                      <span className="w-5 text-center text-foreground">{sel.table?.cols ?? 0}</span>
                      <Button size="sm" variant="ghost" onClick={() => resizeTable(sel.id, 0, 1)}>+</Button>
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground">编辑单元格（从左到右按行填写）</div>
                  <div
                    className="grid max-h-44 gap-1 overflow-auto"
                    style={{ gridTemplateColumns: `repeat(${sel.table?.cols ?? 1}, minmax(0, 1fr))` }}
                  >
                    {Array.from({ length: (sel.table?.rows ?? 0) * (sel.table?.cols ?? 0) }).map((_, i) => {
                      const r = Math.floor(i / (sel.table?.cols ?? 1));
                      const c = i % (sel.table?.cols ?? 1);
                      return (
                        <Input
                          key={i}
                          value={sel.table?.cells?.[r]?.[c] ?? ''}
                          onChange={(e) => setTableCell(sel.id, r, c, e.target.value)}
                          className="px-1.5 py-0.5 text-xs"
                          placeholder="文本 或 {{字段}}"
                        />
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    单元格支持字段占位符，如 <code className="rounded bg-muted px-1">{"{{permitNo}}"}</code>
                  </p>
                </>
              )}

              {sel.type !== 'image' && (
                <label className="block text-xs text-muted-foreground">
                  字体大小（pt）
                  <Input type="number" min={6} max={48} value={sel.fontSize} onChange={(e) => patchEl(sel.id, { fontSize: Number(e.target.value) || 12 })} className="mt-0.5" />
                </label>
              )}

              {sel.type !== 'image' && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={!!sel.bold} onChange={(e) => patchEl(sel.id, { bold: e.target.checked })} />
                  加粗
                </label>
              )}

              {sel.type !== 'image' && (
                <>
                  <label className="block text-xs text-muted-foreground">
                    对齐（水平×垂直）
                    <select
                      className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-sm"
                      value={`${sel.align || 'left'}-${sel.valign || 'top'}`}
                      onChange={(e) => {
                        const [a, v] = e.target.value.split('-');
                        patchEl(sel.id, { align: a as any, valign: v as any });
                      }}
                    >
                      <option value="left-top">左上对齐</option>
                      <option value="left-middle">左中对齐</option>
                      <option value="left-bottom">左下对齐</option>
                      <option value="center-top">中上对齐</option>
                      <option value="center-middle">正中（默认）</option>
                      <option value="center-bottom">中下对齐</option>
                      <option value="right-top">右上对齐</option>
                      <option value="right-middle">右中对齐</option>
                      <option value="right-bottom">右下对齐</option>
                    </select>
                  </label>
                </>
              )}

              {sel.type !== 'image' && (
                <label className="block text-xs text-muted-foreground">
                  文字颜色
                  <div className="mt-0.5 flex items-center gap-2">
                    <input type="color" value={sel.color || '#111111'} onChange={(e) => patchEl(sel.id, { color: e.target.value })} className="h-8 w-12 cursor-pointer rounded border border-border bg-background" />
                    <Button size="sm" variant="ghost" onClick={() => patchEl(sel.id, { color: '#111111' })}>默认</Button>
                  </div>
                </label>
              )}

              {sel.type !== 'line' && sel.type !== 'image' && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={!!sel.border} onChange={(e) => patchEl(sel.id, { border: e.target.checked })} />
                  显示边框
                </label>
              )}

              <div className="border-t border-border pt-2 text-xs text-muted-foreground">
                <div className="grid grid-cols-2 gap-1">
                  <span>X: {sel.x.toFixed(1)}mm</span>
                  <span>Y: {sel.y.toFixed(1)}mm</span>
                  <span>宽: {sel.w.toFixed(1)}mm</span>
                  <span>高: {sel.h.toFixed(1)}mm</span>
                </div>
                <div className="mt-1 text-[11px]">提示：拖拽元素移动，拖右下角蓝色方块缩放</div>
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <MousePointer2 size={20} />
              <p>在画布中选中元素后<br />在此编辑属性</p>
              <p className="text-xs">从左侧字段库点击添加字段<br />或使用上方按钮添加元素</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
