import React, { useState, useEffect } from 'react';
import api from '@/api/client';
import { Card, CardContent, Button, Input, Textarea, Select } from '@/components/ui';
import { GraduationCap, CheckCircle, QrCode, Users } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';

// 承包商安全培训记录编辑器（挂作业申请单）
// 要求：培训人/培训内容/考核结果均为必填；被培训人通过扫码进入通用签字页签名（不填姓名）；
// 多人可同时扫码、各自上传；培训人点“完成培训签到”结束。
export default function TrainingEditor({
  appId,
  training,
  editable,
  reload,
}: {
  appId: string;
  training: any;
  editable: boolean;
  reload: () => void;
}) {
  const [trainer, setTrainer] = useState('');
  const [topics, setTopics] = useState('');
  const [testResult, setTestResult] = useState('');
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const [qr, setQr] = useState<{ url: string } | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completeMsg, setCompleteMsg] = useState('');

  useEffect(() => {
    setTrainer(training?.trainer || '');
    setTopics(training?.trainingTopics || '');
    setTestResult(training?.testResult || '');
    setRemark(training?.remark || '');
  }, [training]);

  const signatures = (training?.traineeSignatures || []) as Array<{ name?: string; signImg?: string; signedAt?: string }>;
  const completed = Boolean(training?.signCompletedAt);

  async function save() {
    setErr('');
    if (!trainer.trim()) { setErr('请填写培训人'); return; }
    if (!topics.trim()) { setErr('请填写培训内容'); return; }
    if (!testResult) { setErr('请选择考核结果'); return; }
    setSaving(true);
    try {
      await api.post(`/e-applications/${appId}/training`, {
        trainer: trainer.trim(),
        trainingTopics: topics.trim(),
        testResult,
        remark: remark.trim(),
      });
      reload();
    } catch (e: any) {
      setErr(e.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function genQr() {
    setErr(''); setQrBusy(true);
    try {
      const { data } = await api.post(`/e-applications/${appId}/training/sign-tokens`, {});
      setQr({ url: data.url });
    } catch (e: any) {
      setErr(e.response?.data?.message || '生成二维码失败');
    } finally {
      setQrBusy(false);
    }
  }

  async function completeSign() {
    setCompleteMsg(''); setCompleting(true);
    try {
      await api.post(`/e-applications/${appId}/training/complete-sign`, {});
      setCompleteMsg('已完成培训签到');
      reload();
    } catch (e: any) {
      setErr(e.response?.data?.message || '操作失败');
    } finally {
      setCompleting(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="font-medium flex items-center gap-1.5">
          <GraduationCap size={15} className="text-primary" /> 承包商安全培训记录
          {training && (
            <span className={`text-[11px] ${completed ? 'text-success' : training.testResult ? 'text-success' : 'text-warning'}`}>
              {completed ? '· 已完成签到' : training.testResult ? `· 已考核：${training.testResult}` : '· 未完成考核'}
            </span>
          )}
        </div>

        {!editable && !training && (
          <div className="text-xs text-muted-foreground">尚未录入培训记录（常规作业须在归档前完成）。</div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs">
            <span className="text-destructive">* </span><span className="text-muted-foreground">培训人</span>
            <Input value={trainer} disabled={!editable} onChange={(e) => setTrainer(e.target.value)} />
          </label>
          <label className="text-xs">
            <span className="text-destructive">* </span><span className="text-muted-foreground">考核结果</span>
            <Select value={testResult} disabled={!editable} onChange={(e) => setTestResult(e.target.value)}>
              <option value="">未填写</option>
              <option value="合格">合格</option>
              <option value="不合格">不合格</option>
            </Select>
          </label>
        </div>

        <label className="text-xs block">
          <span className="text-destructive">* </span><span className="text-muted-foreground">培训内容</span>
          <Textarea rows={3} value={topics} disabled={!editable} onChange={(e) => setTopics(e.target.value)} />
        </label>

        <label className="text-xs block">
          <span className="text-muted-foreground">备注</span>
          <Textarea rows={2} value={remark} disabled={!editable} onChange={(e) => setRemark(e.target.value)} />
        </label>

        {editable && (
          <div>
            <Button onClick={save} disabled={saving}>
              <CheckCircle size={15} className="mr-1" /> {saving ? '保存中…' : '保存培训记录'}
            </Button>
            {err && <div className="text-xs text-destructive mt-1">{err}</div>}
          </div>
        )}

        {/* 被培训人扫码签字（通用页，不填姓名） */}
        <div className="border-t border-border pt-3 space-y-2">
          <div className="text-xs font-medium flex items-center gap-1.5">
            <Users size={14} className="text-primary" /> 被培训人签字（扫码通用页，无需填写姓名）
          </div>
          <div className="text-[11px] text-muted-foreground">
            已签 {signatures.length} 人。点击下方按钮生成二维码，多名被培训人可同时扫码、各自在手机上手写签名；培训人确认全员签完后点“完成培训签到”。
          </div>
          {editable && (
            <Button variant="secondary" onClick={genQr} disabled={qrBusy}>
              <QrCode size={15} className="mr-1" /> {qrBusy ? '生成中…' : '生成培训签字二维码'}
            </Button>
          )}
          {qr && (
            <div className="rounded-lg border border-border p-3 flex gap-3 items-center">
              <QRCodeCanvas value={qr.url} size={104} />
              <div className="text-[11px] break-all text-muted-foreground">
                <div className="text-foreground mb-1">扫码进入签字页（72 小时内可多人反复签）：</div>
                <a href={qr.url} target="_blank" rel="noreferrer" className="text-primary underline">{qr.url}</a>
              </div>
            </div>
          )}

          {signatures.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {signatures.map((s, i) => (
                <div key={i} className="rounded-lg border border-border p-1.5 text-center w-24">
                  {s.signImg ? (
                    <img src={s.signImg} alt="" className="h-10 w-full object-contain" />
                  ) : (
                    <div className="h-10 text-[11px] text-muted-foreground">文字签字</div>
                  )}
                  <div className="text-[10px] mt-1 text-muted-foreground">第 {i + 1} 人</div>
                </div>
              ))}
            </div>
          )}

          {editable && !completed && (
            <Button variant="outline" onClick={completeSign} disabled={completing}>
              <CheckCircle size={15} className="mr-1" /> {completing ? '处理中…' : '完成培训签到'}
            </Button>
          )}
          {completed && <div className="text-xs text-success">✓ 已完成培训签到</div>}
          {completeMsg && <div className="text-xs text-success">{completeMsg}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
