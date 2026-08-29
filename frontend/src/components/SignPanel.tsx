import React, { useState } from 'react';
import api from '@/api/client';
import { Card, CardContent, Button, Input, Select } from '@/components/ui';
import { PenLine, QrCode } from 'lucide-react';
import { SIGN_ROLES, requiredSignRoles } from '@/constants';
import { QRCodeCanvas } from 'qrcode.react';

// 现场多方签字面板：展示已签字（含必填徽标），并支持生成手机签字二维码
export default function SignPanel({
  wpId,
  base,
  signatures,
  isHazardous,
  type,
  canSign,
}: {
  wpId: string;
  base: 'e-permits' | 'work-permits';
  signatures: any[];
  isHazardous: boolean;
  type: string;
  canSign: boolean;
}) {
  const [role, setRole] = useState('worker');
  const [name, setName] = useState('');
  const [qr, setQr] = useState<{ url: string; role: string } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const required = requiredSignRoles(type, isHazardous);
  const have = new Set((signatures || []).map((s) => s.role));
  const missing = required.filter((r) => !have.has(r));

  async function gen() {
    setErr(''); setBusy(true);
    try {
      const { data } = await api.post(`/${base}/${wpId}/sign-tokens`, { role, signerName: name || undefined, multi: true, ttlHours: 72 });
      setQr({ url: data.url, role });
    } catch (e: any) {
      setErr(e.response?.data?.message || '生成失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="font-medium flex items-center gap-1.5">
          <PenLine size={15} className="text-primary" /> 现场签字
          {missing.length > 0 && (
            <span className="text-[11px] text-destructive">缺：{missing.map((m) => SIGN_ROLES[m]?.label || m).join('、')}</span>
          )}
        </div>

        {/* 已签字 */}
        {(!signatures || signatures.length === 0) && (
          <div className="text-xs text-muted-foreground">暂无签字记录。</div>
        )}
        <div className="flex flex-wrap gap-2">
          {(signatures || []).map((s: any, i: number) => (
            <div key={i} className="rounded-lg border border-border p-1.5 text-center w-28">
              <img src={s.signImg} alt="" className="h-12 w-full object-contain" />
              <div className="text-[11px] mt-1">{s.name || (SIGN_ROLES[s.role]?.label || s.role)}</div>
              <div className="text-[10px] text-muted-foreground">{SIGN_ROLES[s.role]?.label || s.role}</div>
            </div>
          ))}
        </div>

        {/* 必填说明 */}
        <div className="text-[11px] text-muted-foreground">
          必签角色：{required.map((r) => SIGN_ROLES[r]?.label || r).join('、')}
          {!have.has('worker') && !have.has('contractor') && '、作业人/承包商负责人（至少其一）'}
        </div>

        {/* 生成手机签字二维码 */}
        {canSign && (
          <div className="border-t border-border pt-2 space-y-2">
            <div className="text-xs font-medium">生成外部人员手机签字二维码</div>
            <div className="flex gap-2">
              <Select value={role} onChange={(e) => setRole(e.target.value)} className="flex-1">
                {Object.entries(SIGN_ROLES).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}{required.includes(k) ? '（必签）' : ''}</option>
                ))}
              </Select>
              <Input placeholder="签字人姓名（可选）" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
            </div>
            <Button variant="secondary" size="lg" className="w-full" onClick={gen} disabled={busy}>
              <QrCode size={16} className="mr-1" /> {busy ? '生成中…' : '生成签字二维码'}
            </Button>
            {err && <div className="text-xs text-destructive">{err}</div>}
            {qr && (
              <div className="rounded border border-border p-3 text-center bg-card">
                <div className="inline-block rounded bg-white p-2">
                  <QRCodeCanvas value={qr.url} size={160} />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">扫码在手机上手写签字（72 小时内可多人反复签）</div>
                <a href={qr.url} target="_blank" rel="noreferrer" className="block mt-1 text-[10px] text-primary underline break-all">{qr.url}</a>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
