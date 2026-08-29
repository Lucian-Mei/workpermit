import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, Button, Input, Textarea, Select, PageHeader, Modal, Switch } from '@/components/ui';
import { FormGrid, Field, Section } from '@/components/kit';
import LotteryModal from '@/components/LotteryModal';
import { QRCodeCanvas } from 'qrcode.react';
import { Sparkles, Send, Gift, Camera, AlertTriangle, ListChecks } from 'lucide-react';
import { RISK_LEVELS } from '@/constants';

function parseAiJson(text: string): any {
  const clean = (text || '').replace('__AI_DONE__', '');
  const m = clean.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {
      /* ignore */
    }
  }
  return { raw: clean };
}

export default function HazardReport({ anonymous = false }: { anonymous?: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    // 免登录模式不默认带登录人身份（不强制记录填报人员），不填姓名即匿名
    submitterName: anonymous ? '' : user?.name || '',
    building: '',
    floor: '',
    location: '',
    area: '',
    description: '',
    suggestAction: '',
    photos: [] as string[],
  });
  const [areas, setAreas] = useState<any[]>([]);
  const buildings = Array.from(new Set(areas.map((a: any) => a.building).filter(Boolean)));
  const floorOptions = (form.building ? Array.from(new Set(areas.filter((a: any) => a.building === form.building).map((a: any) => a.floor).filter(Boolean))) : []);
  const [ai, setAi] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [lottery, setLottery] = useState<any>(null);
  const [lotteryNo, setLotteryNo] = useState('');
  const [qrOpen, setQrOpen] = useState(false);
  const qrUrl = typeof window !== 'undefined' ? `${window.location.origin}/anonymous` : '';
  // 免登录模式：算术验证码（防批量）+ 匿名开关
  const [captcha, setCaptcha] = useState<{ id: string; a: number; b: number } | null>(null);
  const [captchaAns, setCaptchaAns] = useState('');
  const [isAnon, setIsAnon] = useState(anonymous);

  async function loadCaptcha() {
    try {
      const { data } = await api.get('/hazards/captcha');
      setCaptcha(data);
      setCaptchaAns('');
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    api.get('/areas')
      .then((a) => setAreas((a.data || []).filter((x: any) => x.enabled !== false)))
      .catch(() => {});
    if (anonymous) loadCaptcha();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anonymous]);

  function set(k: string, v: any) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function uploadPhotos(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        const { data } = await api.post(anonymous ? '/files/anonymous-upload' : '/files/upload', fd);
        uploaded.push(data.url);
      }
      set('photos', [...form.photos, ...uploaded]);
    } finally {
      setUploading(false);
    }
  }

  function removePhoto(idx: number) {
    set('photos', form.photos.filter((_, i) => i !== idx));
  }

  async function analyze() {
    if (!form.description.trim() && !form.location.trim()) {
      setErr('请先填写隐患描述或位置');
      return;
    }
    setErr('');
    setAnalyzing(true);
    setStreamText('');
    try {
      const token = localStorage.getItem('token') || '';
      const resp = await fetch('/api/hazards/analyze/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ description: form.description, location: form.location }),
      });
      if (!resp.ok || !resp.body) throw new Error('分析服务不可用');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split('\n\n');
        buf = frames.pop() || '';
        for (const f of frames) {
          const line = f.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          // Nest @Sse 会原样写出 data 字段，故直接累积原始文本（兜底尝试 JSON 解析为字符串）
          let chunk = payload;
          try {
            const maybe = JSON.parse(payload);
            if (typeof maybe === 'string') chunk = maybe;
          } catch {
            /* 已是原始文本 */
          }
          full += chunk;
          setStreamText(full.replace('__AI_DONE__', ''));
        }
      }
      setAi(parseAiJson(full));
    } catch (e: any) {
      setErr('AI 分析失败：' + (e?.message || e));
    } finally {
      setAnalyzing(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setMsg('');
    setLottery(null);
    if (!form.submitterName.trim()) {
      // 免登录模式不强制填写提报人（不填即匿名）
      if (!anonymous) return setErr('请填写提报人姓名');
    }
    if (!form.building.trim()) return setErr('请填写楼栋');
    if (!form.floor.trim()) return setErr('请填写楼层');
    if (!form.location.trim()) return setErr('请填写具体位置');
    if (!form.area) return setErr('请选择区域');
    if (!form.description.trim()) return setErr('请填写隐患描述');
    if (!form.suggestAction.trim()) return setErr('请填写整改建议（建议措施）');
    if (form.photos.length === 0) return setErr('请至少上传一张现场照片');
    if (anonymous) {
      if (form.photos.length > 6) return setErr('最多上传 6 张照片');
      if (!captcha || captchaAns.trim() === '') return setErr('请完成安全验证');
    }
    try {
      if (anonymous) {
        // 免登录上报：不强制记录登录身份（不填姓名即匿名），带验证码防批量
        const { data } = await api.post('/hazards/anonymous', {
          submitterName: form.submitterName.trim(),
          isAnonymous: isAnon,
          building: form.building,
          floor: form.floor,
          area: form.area,
          location: form.location.trim(),
          description: form.description.trim(),
          suggestAction: form.suggestAction.trim(),
          photos: form.photos,
          captchaId: captcha?.id,
          captchaAnswer: Number(captchaAns),
        });
        setLottery(data.lottery || null);
        setLotteryNo(data.hazardNo || '');
        setMsg(`上报成功，编号：${data.hazardNo}`);
        // 免登录不跳台账（未登录会跳登录页），停留继续填报
        setForm((f) => ({ ...f, submitterName: '', building: '', floor: '', location: '', area: '', description: '', suggestAction: '', photos: [] }));
        setIsAnon(false);
        await loadCaptcha();
        return;
      }
      const { data } = await api.post('/hazards', { ...form, submitterName: form.submitterName.trim() });
      setLottery(data.lottery || null);
      setLotteryNo(data.hazardNo || '');
      setMsg(`上报成功，编号：${data.hazardNo}`);
      setTimeout(() => navigate('/hazards'), 4000);
    } catch (e: any) {
      setErr(e.response?.data?.message || '上报失败');
      if (anonymous) await loadCaptcha();
    }
  }

  return (
    <div className="page-fade space-y-[var(--gap-card)]">
      <PageHeader
        title="上报隐患"
        description="填写位置与隐患信息，系统可 AI 辅助识别类别与风险"
        icon={<AlertTriangle size={20} />}
        actions={
          anonymous ? (
            <Button variant="ghost" onClick={() => navigate('/login')}>
              去登录
            </Button>
          ) : (
            <div
              className="hidden cursor-pointer rounded-xl border border-border bg-card p-1 shadow-sm transition hover:border-primary hover:shadow-md sm:block"
              title="扫码免登录上报（不关联区域）"
              onClick={() => setQrOpen(true)}
            >
              <QRCodeCanvas value={qrUrl} size={52} />
            </div>
          )
        }
      />

      <Section title="填报须知" icon={<ListChecks size={16} />}>
        <Card>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> 楼栋 / 楼层 / 区域 / 具体位置 尽量精确，便于整改定位。</div>
            <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> 描述请写清现象与可能后果（如漏电、坠落风险）。</div>
            <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> 至少上传 1 张现场照片作为佐证。</div>
            <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> 点击右下「AI 智能分析」可自动识别类别、风险与整改建议。</div>
          </CardContent>
        </Card>
      </Section>

      <form id="hazard-report-form" onSubmit={submit}>
        <div className="grid grid-cols-1 gap-[var(--gap-card)]">
          <div className="space-y-[var(--gap-card)]">
            <Section title="隐患信息" icon={<AlertTriangle size={16} />}>
              <Card>
                <CardContent className="space-y-5">
                  <Field label="提报人" required={!anonymous} hint={anonymous ? '不填则匿名上报（免登录）' : '默认为当前登录人，可修改'}>
                    <Input
                      value={form.submitterName}
                      onChange={(e) => set('submitterName', e.target.value)}
                      placeholder={anonymous ? '如 张三（可不填）' : '提报人姓名'}
                    />
                  </Field>

                  <FormGrid cols={3}>
                    <Field label="楼栋" required>
                      <Select value={form.building} onChange={(e) => set('building', e.target.value)}>
                        <option value="">— 请选择 —</option>
                        {buildings.map((b) => <option key={b} value={b}>{b}</option>)}
                      </Select>
                    </Field>
                    <Field label="楼层" required>
                      <Select value={form.floor} onChange={(e) => set('floor', e.target.value)}>
                        <option value="">— 请选择 —</option>
                        {floorOptions.map((f) => <option key={f} value={f}>{f}</option>)}
                      </Select>
                    </Field>
                    <Field label="区域" required>
                      <Select value={form.area} onChange={(e) => set('area', e.target.value)}>
                        <option value="">— 请选择 —</option>
                        {areas
                          .filter((a: any) => {
                            if (form.building && a.building !== form.building) return false;
                            if (form.floor && a.floor !== form.floor) return false;
                            return true;
                          })
                          .map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
                      </Select>
                    </Field>
                  </FormGrid>

                  <Field label="具体位置" required>
                    <Input
                      value={form.location}
                      onChange={(e) => set('location', e.target.value)}
                      placeholder="如 3楼配电间东侧、B区2号机组旁"
                    />
                  </Field>

                  <Field label="隐患描述" required>
                    <Textarea
                      rows={4}
                      value={form.description}
                      onChange={(e) => set('description', e.target.value)}
                      placeholder="描述隐患现象、可能后果"
                    />
                  </Field>

                  <Field label="整改建议" required hint="上报时必填，将展示在隐患详情的基本信息中">
                    <Textarea
                      rows={3}
                      value={form.suggestAction}
                      onChange={(e) => set('suggestAction', e.target.value)}
                      placeholder="建议采取的整改措施，如：更换破损护栏并加装警示标识"
                    />
                  </Field>

                  <Field label="现场照片" required hint="至少上传一张">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex h-[var(--control-h)] cursor-pointer items-center gap-2 rounded-[var(--radius)] border border-dashed border-input bg-muted/40 px-4 text-sm font-medium text-primary transition-colors hover:border-primary hover:bg-primary/5">
                        <Camera size={18} /> 拍照 / 选图
                        <input
                          type="file"
                          multiple
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => uploadPhotos(e.target.files)}
                          disabled={uploading}
                        />
                      </label>
                      {uploading && <span className="text-xs text-muted-foreground">上传中…</span>}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {form.photos.map((p, i) => (
                        <div key={i} className="group relative">
                          <img
                            src={p}
                            className="h-20 w-20 rounded-xl border border-border object-cover shadow-sm transition-transform group-hover:scale-[1.02]"
                            alt=""
                          />
                          <button
                            type="button"
                            onClick={() => removePhoto(i)}
                            className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-xs text-white shadow-sm transition-transform hover:scale-110"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </Field>

                  {anonymous && (
                    <>
                      <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-4 py-3">
                        <div>
                          <div className="text-sm font-medium text-foreground">匿名上报</div>
                          <div className="text-xs text-muted-foreground">勾选后统一登记为「匿名填报」；不勾选则以提报人姓名署名</div>
                        </div>
                        <Switch checked={isAnon} onChange={setIsAnon} />
                      </div>
                      <Field label="安全验证" required hint="防恶意填报，请完成计算">
                        <div className="flex items-center gap-2">
                          <span className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm tabular-nums">
                            {captcha ? `${captcha.a} + ${captcha.b} = ?` : '加载中…'}
                          </span>
                          <Input
                            className="w-24"
                            inputMode="numeric"
                            value={captchaAns}
                            onChange={(e) => setCaptchaAns(e.target.value)}
                            placeholder="答案"
                          />
                          <Button type="button" variant="ghost" size="sm" onClick={loadCaptcha}>
                            换一题
                          </Button>
                        </div>
                      </Field>
                    </>
                  )}
                </CardContent>
              </Card>
            </Section>

            {err && (
              <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle size={16} /> {err}
              </div>
            )}
            {msg && (
              <div className="flex items-center gap-2 rounded-xl border border-success/20 bg-success/10 p-3 text-sm text-success">
                <ListChecks size={16} /> {msg}
              </div>
            )}

            {lottery?.ok && (
              <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                <Gift size={22} className="text-warning" />
                <div>
                  <div className="font-medium">🎉 恭喜抽中：{lottery.prize}</div>
                  <div className="text-xs text-warning">感谢您参与安全上报，奖品请到安全部领取。</div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="lg" onClick={analyze} disabled={analyzing}>
                <Sparkles size={18} className="mr-1.5" /> AI 辅助分析
              </Button>
              <Button type="submit" form="hazard-report-form" size="lg">
                <Send size={18} className="mr-1.5" /> 提交上报
              </Button>
            </div>
          </div>
        </div>
      </form>

      {/* AI 辅助分析：整行全宽，框体更大、信息完整展示 */}
      <Section title="AI 辅助分析" icon={<Sparkles size={16} />}>
        <Card>
          <CardContent>
            {analyzing ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-4">
                <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Sparkles size={30} className="animate-pulse" />
                </div>
                <div className="text-sm font-medium text-foreground">AI 正在分析…（实时生成中）</div>
                <div className="h-1.5 w-56 overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                </div>
                <div className="max-h-56 w-full overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-muted/40 p-4 font-mono text-xs text-muted-foreground">
                  {streamText || '（正在生成…）'}
                </div>
              </div>
            ) : ai ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {ai.aiCategory && (
                    <div className="rounded-xl border border-border bg-muted/40 p-4">
                      <div className="mb-1 text-xs text-muted-foreground">隐患类别</div>
                      <div className="font-medium">{ai.aiCategory}</div>
                    </div>
                  )}
                  {ai.aiRiskLevel && (
                    <div className="rounded-xl border border-border bg-muted/40 p-4">
                      <div className="mb-1 text-xs text-muted-foreground">风险等级</div>
                      <div className="font-medium" style={{ color: (RISK_LEVELS as any)[ai.aiRiskLevel]?.color }}>
                        {(RISK_LEVELS as any)[ai.aiRiskLevel]?.label || ai.aiRiskLevel}
                      </div>
                    </div>
                  )}
                  {ai.aiRegulation && (
                    <div className="rounded-xl border border-border bg-muted/40 p-4">
                      <div className="mb-1 text-xs text-muted-foreground">关联法规</div>
                      <div className="text-sm">{ai.aiRegulation}</div>
                    </div>
                  )}
                  {ai.aiRootCause && (
                    <div className="rounded-xl border border-border bg-muted/40 p-4">
                      <div className="mb-1 text-xs text-muted-foreground">可能根因</div>
                      <div className="text-sm">{ai.aiRootCause}</div>
                    </div>
                  )}
                  {ai.ai5Why && (
                    <div className="rounded-xl border border-border bg-muted/40 p-4">
                      <div className="mb-1 text-xs text-muted-foreground">5Why 推演</div>
                      <div className="whitespace-pre-wrap text-sm">{ai.ai5Why}</div>
                    </div>
                  )}
                  {ai.aiControlMeasures && (
                    <div className="rounded-xl border border-border bg-muted/40 p-4">
                      <div className="mb-1 text-xs text-muted-foreground">控制措施</div>
                      <div className="whitespace-pre-wrap text-sm">{ai.aiControlMeasures}</div>
                    </div>
                  )}
                </div>
                {ai.aiSuggestion && (
                  <div className="rounded-xl border border-border bg-muted/40 p-4">
                    <div className="mb-1 text-xs text-muted-foreground">整改建议</div>
                    <div className="whitespace-pre-wrap text-sm">{ai.aiSuggestion}</div>
                  </div>
                )}
                {ai.raw && (
                  <div className="rounded-xl border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
                    <div className="mb-1 font-medium text-foreground">原始输出</div>
                    <div className="whitespace-pre-wrap">{ai.raw}</div>
                  </div>
                )}
                <div className="flex justify-end">
                  <Button type="button" variant="secondary" size="sm" onClick={analyze}>
                    <Sparkles size={14} className="mr-1" /> 重新分析
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[300px] flex-col items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={analyze}
                  className="group flex h-24 w-24 items-center justify-center rounded-[2rem] bg-primary/10 text-primary shadow-sm transition hover:scale-105 hover:bg-primary/20"
                  title="点击 AI 智能分析"
                >
                  <Sparkles size={40} />
                </button>
                <div className="text-base font-semibold text-foreground">点击图标，AI 智能分析</div>
                <ul className="max-w-sm space-y-1.5 text-center text-xs text-muted-foreground">
                  <li className="flex items-center justify-center gap-2"><span className="h-1 w-1 rounded-full bg-primary" /> 自动识别隐患类别</li>
                  <li className="flex items-center justify-center gap-2"><span className="h-1 w-1 rounded-full bg-primary" /> 评估风险等级</li>
                  <li className="flex items-center justify-center gap-2"><span className="h-1 w-1 rounded-full bg-primary" /> 给出法规依据与整改建议</li>
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </Section>

      <Modal open={qrOpen} title="扫码免登录上报" onClose={() => setQrOpen(false)}>
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="rounded-2xl border border-border bg-card p-3">
            <QRCodeCanvas value={qrUrl} size={200} />
          </div>
          <div className="text-center text-sm text-muted-foreground">
            微信/手机扫码即可免登录上报隐患。<br />
            此码为默认码（不关联区域），扫码后填报时仍可自行选择区域。
          </div>
          <Button variant="secondary" onClick={() => setQrOpen(false)}>关闭</Button>
        </div>
      </Modal>

      <LotteryModal open={!!lottery} mode="draw" result={lottery} hazardNo={lotteryNo} onClose={() => setLottery(null)} />
    </div>
  );
}
