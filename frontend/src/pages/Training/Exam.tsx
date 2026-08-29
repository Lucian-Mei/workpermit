import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '@/api/client';
import { Button, Card, CardContent, Input } from '@/components/ui';
import { CheckCircle, XCircle, GraduationCap, Loader2, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { hasPerm } from '@/api/client';

export default function TrainingExam() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const canManage = hasPerm(user, 'config:manage') || hasPerm(user, 'epermit:view_all');
  const appId = params.get('app');
  const [name, setName] = useState(params.get('name') || '');
  const [idCard, setIdCard] = useState(params.get('idCard') || '');
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'form' | 'exam' | 'result'>('form');
  const [questions, setQuestions] = useState<any[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // 加载试卷
  async function startExam() {
    if (!name.trim()) { setErr('请填写姓名'); return; }
    setBusy(true); setErr('');
    try {
      const { data } = await api.get('/training/exam');
      setQuestions(data || []);
      setStep('exam');
    } catch (e: any) {
      setErr(e.response?.data?.message || '获取试题失败');
    } finally { setBusy(false); }
  }

  // 提交
  async function submitExam() {
    const unanswered = questions.filter((q) => !answers[q.id]);
    if (unanswered.length > 0) { setErr(`还有 ${unanswered.length} 道题未作答`); return; }
    setBusy(true); setErr('');
    try {
      const ansList = Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer }));
      const { data } = await api.post('/training/exam', { name: name.trim(), idCard: idCard.trim() || undefined, phone: phone || undefined, answers: ansList });
      setResult(data);
      setStep('result');
    } catch (e: any) { setErr(e.response?.data?.message || '提交失败'); }
    finally { setBusy(false); }
  }

  if (step === 'form') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-4 p-6">
            {canManage && (
              <button onClick={() => navigate('/training')} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary -mt-2">
                <ArrowLeft size={14} /> 返回培训管理
              </button>
            )}
            <div className="text-center">
              <GraduationCap size={40} className="mx-auto text-primary" />
              <h1 className="mt-2 text-lg font-semibold">一级安全培训</h1>
              <p className="text-sm text-muted-foreground">在线考试，通过后方可进场作业</p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">姓名</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="请输入您的姓名" />
              </div>
              <div>
                <label className="text-sm font-medium">身份证号</label>
                <Input value={idCard} onChange={(e) => setIdCard(e.target.value)} placeholder="请输入身份证号（培训合格身份凭证）" />
              </div>
              <div>
                <label className="text-sm font-medium">联系电话</label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="选填" />
              </div>
            </div>
            {err && <div className="text-sm text-destructive">{err}</div>}
            <Button className="w-full" disabled={busy} onClick={startExam}>
              {busy ? <Loader2 size={16} className="animate-spin mr-1" /> : null}
              开始考试
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'exam') {
    return (
      <div className="min-h-screen bg-muted/30 p-4">
        <div className="mx-auto max-w-2xl space-y-4">
          {canManage && (
            <button onClick={() => navigate('/training')} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
              <ArrowLeft size={14} /> 返回培训管理
            </button>
          )}
          <div className="text-center text-sm text-muted-foreground">
            共 {questions.length} 题 · 请逐题作答
          </div>
          {questions.map((q, i) => (
            <Card key={q.id}>
              <CardContent className="p-4">
                <div className="mb-2 text-sm font-medium">{i + 1}. {q.question}</div>
                <div className="space-y-1.5">
                  {(q.options || []).map((opt: string, oi: number) => {
                    const letter = String.fromCharCode(65 + oi);
                    const selected = answers[q.id] === letter;
                    return (
                      <button
                        key={oi}
                        onClick={() => setAnswers({ ...answers, [q.id]: letter })}
                        className={`w-full text-left rounded-lg border px-3 py-2 text-sm transition ${
                          selected ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
          {err && <div className="text-sm text-destructive">{err}</div>}
          <Button className="w-full" disabled={busy} onClick={submitExam}>
            {busy ? <Loader2 size={16} className="animate-spin mr-1" /> : null}
            提交答案
          </Button>
        </div>
      </div>
    );
  }

  // 结果页
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 p-6 text-center">
          {canManage && (
            <button onClick={() => navigate('/training')} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary -mb-2">
              <ArrowLeft size={14} /> 返回培训管理
            </button>
          )}
          {result?.passed ? (
            <CheckCircle size={60} className="mx-auto text-success" />
          ) : (
            <XCircle size={60} className="mx-auto text-destructive" />
          )}
          <h1 className={`text-xl font-semibold ${result?.passed ? 'text-success' : 'text-destructive'}`}>
            {result?.passed ? '恭喜通过' : '未通过'}
          </h1>
          <div className="space-y-1 text-sm">
            <p>得分：{result?.score} / {result?.total}（{result?.percent}%）</p>
            {result?.passed && result?.validUntil && (
              <p className="text-muted-foreground">有效期至 {new Date(result.validUntil).toLocaleDateString('zh-CN')}</p>
            )}
            {!result?.passed && (
              <p className="text-muted-foreground">需要 {result?.percent}% 或以上方可视为合格，请稍后再试或联系安全员</p>
            )}
          </div>
          {appId && (
            <Button className="w-full" onClick={() => navigate('/')}>
              返回
            </Button>
          )}
          {!result?.passed && (
            <Button variant="outline" className="w-full" onClick={() => { setStep('form'); setAnswers({}); setResult(null); }}>
              重新考试
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
