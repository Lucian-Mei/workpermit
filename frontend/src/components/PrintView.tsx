// 作业票打印预览：用项目内 Modal 组件（居中卡片，自带点遮罩关闭 + ESC 关闭 + body 锁滚动）。
// A4 画布按 Modal 内容宽度自动缩放，留四周遮罩可点击关闭。
// 打印：window.open 新窗口写入 A4 HTML 再触发打印（WorkBuddy / iframe 内 print() 易卡死）。
import React, { useEffect, useState } from 'react';
import { Button, Modal } from '@/components/ui';
import { Printer, FileDown, X } from 'lucide-react';
import { loadTemplates, pickTemplate, loadAssignments, PrintTemplate, A4_W, A4_H, resolveField } from '@/utils/printTemplate';
import TemplateElement from '@/components/TemplateElement';

// 通过隐藏 iframe 打印：避免 window.open 在 WorkBuddy/iframe 内被拦截，也避免主页面 body 锁滚动影响打印
function printViaIframe(template: PrintTemplate, data: any) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);
  const w = iframe.contentWindow;
  if (!w) {
    document.body.removeChild(iframe);
    alert('当前环境不支持打印，请联系管理员。');
    return;
  }
  const pages = [1, 2].filter((p) => template.elements.some((e) => (e.page || 1) === p));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>打印 - ${esc(data?.permitNo || '作业票')}</title>
