import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { ArrowRight, ClipboardCheck } from 'lucide-react';
import { Button, Input, Card, CardContent } from '@/components/ui';
import { Field } from '@/components/kit';

export default function Login() {
  const { login, loading } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      await login(username.trim(), password);
    } catch (e: any) {
      setErr(e.response?.data?.message || '登录失败');
    }
  }

  return (
    <div className="ehs-grid flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-md">
        <Card className="relative animate-fade-in overflow-hidden rounded-2xl p-8 shadow-2xl">
          {/* 顶部强调色条 */}
          <span className="absolute inset-x-0 top-0 h-1 bg-primary" aria-hidden />

          <div className="flex flex-col items-center mb-7">
            <img
              src="/favicon.png"
              alt="EHS"
              className="mb-4 h-16 w-16 rounded-2xl object-cover shadow-[0_0_30px_-4px_hsl(var(--primary)/0.75)]"
            />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">EHS 隐患与作业管理系统</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">隐患管理 · 作业票 · 安全态势监控</p>
          </div>

          {err && (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {err}
            </div>
          )}

          <div className="space-y-4">
            <Field label="账号（姓名拼音）">
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="如 zhangsan"
                autoFocus
              />
            </Field>

            <Field label="密码">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            <Button type="submit" disabled={loading} size="lg" className="w-full">
              {loading ? '登录中…' : '登 录'}
              {!loading && <ArrowRight size={16} />}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="w-full"
              disabled={loading || !username.trim() || !password}
              onClick={async () => {
                setErr('');
                try {
                  await login(username.trim(), password);
                  navigate('/e-onsite');
                } catch (e: any) {
                  setErr(e.response?.data?.message || '登录失败');
                }
              }}
            >
              <ClipboardCheck size={16} className="mr-1" /> 登录进入电子现场台
            </Button>
          </div>

          <div className="mt-5 text-center text-xs text-muted-foreground">
            微信扫码上报无需登录，请扫描现场二维码
          </div>
          <button
            type="button"
            className="mt-2 w-full text-center text-xs font-medium text-primary hover:underline"
            onClick={() => navigate('/anonymous')}
          >
            进入免登录上报页（演示）
          </button>
        </Card>
      </form>
    </div>
  );
}
