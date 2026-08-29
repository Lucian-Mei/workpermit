import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '@/api/client';
import { Button, Card, CardContent, Input } from '@/components/ui';
import { QrCode, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';

export default function EntryVerification() {
  const { token } = useParams();
  const [app, setApp] = useState<any>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'loading' | 'form' | 'done'>('loading');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState<any>(null);

  useEffect(() => {
    if (!token) { setErr('无效的核验链接'); setStep('form'); return; }
    api.get(`/public/entry/${token}`)
      .then(({ data }) => { setApp(data); setStep('form'); })
      .catch(() => { setErr('核验链接已失效或不存在'); setStep('form'); });
  }, [token]);

  async function submit() {
    if (!name.trim()) { setErr('请填写姓名'); return; }
    setBusy(true); setErr('');
    try {
      const { data } = await api.post(`/public/entry/${token}`, { name: name.trim(), phone: phone.trim() || undefined });
      setRecord(data);
      setStep('done');
    } catch (e: any) { setErr(e.response?.data?.message || '核验失败'); }
    finally { setBusy(false); }
  }

  if (step === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-4 p-6 text-center">
            <CheckCircle size={60} className="mx-auto text-success" />
            <h1 className="text-xl font-semibold text-success">核验成功</h1>
            <p className="text-sm">姓名：{record?.name}</p>
            {record?.phone && <p className="text-sm text-muted-foreground">电话：{record?.phone}</p>}
            <p className="text-sm text-muted-foreground">入厂登记完成，请前往现场</p>
            <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2">
              {app?.permitNo && <p>作业单：{app.permitNo}</p>}
              {app?.contractorUnit && <p>承包商：{app.contractorUnit}</p>}
              {app?.location && <p>作业位置：{app.location}</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 p-6">
          <div className="text-center">
            <QrCode size={40} className="mx-auto text-primary" />
            <h1 className="mt-2 text-lg font-semibold">入厂核验</h1>
            <p className="text-sm text-muted-foreground">请在下方填写您的姓名和电话，完成入厂登记</p>
          </div>
          {app && (
            <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
              {app.permitNo && <p>作业单号：{app.permitNo}</p>}
              {app.contractorUnit && <p>承包商：{app.contractorUnit}</p>}
              {app.location && <p>作业位置：{app.location}</p>}
              {app.planStart && <p>计划时间：{new Date(app.planStart).toLocaleDateString('zh-CN')}</p>}
            </div>
          )}
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">姓名</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="请输入您的姓名" />
            </div>
            <div>
              <label className="text-sm font-medium">联系电话</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="选填" />
            </div>
          </div>
          {err && <div className="text-sm text-destructive">{err}</div>}
          <Button className="w-full" disabled={busy} onClick={submit}>
            {busy ? <Loader2 size={16} className="animate-spin mr-1" /> : null}
            提交核验
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
