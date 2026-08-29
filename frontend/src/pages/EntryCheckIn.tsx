import React, { useState, useRef, useCallback } from 'react';
import { Button, Input, Card, CardContent } from '@/components/ui';
import { ShieldCheck, XCircle, Loader2, LogOut, CheckCircle2, ScanLine, X } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';

type Mode = 'in' | 'out';

// 门卫工位入场管理页：
//  - 入厂签到：必须提供 6 位数字作业代码（经审批且未完工的作业票）+ 姓名 + 身份证 + 手机号(可选)
//  - 离厂签出：不需要作业代码，按 姓名 + 身份证/手机号 匹配在厂记录；
//    重名或名字不正确时提示补充身份证号；签出成功展示带日期的签出凭证供保安核验放行
export default function EntryCheckIn() {
  const [mode, setMode] = useState<Mode>('in');

  // 签到字段
  const [workCode, setWorkCode] = useState('');
  const [name, setName] = useState('');
  const [idCard, setIdCard] = useState('');
  const [phone, setPhone] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ lastSignOutAt: string } | null>(null);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  function resetFields() {
    setWorkCode('');
    setName('');
    setIdCard('');
    setPhone('');
  }

  function switchMode(m: Mode) {
    setMode(m);
    setResult(null);
    if (m === 'out') setWorkCode(''); // 签出不需要作业码
  }

  function extractWorkCode(text: string): string | null {
    const trimmed = text.trim();
    // 直接是 6 位数字
    if (/^\d{6}$/.test(trimmed)) return trimmed;
    // URL 形式 ?workCode=123456
    try {
      const url = new URL(trimmed, window.location.href);
      const wc = url.searchParams.get('workCode');
      if (wc && /^\d{6}$/.test(wc)) return wc;
    } catch { /* 非 URL 则继续 */ }
    // 文本中任意连续 6 位数字
    const m = trimmed.match(/(\d{6})/);
    return m ? m[1] : null;
  }

  async function startScan() {
    setScanError(null);
    setScanning(true);
    try {
      const scanner = new Html5Qrcode('entry-qr-scanner');
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => {
          const wc = extractWorkCode(decodedText);
          if (wc) {
            setWorkCode(wc);
            stopScan();
          } else {
            setScanError('无法识别作业代码：请扫描包含 6 位作业代码的二维码');
          }
        },
        () => { /* 持续扫描，忽略未识别帧 */ },
      );
    } catch (e: any) {
      setScanning(false);
      setScanError('摄像头启动失败：' + (e?.message || '请确认已授权摄像头权限'));
      scannerRef.current = null;
    }
  }

  async function stopScan() {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        await scannerRef.current.clear();
      } catch { /* ignore */ }
      scannerRef.current = null;
    }
    setScanning(false);
    setScanError(null);
  }

  async function submitIn(confirmed = false) {
    if (!workCode || !name || !idCard) {
      setResult({ ok: false, reason: '请填写作业代码、姓名和身份证号' });
      return;
    }
    setLoading(true);
    setResult(null);
    setPendingConfirm(null);
    try {
      const r = await fetch('/api/public/entry-by-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workCode, name, idCard, phone, action: 'in', confirmed }),
      });
      const data = await r.json();
      if (data.needConfirm && data.lastSignOutAt) {
        setPendingConfirm({ lastSignOutAt: data.lastSignOutAt });
      } else {
        setResult(data);
      }
    } catch (e: any) {
      setResult({ ok: false, reason: '网络错误：' + (e?.message || '') });
    } finally {
      setLoading(false);
    }
  }

  async function submitOut() {
    if (!name) {
      setResult({ ok: false, reason: '请填写姓名' });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch('/api/public/entry-signout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, idCard, phone }),
      });
      setResult(await r.json());
    } catch (e: any) {
      setResult({ ok: false, reason: '网络错误：' + (e?.message || '') });
    } finally {
      setLoading(false);
    }
  }

  // ===== 签出成功 → 展示凭证页（门卫核验放行）=====
  if (mode === 'out' && result?.ok) {
    const w = result.worker || {};
    const p = result.permit || {};
    return (
      <div className="min-h-screen bg-slate-900 p-4 flex flex-col">
        <div className="max-w-md mx-auto w-full mt-6">
          <div className="rounded-2xl bg-white shadow-2xl overflow-hidden">
            {/* 顶部横幅 */}
            <div className="bg-emerald-600 px-6 py-6 text-center">
              <CheckCircle2 className="mx-auto mb-2 text-white" size={52} strokeWidth={1.5} />
              <h1 className="text-2xl font-bold text-white">离厂签出凭证</h1>
              <p className="text-emerald-100 text-sm mt-1">已办理离厂签出，请保安核对后放行</p>
            </div>

            {/* 关键信息（含日期，防截图造假） */}
            <div className="px-6 py-6 space-y-5">
              <div className="text-center">
                <div className="text-xs text-muted-foreground">签出时间</div>
                <div className="mt-1 text-3xl font-bold tabular-nums text-foreground">
                  {result.signOutTime || '—'}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">姓名</span>
                  <span className="font-semibold text-foreground">{w.name || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">身份证号</span>
                  <span className="font-mono text-foreground">{w.idCard || '—'}</span>
                </div>
                {w.phone && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">手机号</span>
                    <span className="font-mono text-foreground">{w.phone}</span>
                  </div>
                )}
                {p.permitNo && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">作业票号</span>
                    <span className="font-semibold text-foreground">{p.permitNo}</span>
                  </div>
                )}
                {p.department && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">作业单位/部门</span>
                    <span className="font-semibold text-foreground">{p.department}</span>
                  </div>
                )}
                {p.location && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">作业地点</span>
                    <span className="font-semibold text-foreground">{p.location}</span>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-center">
                <div className="text-emerald-700 font-semibold">✓ 已核验离厂</div>
                <div className="text-emerald-600 text-xs mt-1">请保安确认姓名与签出时间后放行</div>
              </div>
            </div>
          </div>

          <Button
            className="w-full mt-4 bg-white/10 hover:bg-white/20 text-white"
            onClick={() => { setResult(null); resetFields(); }}
          >
            继续办理下一人
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 flex flex-col">
      <div className="max-w-md mx-auto w-full mt-6">
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="text-center">
              <h1 className="text-2xl font-bold flex items-center justify-center gap-2">
                🚪 入场管理
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                门卫室工位 · 扫描登记二维码后操作
              </p>
            </div>

            {/* 签到 / 签出 切换 */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => switchMode('in')}
                className={`rounded-md py-2.5 text-sm font-semibold transition ${
                  mode === 'in'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70'
                }`}
              >
                入厂签到
              </button>
              <button
                type="button"
                onClick={() => switchMode('out')}
                className={`rounded-md py-2.5 text-sm font-semibold transition flex items-center justify-center gap-1 ${
                  mode === 'out'
                    ? 'bg-sky-600 text-white'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70'
                }`}
              >
                <LogOut size={15} /> 离厂签出
              </button>
            </div>

            {mode === 'out' && (
              <p className="rounded-md bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-700">
                签出不需要作业代码：填写姓名，若有重名或名字不符系统会提示补充身份证号。
              </p>
            )}

            <div className="space-y-3">
              {mode === 'in' && (
                <div>
                  <label className="text-xs text-muted-foreground flex items-center justify-between">
                    <span>作业代码（6 位数字，经审批且未完工的作业票）</span>
                    {!scanning && (
                      <button
                        type="button"
                        onClick={startScan}
                        className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"
                      >
                        <ScanLine size={13} /> 扫码填码
                      </button>
                    )}
                  </label>
                  <Input
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="例如 451744"
                    value={workCode}
                    onChange={(e) => setWorkCode(e.target.value.replace(/\D/g, ''))}
                    className="text-2xl font-mono text-center tracking-widest mt-1"
                  />

                  {scanning && (
                    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2">
                      <div className="flex items-center justify-between px-1 pb-1">
                        <span className="text-xs font-medium text-emerald-800">请将作业票二维码对准摄像头</span>
                        <button
                          type="button"
                          onClick={stopScan}
                          className="inline-flex items-center rounded p-1 text-emerald-800 hover:bg-emerald-100"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <div id="entry-qr-scanner" className="w-full overflow-hidden rounded" />
                      {scanError && (
                        <div className="mt-1 text-xs text-red-600">{scanError}</div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className="text-xs text-muted-foreground">姓名 {mode === 'in' ? '' : '（必填）'}</label>
                <Input
                  placeholder="本人真实姓名"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">身份证号 {mode === 'in' ? '' : '（重名或姓名不符时必填）'}</label>
                <Input
                  placeholder={mode === 'in' ? '18 位身份证号' : '用于确认身份（可选）'}
                  value={idCard}
                  onChange={(e) => setIdCard(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">手机号（可选）</label>
                <Input
                  inputMode="tel"
                  placeholder="用于快速匹配在厂记录"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>

            <Button
              onClick={() => (mode === 'in' ? submitIn() : submitOut())}
              disabled={loading}
              className={`w-full ${mode === 'in' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-sky-600 hover:bg-sky-700'}`}
            >
              {loading ? <Loader2 className="animate-spin mr-1" size={16} /> : null}
              {mode === 'in' ? '确认入厂签到' : '确认离厂签出'}
            </Button>

            {result && !result.ok && (
              <div className="rounded-md p-3 text-sm flex items-start gap-2 bg-red-50 text-red-700 border border-red-200">
                <XCircle className="mt-0.5 shrink-0" size={18} />
                <div>
                  <div className="font-semibold">❌ 操作失败</div>
                  <div className="mt-1 text-xs">{result.reason}</div>
                  {result.needIdCard && (
                    <div className="mt-2 text-xs font-semibold">请在「身份证号」栏补充填写身份证号后重试</div>
                  )}
                </div>
              </div>
            )}

            {result && result.ok && mode === 'in' && (
              <div className="rounded-md p-3 text-sm flex items-start gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200">
                <ShieldCheck className="mt-0.5 shrink-0" size={18} />
                <div>
                  <div className="font-semibold">✅ 入场签到成功，准予作业</div>
                  <div className="mt-1 text-xs">{result.message}</div>
                  {result.permit && (
                    <div className="mt-1 text-xs">
                      {result.permit.permitNo} · {result.permit.content}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 再次入场确认 */}
            {pendingConfirm && mode === 'in' && (
              <div className="rounded-md p-3 text-sm bg-amber-50 text-amber-800 border border-amber-300 space-y-3">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 text-base">⚠️</span>
                  <div>
                    <div className="font-semibold">确认再次入场？</div>
                    <div className="mt-1 text-xs">
                      该身份证今日已于 {new Date(pendingConfirm.lastSignOutAt).toLocaleString('zh-CN')} 签出，
                      请确认上次的签出无误后再重新入场。
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => submitIn(true)}
                    disabled={loading}
                    className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    {loading ? <Loader2 className="animate-spin mr-1" size={16} /> : null}
                    确认再次入场
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPendingConfirm(null)}
                    disabled={loading}
                    className="flex-1"
                  >
                    取消
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground mt-4">
          EHS 隐患与作业管理系统 · 入场管理
        </p>
      </div>
    </div>
  );
}
