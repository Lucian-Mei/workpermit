import React, { useEffect, useState } from 'react';
import api from '@/api/client';
import { Card, CardContent, CardDescription, Button, Input, Modal, Switch } from '@/components/ui';
import { Section, Field, FormGrid } from '@/components/kit';
import { QRCodeCanvas } from 'qrcode.react';
import { QrCode, Plus, Pencil, Trash2 } from 'lucide-react';

export default function QrCodePanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: '', scene: '', area: '', targetUrl: '', enabled: true });

  async function load() {
    try {
      const { data } = await api.get('/qr-codes');
      setRows(data || []);
    } catch {}
  }
  useEffect(() => {
    load();
  }, []);

  function gen() {
    const base = window.location.origin;
    setForm({ ...form, targetUrl: `${base}/anonymous` });
  }
  function openCreate() {
    setEditing(null);
    setForm({ name: '', scene: '', area: '', targetUrl: '', enabled: true });
    setOpen(true);
  }
  function openEdit(r: any) {
    setEditing(r);
    setForm({ name: r.name, scene: r.scene || '', area: r.area || '', targetUrl: r.targetUrl, enabled: r.enabled ?? true });
    setOpen(true);
  }
  async function submit() {
    setBusy(true);
    try {
      if (editing) await api.put(`/qr-codes/${editing.id}`, form);
      else await api.post('/qr-codes', form);
      setOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function remove(r: any) {
    if (!confirm(`删除二维码「${r.name}」？`)) return;
    await api.delete(`/qr-codes/${r.id}`);
    await load();
  }

  return (
    <Section
      title="微信上报二维码"
      icon={<QrCode size={18} />}
      action={
        <Button onClick={openCreate}>
          <Plus size={16} className="mr-1" /> 新增二维码
        </Button>
      }
    >
      <Card>
        <CardContent className="space-y-4">
          <CardDescription>
            生成指向「微信扫码免登录上报」页面的二维码，张贴于厂区/车间，员工扫码即可填姓名上报隐患。
          </CardDescription>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rows.map((r) => (
              <Card key={r.id}>
                <CardContent className="flex gap-3 items-center">
                  <div className="rounded-lg border border-border bg-card p-2">
                    <QRCodeCanvas value={r.targetUrl} size={96} />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-foreground">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.area || '-'} · {r.scene || '-'}
                    </div>
                    <div className="text-xs text-muted-foreground break-all">{r.targetUrl}</div>
                    <div className="flex gap-2 mt-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                        <Pencil size={14} className="mr-1" /> 编辑
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(r)}>
                        <Trash2 size={14} className="mr-1" /> 删除
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {rows.length === 0 && (
              <div className="col-span-full p-3 text-center text-muted-foreground">暂无二维码，点击右上角新增。</div>
            )}
          </div>
        </CardContent>
      </Card>
      <Modal
        open={open}
        title={editing ? '编辑二维码' : '新增二维码'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button disabled={busy} onClick={submit}>
              {editing ? '保存' : '创建'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormGrid cols={2}>
            <Field label="名称*" className="md:col-span-2">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：厂区A-西门" />
            </Field>
            <Field label="场景">
              <Input value={form.scene} onChange={(e) => setForm({ ...form, scene: e.target.value })} placeholder="gate/workshop" />
            </Field>
            <Field label="关联区域">
              <Input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
            </Field>
          </FormGrid>
          <Field label="跳转链接*">
            <div className="flex gap-2">
              <Input value={form.targetUrl} onChange={(e) => setForm({ ...form, targetUrl: e.target.value })} placeholder="https://.../anonymous" />
              <Button variant="secondary" onClick={gen}>
                生成本站链接
              </Button>
            </div>
          </Field>
          <Field label="启用">
            <div className="flex items-center gap-2">
              <Switch checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
              <span className="text-sm text-muted-foreground">启用后该二维码可被扫码上报</span>
            </div>
          </Field>
        </div>
      </Modal>
    </Section>
  );
}
