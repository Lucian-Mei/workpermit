import React, { useState } from 'react';
import api from '@/api/client';
import { Card, CardContent, Button, Input, Textarea } from '@/components/ui';
import { Camera, X, CheckCircle, RotateCcw } from 'lucide-react';

// OCR 人工确认：可编辑识别字段，确认通过或退回重扫
export default function CertOcrConfirm({
  base,
  wpId,
  cert,
  canEdit,
  onDone,
}: {
  base: 'e-permits' | 'work-permits';
  wpId: string;
  cert: any;
  canEdit: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [issuer, setIssuer] = useState(cert.issuer || '');
  const [fields, setFields] = useState<Record<string, string>>(cert.ocrFields || {});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function setField(k: string, v: string) {
    setFields((f) => ({ ...f, [k]: v }));
  }
  function addField() {
    const k = prompt('字段名');
    if (k) setFields((f) => ({ ...f, [k]: '' }));
  }

  async function submit(ok: boolean) {
    setBusy(true); setErr('');
    try {
      await api.put(`/${base}/${wpId}/certificates/${cert.id}/confirm`, {
        ok,
        issuer,
        fields: ok ? fields : cert.ocrFields,
      });
      setOpen(false);
      onDone();
    } catch (e: any) {
      setErr(e.response?.data?.message || '提交失败');
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <div className="text-[11px] mt-1">
        {cert.needManual ? <span className="text-warning">⚠ 待人工确认</span> : <span className="text-success">识别完成</span>}
      </div>
    );
  }

  return (
    <>
      <button className="mt-1 text-primary underline text-xs" onClick={() => setOpen(true)}>
        人工确认 / 编辑
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 no-print" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <Card>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium flex items-center gap-1.5">
                    <Camera size={15} /> 证书 OCR 人工确认
                  </div>
                  <button className="text-muted-foreground" onClick={() => setOpen(false)}><X size={16} /></button>
                </div>

                <label className="text-xs block">
                  <span className="text-muted-foreground">发证机关</span>
                  <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} />
                </label>

                <div className="text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-muted-foreground">识别字段（可编辑）</span>
                    <button className="text-primary underline" onClick={addField}>＋字段</button>
                  </div>
                  {Object.keys(fields).length === 0 && (
                    <div className="text-[11px] text-muted-foreground">无字段（可点击「＋字段」手动添加）</div>
                  )}
                  <div className="space-y-1.5">
                    {Object.entries(fields).map(([k, v]) => (
                      <div key={k} className="flex gap-2 items-center">
                        <span className="w-24 shrink-0 text-[11px]">{k}</span>
                        <Input className="flex-1" value={v} onChange={(e) => setField(k, e.target.value)} />
                        <button
                          className="text-destructive text-xs"
                          onClick={() => setFields((f) => { const n = { ...f }; delete n[k]; return n; })}
                        >删</button>
                      </div>
                    ))}
                  </div>
                </div>

                {cert.ocrRaw && (
                  <details className="text-[11px] text-muted-foreground">
                    <summary className="cursor-pointer">原始识别文本</summary>
                    <Textarea className="mt-1" rows={3} readOnly value={cert.ocrRaw} />
                  </details>
                )}

                {err && <div className="text-xs text-destructive">{err}</div>}

                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => submit(true)} disabled={busy}>
                    <CheckCircle size={15} className="mr-1" /> 确认通过
                  </Button>
                  <Button variant="destructive" className="flex-1" onClick={() => submit(false)} disabled={busy}>
                    <RotateCcw size={15} className="mr-1" /> 退回重扫
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
