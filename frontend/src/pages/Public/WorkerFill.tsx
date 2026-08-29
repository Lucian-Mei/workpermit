import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '@/api/client';
import { Button, Card, CardContent, Input, Textarea } from '@/components/ui';
import JsaSection, { JsaItem } from '@/components/JsaSection';
import { AlertTriangle, CheckCircle, FileText, Save, HardHat } from 'lucide-react';

// 危险作业票·作业人员免登录填写页（员工/承包商发起邀请后扫码进入）：
// 填写施工时间、作业人员、监护人、作业证书与风险识别；保存即落库，员工侧复核后送审。
export default function WorkerFill() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [operators, setOperators] = useState('');
  const [supervisor, setSupervisor] = useState('');
  const [supervisorContact, setSupervisorContact] = useState('');
  const [content, setContent] = useState('');
  const [jsas, setJsas] = useState<JsaItem[]>([]);
  const [risks, setRisks] = useState<any[]>([]);
  const [savedTip, setSavedTip] = useState('');

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const { data } = await api.get(`/public/worker-fill/${token}`);
        setInfo(data);
        setStartTime(data.startTime ? new Date(data.startTime).toISOString().slice(0, 16) : '');
        setEndTime(data.endTime ? new Date(data.endTime).toISOString().slice(0, 16) : '');
        setOperators((data.operatorNames || []).join(', '));
        setSupervisor(data.supervisorName || '');
        setSupervisorContact(data.supervisorContact || '');
        setContent(data.content || '');
        setJsas(data.jsas || []);
        setRisks(data.riskHazards || []);
      } catch (e: any) {
        setErr(e.response?.data?.message || '填写链接无效或已过期');
      }
    })();
  }, [token]);

  async function save() {
    setBusy(true); setErr(''); setSavedTip('');
    try {
      await api.post(`/public/worker-fill/${token}`, {
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        operatorNames: operators.split(/[,，\s]+/).filter(Boolean),
        supervisorName: supervisor || undefined,
        supervisorContact: supervisorContact || undefined,
        content,
        jsas: jsas.filter((j) => j.step || j.hazard || j.control),
        riskHazards: risks,
      });
      setSavedTip('已保存，邀请方即可查看；可继续修改后再次保存');
    } catch (e: any) {
      setErr(e.response?.data?.message || '保存失败');
    } finally {
      setBusy(false);
    }
  }

  if (err && !info) {
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

  return (
    <div className="min-h-screen bg-muted/30 flex items-start justify-center p-4 py-8">
      <div className="w-full max-w-3xl space-y-4">
        <Card>
          <CardContent className="p-5 space-y-1">
            <div className="flex items-center gap-2 text-primary font-medium text-lg">
              <HardHat size={20} />
              <span>作业人员填写 · 危险作业票 {info.permitNo || ''}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <div><span className="text-muted-foreground">作业名称：</span>{info.jobName || '—'}</div>
              <div><span className="text-muted-foreground">作业地点：</span>{info.location || '—'}</div>
              <div><span className="text-muted-foreground">承包商单位：</span>{info.contractorUnit || '—'}</div>
              <div><span className="text-muted-foreground">申请人：</span>{info.applicantName || '—'}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="font-medium text-sm">① 施工时间与人员</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">开始时间</label>
                <Input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">结束时间</label>
                <Input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">作业人员（逗号分隔）</label>
                <Input value={operators} onChange={(e) => setOperators(e.target.value)} placeholder="张三, 李四" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">监护人姓名</label>
                <Input value={supervisor} onChange={(e) => setSupervisor(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">监护人电话</label>
                <Input value={supervisorContact} onChange={(e) => setSupervisorContact(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">作业内容</label>
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder="作业内容（如承包商已填写可保持原样）" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="font-medium text-sm">② 风险识别（JSA）</div>
            <JsaSection
              items={jsas}
              editable
              onSave={async (items) => {
                setJsas(items);
                try {
                  await api.post(`/public/worker-fill/${token}`, {
                    startTime: startTime || undefined, endTime: endTime || undefined,
                    operatorNames: operators.split(/[,，\s]+/).filter(Boolean),
                    supervisorName: supervisor || undefined, supervisorContact: supervisorContact || undefined,
                    content, jsas: items, riskHazards: risks,
                  });
                  setSavedTip('JSA 已保存');
                } catch (e: any) {
                  setErr(e.response?.data?.message || 'JSA 保存失败');
                }
              }}
            />
            <div className="font-medium text-sm">③ 风险确认</div>
            {risks.length === 0 ? (
              <div className="text-xs text-muted-foreground">暂无风险清单（由承包商/邀请方生成）。</div>
            ) : (
              <div className="space-y-2">
                {risks.map((r, i) => (
                  <label key={i} className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer ${r.checked ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
                    <input type="checkbox" className="mt-1" checked={!!r.checked} onChange={() => setRisks((list) => list.map((x, j) => (j === i ? { ...x, checked: !x.checked } : x)))} />
                    <div className="flex-1 text-sm">
                      <div className="font-medium">{r.hazard}</div>
                      {r.measures?.length > 0 && <div className="text-xs text-muted-foreground mt-0.5">措施：{r.measures.join('；')}</div>}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {err && <div className="text-xs text-destructive">{err}</div>}
        {savedTip && <div className="text-xs text-success">{savedTip}</div>}

        <Button type="button" className="w-full" disabled={busy} onClick={save}>
          <Save size={15} className="mr-1.5" />{busy ? '保存中…' : '保存'}
        </Button>
        <div className="text-[11px] text-muted-foreground text-center pb-6">
          保存后邀请方即可查看，进入内部复核与审批流程。
        </div>
      </div>
    </div>
  );
}
