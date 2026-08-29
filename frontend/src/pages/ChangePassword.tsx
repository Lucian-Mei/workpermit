import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { saveAuth } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, Button, Input, PageHeader } from '@/components/ui';
import { Field } from '@/components/kit';
import { KeyRound } from 'lucide-react';

export default function ChangePassword() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setMsg('');
    if (newPwd.length < 6) return setErr('新密码至少 6 位');
    if (newPwd !== confirm) return setErr('两次输入不一致');
    try {
      const { data } = await api.post('/auth/change-password', { oldPassword: oldPwd, newPassword: newPwd });
      // 后端已重新签发会话（新 Cookie + 新 Access Token），前端同步本地态
      if (data?.token && data?.user) saveAuth(data.token, data.user);
      else await refresh();
      setMsg('密码修改成功，正在跳转…');
      setTimeout(() => navigate('/'), 800);
    } catch (e: any) {
      setErr(e.response?.data?.message || '修改失败');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted p-4">
      <div className="w-full max-w-md space-y-[var(--gap-card)]">
        <PageHeader
          title="修改密码"
          description="首次登录需修改系统下发的初始密码"
          icon={<KeyRound size={20} />}
        />
        <Card>
          <CardContent className="space-y-3">
            {err && <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-2">{err}</div>}
            {msg && <div className="text-sm text-success bg-success/10 rounded-lg p-2">{msg}</div>}
            <form onSubmit={submit} className="space-y-3">
              <Field label="原密码">
                <Input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} placeholder="请输入原密码" autoFocus />
              </Field>
              <Field label="新密码">
                <Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="至少 6 位" />
              </Field>
              <Field label="确认新密码">
                <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="再次输入新密码" />
              </Field>
              <Button type="submit" className="w-full">确认修改</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