<style>
  @page { size: A4; margin: 0; }
  body { margin: 0; background: #fff; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  .page { position: relative; width: ${A4_W}mm; height: ${A4_H}mm; background: #fff; page-break-after: always; overflow: hidden; }
  .page:last-child { page-break-after: auto; }
  .el { position: absolute; box-sizing: border-box; display: flex; gap: 1mm; padding: 0 1mm; }
  .el.text, .el.field { flex-direction: row; overflow: visible; }
  .el .label { font-weight: 600; flex-shrink: 0; white-space: nowrap; }
  .el .value { flex: 1; min-width: 0; white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; line-height: 1.35; }
  .el .value.single-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .el.line { padding: 0; border-top: 0.3pt solid #999; height: 0; }
  .el.sign { align-items: center; }
  .el.sign .role { white-space: nowrap; flex-shrink: 0; font-weight: 600; font-size: 8pt; }
</style>
</head><body>
${renderToHtml(template, data)}
</body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
  // 等待渲染后打印；打印完成移除 iframe
  const cleanup = () => {
    try { document.body.removeChild(iframe); } catch {}
  };
  const trigger = () => {
    try {
      w.focus();
      w.print();
    } catch (e) {
      alert('打印失败：' + (e?.message || e));
    }
    setTimeout(cleanup, 800);
  };
  if (w.document.readyState === 'complete') {
    setTimeout(trigger, 150);
  } else {
    w.addEventListener('load', () => setTimeout(trigger, 150), { once: true });
  }
}

function renderToHtml(template: PrintTemplate, data: any): string {
  const pageEls = new Map<number, any[]>();
  for (const el of template.elements) {
    const p = el.page || 1;
    if (!pageEls.has(p)) pageEls.set(p, []);
    pageEls.get(p)!.push(el);
  }
  const pages: string[] = [];
  for (const [p, els] of [...pageEls.entries()].sort((a, b) => a[0] - b[0])) {
    const parts: string[] = [];
    for (const el of els) {
      const isSingle = !!el.singleLine;
      const styleArr = [
        `left:${el.x}mm`, `top:${el.y}mm`, `width:${el.w}mm`,
        el.type === 'line' ? 'height:0' : `min-height:${el.h}mm${isSingle ? `;height:${el.h}mm;overflow:hidden` : ''}`,
        `font-size:${(el.fontSize || 8) * 0.353}pt`,
        el.bold ? 'font-weight:700' : '',
        el.color ? `color:${el.color}` : '',
        `text-align:${el.align || 'left'}`,
        `justify-content:${el.valign === 'top' ? 'flex-start' : el.valign === 'bottom' ? 'flex-end' : 'center'}`,
        `align-items:${el.valign === 'top' ? 'flex-start' : el.valign === 'bottom' ? 'flex-end' : 'center'}`,
        el.border ? 'border:0.3pt solid #999' : '',
      ].filter(Boolean).join(';');
      let inner = '';
      if (el.type === 'image' && el.src) {
        inner = `<img src="${el.src}" style="max-width:100%;max-height:100%;object-fit:contain;display:block">`;
      } else if (el.type === 'line') {
        inner = '';
      } else if (el.type === 'sign') {
        inner = `<span class="role">${esc(el.signRole || '签字')}</span><span style="flex:1"></span>`;
      } else {
        const label = el.type === 'field' ? (el.label || '') : '';
        const value = el.type === 'field' ? resolveField(data, el.fieldKey || '') : (el.text || '');
        const always = el.always;
        if (label) inner += `<span class="label">${esc(label)}</span>`;
        if (value || always) inner += `<span class="value${isSingle ? ' single-line' : ''}">${esc(value)}</span>`;
      }
      parts.push(`<div class="el ${el.type}" style="${styleArr}">${inner}</div>`);
    }
    pages.push(`<div class="page">${parts.join('')}</div>`);
  }
  return pages.join('\n');
}

function esc(s: any): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

export default function PrintView({ data, onClose }: { data: any; onClose: () => void }) {
  const [template, setTemplate] = useState<PrintTemplate | null>(null);
  const [containerW, setContainerW] = useState(800);

  useEffect(() => {
    (async () => {
      const list = await loadTemplates();
      await loadAssignments();
      setTemplate(pickTemplate(list, 'work_permit', data?.type));
    })();
  }, [data?.type]);

  // A4 缩放到容器宽度（按 px 测量 → 视觉 1:1 在屏幕看到）
  useEffect(() => {
    const update = () => {
      // Modal 内容区 max-w-4xl ≈ 896px - padding，预留按 760px 计算
      const w = Math.min(760, (window.innerWidth - 80));
      setContainerW(w);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // A4 在屏幕的 px 尺寸（按 96dpi 换算 mm）：A4_W=210mm → 793.7px
  const a4w = (A4_W / 25.4) * 96;
  const a4h = (A4_H / 25.4) * 96;
  const scale = containerW / a4w;
  const visualW = containerW;

  function doPrint() {
    if (!template) return;
    printViaIframe(template, data);
  }

  return (
    <Modal open onClose={onClose} title={`打印预览 - ${data?.permitNo || ''}`} size="xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span>提示：点「打印」会弹出浏览器打印窗口（含 A4 内容）。点击此弹窗外侧或按 ESC 关闭预览。</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={doPrint}>
              <Printer size={14} className="mr-1" /> 打印 / 导出 PDF
            </Button>
            <Button size="sm" variant="secondary" onClick={onClose}>
              <X size={14} className="mr-1" /> 关闭
            </Button>
          </div>
        </div>

        {template ? (
          <div className="flex justify-center overflow-auto bg-muted/20 p-4 rounded-md" style={{ maxHeight: '70vh' }}>
            <div
              style={{
                width: `${visualW}px`,
                backgroundImage: `linear-gradient(#e5e7eb 1px, transparent 1px), linear-gradient(90deg, #e5e7eb 1px, transparent 1px)`,
                backgroundSize: `${20 * scale}px ${20 * scale}px`,
                padding: `${8 * scale}px`,
              }}
            >
              {[1, 2].filter((p) => template.elements.some((e) => (e.page || 1) === p)).map((p) => (
                <div
                  key={p}
                  className="print-area relative bg-white shadow-md mb-2"
                  style={{
                    width: `${a4w}px`,
                    height: `${a4h}px`,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                    marginBottom: `${8 * scale}px`,
                  }}
                  data-page={p}
                >
                  {template.elements.filter((e) => (e.page || 1) === p).map((el) => (
                    <div
                      key={el.id}
                      style={{
                        position: 'absolute',
                        left: `${(el.x / 25.4) * 96}px`,
                        top: `${(el.y / 25.4) * 96}px`,
                        width: `${(el.w / 25.4) * 96}px`,
                        height: el.type === 'line' ? 0 : `${(el.h / 25.4) * 96}px`,
                      }}
                    >
                      <TemplateElement el={el} data={data} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="py-16 text-center text-sm text-muted-foreground">模板加载中…</div>
        )}
      </div>
    </Modal>
  );
}