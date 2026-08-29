import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '@/api/client';
import { SignaturePad } from '@/components/SignaturePad';
import { SIGN_ROLES } from '@/constants';
import { PenLine, CheckCircle, AlertTriangle } from 'lucide-react';

// 公开签字页（扫码进入，无需登录）：
// - 培训(token generic)：通用签字，不提示/不要求填写姓名；
// - 作业票：按角色签字，姓名可选（满足“其他签字页不提前填人名”）。
export default function PublicSign() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [role, setRole] = useState('worker');

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const { data } = await api.get(`/public/sign/${token}`);
        setInfo(data);
      } catch (e: any) {
        setErr(e.response?.data?.message || '签字链接无效或已过期');
      }
    })();
  }, [token]);

  async function submit(payload: { name: string; role?: string; signImg: string }) {
    setBusy(true); setErr('');
    try {
      await api.post(`/public/sign/${token}`, payload);
      setDone(true);
    } catch (e: any) {
      setErr(e.response?.data?.message || '提交失败');
    } finally {
      setBusy(false);
    }
  }

  if (err) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center text-destructive flex flex-col items-center gap-2">
          <AlertTriangle size={28} />
          <div className="text-sm">{err}</div>
        </div>
      </div>
    );
  }

  if (!info) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">加载中…</div>;
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center text-success flex flex-col items-center gap-2">
          <CheckCircle size={32} />
          <div className="text-sm">签字已提交，感谢配合！</div>
          <div className="text-xs text-muted-foreground">可关闭本页面；如需他人继续签字，请重新扫码。</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card rounded-xl border border-border shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2 text-primary font-medium">
          <PenLine size={18} />
          <span>{info.title || (info.targetType === 'training' ? '安全培训签字' : '现场签字')}</span>
        </div>

        {info.generic ? (
          <div className="text-xs text-muted-foreground">请在下方框内手写签名，确认后提交即可（无需填写姓名）。如有多人，请依次扫码签名。</div>
        ) : (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">签字角色（必选）</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm">
              {Object.entries(SIGN_ROLES).map(([k, v]: any) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <div className="text-[11px] text-muted-foreground">姓名可选，不强制填写。</div>
          </div>
        )}

        <SignaturePad
          withName={false}
          role={role}
          onConfirm={(p) => submit({ name: p.name, role: p.role, signImg: p.signImg })}
        />

        {err && <div className="text-xs text-destructive">{err}</div>}
        {busy && <div className="text-xs text-muted-foreground">提交中…</div>}
      </div>
    </div>
  );
}
