import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '@/api/client';
import { Button, Card, CardContent, Input, Textarea } from '@/components/ui';
import JsaSection, { JsaItem } from '@/components/JsaSection';
import { AlertTriangle, CheckCircle, Sparkles, Save, Send, Upload, FileText, RefreshCw } from 'lucide-react';

// 承包商免登录填写页（员工发起邀请后，承包商扫码/点链接进入）：
// 员工已填基础信息（票号/地点/承包商等，只读）；承包商需完成：
//   作业内容 → 施工方案上传 → 作业步骤 → JSA（AI 生成/手工修订，AI 限 3 次）→ 风险清单勾选确认 → 提交
export default function ContractorFill() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const [content, setContent] = useState('');
  const [planFile, setPlanFile] = useState('');
  const [steps, setSteps] = useState<string[]>(['']);
  const [jsas, setJsas] = useState<JsaItem[]>([]);
  const [risks, setRisks] = useState<any[]>([]);
  const [aiCount, setAiCount] = useState(0);
  const [aiMax, setAiMax] = useState(3);
  const [aiBusy, setAiBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [savedTip, setSavedTip] = useState('');

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const { data } = await api.get(`/public/contractor-fill/${token}`);
        setInfo(data);
        setContent(data.content || '');
        setPlanFile(data.planFile || '');
        setSteps((data.steps && data.steps.length ? data.steps : ['']));
        setJsas(data.jsas || []);
        setRisks(data.riskHazards || []);
        setAiCount(data.jsaAnalysisCount || 0);
        setAiMax(data.jsaMaxCount || 3);
        if (data.submittedAt) setSubmitted(true);
      } catch (e: any) {
        setErr(e.response?.data?.message || '填写链接无效或已过期');
      }
    })();
  }, [token]);

  // 保存草稿（不校验、可多次）
  async function saveDraft(final = false) {
    setBusy(true); setErr(''); setSavedTip('');
    try {
      await api.post(`/public/contractor-fill/${token}`, {
        content,
        planFile,
        steps: steps.map((s) => s.trim()).filter(Boolean),
        jsas: jsas.filter((j) => j.step || j.hazard || j.control),
        riskHazards: risks,
      });
      setSavedTip(final ? '' : '已保存，可随时继续填写');
    } catch (e: any) {
      setErr(e.response?.data?.message || '保存失败');
      throw e;
    } finally {
      setBusy(false);
    }
  }

  // AI 生成/续写 JSA（限 3 次，后端强校验）
  async function runAi() {
    setAiBusy(true); setErr('');
    try {
      const { data } = await api.post(`/public/contractor-fill/${token}/ai-jsa`, {
        content,
        steps: steps.map((s) => s.trim()).filter(Boolean),
      });
      setJsas(data.jsas || []);
      setRisks(data.riskHazards || []);
      setAiCount(data.jsaAnalysisCount || 0);
      setAiMax(data.jsaMaxCount || 3);
      setSteps(data.steps?.length ? data.steps : steps);
      if (data.riskHazards) setSavedTip('AI 已生成风险清单，请核对并勾选确认');
    } catch (e: any) {
      setErr(e.response?.data?.message || 'AI 分析失败，请稍后重试');
    } finally {
      setAiBusy(false);
    }
  }

  // 施工方案上传
  async function uploadPlan(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true); setErr('');
    const fd = new FormData();
    fd.append('file', f);
    try {
      const { data } = await api.post(`/public/contractor-fill/${token}/plan`, fd);
      setPlanFile(data.filePath || '');
      setSavedTip('施工方案已上传');
    } catch (ex: any) {
      setErr(ex.response?.data?.message || '上传失败');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  // 提交
  async function submit() {
    try {
      await saveDraft(true);
      await api.post(`/public/contractor-fill/${token}/submit`);
      setSubmitted(true);
    } catch (e: any) {
      setErr(e.response?.data?.message || '提交失败');
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
  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center text-success flex flex-col items-center gap-2">
          <CheckCircle size={32} />
          <div className="text-sm font-medium">已提交，感谢配合！</div>
          <div className="text-xs text-muted-foreground">提交内容将进入内部复核审批流程；如需修改请联系邀请方。</div>
        </div>
      </div>
    );
  }

  const remaining = aiMax - aiCount;

  return (
    <div className="min-h-screen bg-muted/30 flex items-start justify-center p-4 py-8">
      <div className="w-full max-w-3xl space-y-4">
        {/* 头部 */}
        <Card>
          <CardContent className="p-5 space-y-1">
            <div className="flex items-center gap-2 text-primary font-medium text-lg">
              <FileText size={20} />
              <span>承包商填写 · 作业票 {info.permitNo || ''}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <div><span className="text-muted-foreground">作业名称：</span>{info.jobName || '—'}</div>
              <div><span className="text-muted-foreground">作业地点：</span>{[info.building, info.floor, info.area, info.location].filter(Boolean).join(' / ') || '—'}</div>
              <div><span className="text-muted-foreground">承包商单位：</span>{info.contractorUnit || '—'}</div>
              <div><span className="text-muted-foreground">申请人：</span>{info.applicantName || '—'}</div>
            </div>
            {info.contractorSubmittedAt && (
              <div className="text-xs text-success mt-1">已于 {new Date(info.contractorSubmittedAt).toLocaleString('zh-CN')} 提交</div>
            )}
          </CardContent>
        </Card>

        {/* 作业内容 + 施工方案 */}
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="font-medium text-sm">① 作业内容</div>
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder="请描述本次作业的具体内容、范围与工艺要求（AI 将据此生成风险识别）" />
            <div className="font-medium text-sm">② 施工方案（可选）</div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" disabled={uploading} onClick={() => document.getElementById('plan-file')?.click()}>
                <Upload size={14} className="mr-1" />{uploading ? '上传中…' : '上传施工方案'}
              </Button>
              <input id="plan-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" className="hidden" onChange={uploadPlan} />
              {planFile ? <span className="text-xs text-success truncate max-w-[240px]">{planFile.split('/').pop()}</span> : <span className="text-xs text-muted-foreground">支持 PDF / 图片，≤20MB</span>}
            </div>
          </CardContent>
        </Card>

        {/* 作业步骤 + JSA */}
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-medium text-sm">③ 作业步骤与风险识别（JSA）</div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">AI 剩余 {Math.max(remaining, 0)}/{aiMax} 次</span>
                <Button type="button" size="sm" disabled={aiBusy || remaining <= 0} onClick={runAi}>
                  {aiBusy ? <RefreshCw size={14} className="mr-1 animate-spin" /> : <Sparkles size={14} className="mr-1" />}
                  {aiBusy ? '生成中…' : 'AI 生成 JSA'}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              {steps.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}.</span>
                  <Input value={s} onChange={(e) => setSteps((st) => st.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`步骤 ${i + 1}（如：断电挂牌）`} />
                  <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={() => setSteps((st) => st.filter((_, j) => j !== i))}>删</Button>
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" onClick={() => setSteps((st) => [...st, ''])}>+ 添加步骤</Button>
            </div>
            <JsaSection
              items={jsas}
              editable
              onSave={async (items) => {
                setJsas(items);
                try {
                  await api.post(`/public/contractor-fill/${token}`, {
                    content, planFile,
                    steps: steps.map((x) => x.trim()).filter(Boolean),
                    jsas: items, riskHazards: risks,
                  });
                  setSavedTip('JSA 已保存');
                } catch (e: any) {
                  setErr(e.response?.data?.message || 'JSA 保存失败');
                }
              }}
            />
          </CardContent>
        </Card>

        {/* 风险清单确认 */}
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="font-medium text-sm">④ 风险清单确认（勾选即纳入审批与安全交底）</div>
            {risks.length === 0 ? (
              <div className="text-xs text-muted-foreground">暂无风险清单，请先填写作业内容并「AI 生成 JSA」或手工添加 JSA 后保存。</div>
            ) : (
              <div className="space-y-2">
                {risks.map((r, i) => (
                  <label key={i} className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer transition-colors ${r.checked ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
                    <input type="checkbox" className="mt-1" checked={!!r.checked} onChange={() => setRisks((list) => list.map((x, j) => (j === i ? { ...x, checked: !x.checked } : x)))} />
                    <div className="flex-1 text-sm">
                      <div className="font-medium">{r.hazard}</div>
                      {r.measures?.length > 0 && (
                        <div className="text-xs text-muted-foreground mt-0.5">控制措施：{r.measures.join('；')}</div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {err && <div className="text-xs text-destructive">{err}</div>}
        {savedTip && <div className="text-xs text-success">{savedTip}</div>}

        {/* 操作区 */}
        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" disabled={busy} onClick={() => saveDraft(false)}>
            <Save size={15} className="mr-1.5" />{busy ? '保存中…' : '保存草稿'}
          </Button>
          <Button type="button" className="flex-1" disabled={busy} onClick={submit}>
            <Send size={15} className="mr-1.5" />提交给邀请方
          </Button>
        </div>
        <div className="text-[11px] text-muted-foreground text-center pb-6">
          提交后内容进入内部复核与审批流程；AI 生成结果仅供参考，请结合现场实际核对。
        </div>
      </div>
    </div>
  );
}
