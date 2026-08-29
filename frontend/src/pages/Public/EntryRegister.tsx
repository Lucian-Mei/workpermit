import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '@/api/client';
import { Button, Card, CardContent, Input, Select, EmptyState } from '@/components/ui';
import { SignaturePad } from '@/components/SignaturePad';
import { QrCode, CheckCircle, XCircle, UserCheck, AlertTriangle, Loader2 } from 'lucide-react';

export default function EntryRegister() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qrToken = searchParams.get('token') || undefined; // 培训二维码 token：绑定具体作业任务
  const [step, setStep] = useState<'loading' | 'select' | 'register' | 'result'>('loading');
  const [tasks, setTasks] = useState<any[]>([]);
  const [appId, setAppId] = useState('');
  const [form, setForm] = useState({ contractorUnit: '', workerName: '', workerPhone: '', workerIdCard: '' });
  const [signImg, setSignImg] = useState('');
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/public/worker-register/tasks', { params: qrToken ? { token: qrToken } : undefined })
      .then(({ data }) => { setTasks(data || []); setStep('select'); })
      .catch(() => { setErr('加载失败'); setStep('select'); });
  }, [qrToken]);

  async function submitRegister() {
    if (!appId) { setErr('请选择作业任务'); return; }
    if (!form.contractorUnit.trim()) { setErr('请选择承包商'); return; }
    if (!form.workerName.trim()) { setErr('请填写姓名'); return; }
    setBusy(true); setErr('');
    try {
      const { data } = await api.post('/public/worker-register', {
        workPermitId: appId,
        contractorUnit: form.contractorUnit.trim(),
        workerName: form.workerName.trim(),
        workerPhone: form.workerPhone.trim() || undefined,
        workerIdCard: form.workerIdCard.trim() || undefined,
      });
      if (data.needExam) {
        setResult(data);
        setStep('result');
      } else {
        // 培训有效，展示签名
        setResult({ ...data, needSign: true });
        setStep('result');
      }
    } catch (e: any) { setErr(e.response?.data?.message || '登记失败'); }
    finally { setBusy(false); }
  }

  async function submitSign() {
    if (!signImg) { setErr('请手写签名'); return; }
    setBusy(true); setErr('');
    try {
      const { data } = await api.post('/public/worker-register', {
        workPermitId: appId,
        contractorUnit: form.contractorUnit.trim(),
        workerName: form.workerName.trim(),
        workerPhone: form.workerPhone.trim() || undefined,
        workerIdCard: form.workerIdCard.trim() || undefined,
        signImg,
      });
      setResult({ ...data, signed: true });
      setStep('result');
    } catch (e: any) { setErr(e.response?.data?.message || '签名提交失败'); }
    finally { setBusy(false); }
  }

  // 承包商分组去重
  const contractors = [...new Set(tasks.map((t) => t.contractorUnit).filter(Boolean))];

  if (step === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  if (step === 'select') {
    return (
      <div className="flex min-h-screen items-start justify-center bg-muted/30 p-4 pt-8">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-4 p-6">
            <div className="text-center">
              <UserCheck size={40} className="mx-auto text-primary" />
              <h1 className="mt-2 text-lg font-semibold">入厂登记</h1>
              <p className="text-sm text-muted-foreground">请选择您所属的承包商和今日作业项目</p>
            </div>
            {tasks.length === 0 && <EmptyState title="暂无进行中的作业任务" />}
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">承包商单位</label>
                <Select value={form.contractorUnit} onChange={(e) => { setForm({ ...form, contractorUnit: e.target.value }); setAppId(''); }}>
                  <option value="">— 请选择 —</option>
                  {contractors.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Select>
              </div>
              {form.contractorUnit && (
                <div>
                  <label className="text-sm font-medium">作业任务</label>
                  <div className="space-y-1.5 mt-1">
                    {tasks.filter((t) => t.contractorUnit === form.contractorUnit).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setAppId(t.id === appId ? '' : t.id)}
                        className={`w-full text-left rounded-lg border px-3 py-2.5 text-sm transition ${
                          appId === t.id ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <div className="font-medium">{t.jobName || '未命名作业'}</div>
                        <div className="text-xs text-muted-foreground">{t.location} · {t.permitNo}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {err && <div className="text-sm text-destructive">{err}</div>}
            <Button className="w-full" disabled={!appId || busy} onClick={() => { setStep('register'); setErr(''); }}>
              下一步
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'register') {
    return (
      <div className="flex min-h-screen items-start justify-center bg-muted/30 p-4 pt-8">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-4 p-6">
            <div className="text-center">
              <QrCode size={40} className="mx-auto text-primary" />
              <h1 className="mt-2 text-lg font-semibold">工人信息登记</h1>
              <p className="text-xs text-muted-foreground">
                {tasks.find((t) => t.id === appId)?.jobName || ''}
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">承包商</label>
                <Input value={form.contractorUnit} disabled className="bg-muted/50" />
              </div>
              <div>
                <label className="text-sm font-medium">姓名</label>
                <Input value={form.workerName} onChange={(e) => setForm({ ...form, workerName: e.target.value })} placeholder="请输入您的姓名" />
              </div>
              <div>
                <label className="text-sm font-medium">身份证号</label>
                <Input value={form.workerIdCard} onChange={(e) => setForm({ ...form, workerIdCard: e.target.value })} placeholder="选填，用于培训合格身份核验" />
              </div>
              <div>
                <label className="text-sm font-medium">手机号</label>
                <Input value={form.workerPhone} onChange={(e) => setForm({ ...form, workerPhone: e.target.value })} placeholder="选填，用于培训核验" />
              </div>
            </div>
            {err && <div className="text-sm text-destructive">{err}</div>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep('select')}>返回</Button>
              <Button className="flex-1" disabled={busy} onClick={submitRegister}>
                {busy ? <Loader2 size={16} className="animate-spin mr-1" /> : null}
                提交登记
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 结果页
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 p-6 text-center">
          {result?.needExam ? (
            <>
              <XCircle size={60} className="mx-auto text-destructive" />
              <h1 className="text-xl font-semibold text-destructive">培训未通过或已过期</h1>
              <p className="text-sm">需完成一级安全培训考试后方可入厂作业</p>
              <Button className="w-full" onClick={() => navigate(`/training/exam?name=${encodeURIComponent(form.workerName)}&idCard=${encodeURIComponent(form.workerIdCard)}&phone=${encodeURIComponent(form.workerPhone)}`)}>
                立即参加在线考试
              </Button>
            </>
          ) : result?.needSign && !result?.signed ? (
            <>
              <CheckCircle size={60} className="mx-auto text-success" />
              <h1 className="text-xl font-semibold text-success">身份核验通过</h1>
              <p className="text-sm text-muted-foreground">请手写签名确认</p>
              <SignaturePad onConfirm={(p) => setSignImg(p.signImg)} />
              {signImg && <img src={signImg} alt="签名" className="mx-auto h-12 rounded bg-white" />}
              {err && <div className="text-sm text-destructive">{err}</div>}
              <Button className="w-full" disabled={busy || !signImg} onClick={submitSign}>
                {busy ? <Loader2 size={16} className="animate-spin mr-1" /> : null}
                签名确认
              </Button>
            </>
          ) : (
            <>
              <CheckCircle size={60} className="mx-auto text-success" />
              <h1 className="text-xl font-semibold text-success">登记成功</h1>
              <p className="text-sm">姓名：{result?.workerName || form.workerName}</p>
              <p className="text-xs text-muted-foreground">培训有效 · 已记录签名 · 可以入厂作业</p>
              <Button variant="outline" className="w-full" onClick={() => { setStep('select'); setForm({ contractorUnit: '', workerName: '', workerPhone: '', workerIdCard: '' }); setAppId(''); setSignImg(''); setResult(null); }}>
                继续登记下一位
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
