import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '@/api/client';
import { CheckCircle2, XCircle, AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';

// 公开审批确认页（邮件链接落地页，免登录，token 授权）
// - 邮件链接指向本 SPA 路由 /public/approval/:token（原后端内嵌 HTML 审批页，已收敛）
// - GET 仅拉取信息展示；同意/拒绝执行 POST（S09：防邮件网关预取误审批）
export default function PublicApproval() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ approved: boolean; status?: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const { data } = await api.get(`/public/approval/${token}`);
        setInfo(data);
      } catch (e: any) {
        setErr(e.response?.data?.message || '链接无效或已失效');
      }
    })();
  }, [token]);

  async function submit(action: 'approve' | 'reject') {
    setBusy(true); setErr('');
    try {
      const { data } = await api.post(`/public/approval/${token}`, { action });
      setDone({ approved: action === 'approve', status: data?.status });
    } catch (e: any) {
      setErr(e.response?.data?.message || '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  const stepLabel =
    info?.step === 'review' ? '部门审核' : info?.step === 'approve_ehs' ? 'EHS 审批' : info?.step === 'approve_mgr' ? '经理批准' : '审批';

  if (err) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 text-center">
          <AlertTriangle size={32} className="mx-auto text-destructive" />
          <p className="mt-2 text-sm text-destructive">{err}</p>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center text-sm text-muted-foreground">
        <Loader2 size={20} className="animate-spin mr-2" /> 加载中…
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
          {done.approved ? (
            <CheckCircle2 size={40} className="mx-auto text-success" />
          ) : (
            <XCircle size={40} className="mx-auto text-destructive" />
          )}
          <h2 className="mt-2 text-lg font-semibold">{done.approved ? '已同意，流程已推进。' : '已拒绝。'}</h2>
          {done.status && (
            <p className="mt-1 text-sm text-muted-foreground">最新状态：{done.status}</p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">该链接已失效（单次有效）。如需再次操作请登录系统。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 text-primary font-medium">
          <ShieldCheck size={18} />
          <span>作业票审批确认</span>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between border-b border-border py-1.5">
            <span className="text-muted-foreground">作业票号</span>
            <span className="font-medium">{info.permitNo || '-'}</span>
          </div>
          <div className="flex justify-between border-b border-border py-1.5">
            <span className="text-muted-foreground">类型</span>
            <span className="font-medium">{info.typeLabel || '-'}</span>
          </div>
          <div className="flex justify-between border-b border-border py-1.5">
            <span className="text-muted-foreground">申请人</span>
            <span className="font-medium">{info.applicantName || '-'}</span>
          </div>
          <div className="flex justify-between border-b border-border py-1.5">
            <span className="text-muted-foreground">当前状态</span>
            <span className="font-medium">{info.status || '-'}</span>
          </div>
          <div className="flex justify-between py-1.5">
            <span className="text-muted-foreground">待办环节</span>
            <span className="font-medium">{stepLabel}</span>
          </div>
        </div>
        {err && <div className="text-xs text-destructive">{err}</div>}
        <div className="flex gap-3 pt-1">
          <button
            className="flex-1 rounded-lg bg-destructive py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => submit('reject')}
          >
            拒绝
          </button>
          <button
            className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            disabled={busy}
            onClick={() => submit('approve')}
          >
            {busy ? <Loader2 size={15} className="animate-spin inline mr-1" /> : null}
            同意
          </button>
        </div>
      </div>
    </div>
  );
}
