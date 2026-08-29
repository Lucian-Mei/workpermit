// 打印模板管理：系统设置 → 打印模板。可视化编辑器入口 + 按作业类型关联默认模板。
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Card, CardContent, EmptyState, Modal, Select } from '@/components/ui';
import { DataTable, Tag } from '@/components/kit';
import { FileText, Plus, Pencil, Trash2, Copy, LayoutTemplate, RotateCcw, Link2 } from 'lucide-react';
import {
  PrintTemplate,
  defaultTemplate,
  loadTemplates,
  saveTemplates,
  loadAssignments,
  saveAssignments,
  restorePresetTemplates,
  uid,
} from '@/utils/printTemplate';
import { WORK_PERMIT_TYPES } from '@/constants';
import PrintTemplateEditor from '@/components/PrintTemplateEditor';

export default function PrintTemplatePanel() {
  const [templates, setTemplates] = useState<PrintTemplate[]>([]);
  const [assignments, setAssignmentsState] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<PrintTemplate | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  async function load() {
    try {
      const [list, assign] = await Promise.all([loadTemplates(), loadAssignments()]);
      setTemplates(list);
      setAssignmentsState(assign);
    } catch { /* 静默 */ }
  }
  useEffect(() => { load(); }, []);

  function openNew() {
    setEditing(defaultTemplate());
    setEditorOpen(true);
  }
  function openEdit(t: PrintTemplate) {
    setEditing(JSON.parse(JSON.stringify(t)));
    setEditorOpen(true);
  }

  async function handleSave(t: PrintTemplate) {
    setBusy(true);
    try {
      const exists = templates.some((x) => x.id === t.id);
      const next = exists ? templates.map((x) => (x.id === t.id ? t : x)) : [...templates, t];
      await saveTemplates(next);
      setTemplates(next);
      setEditing(null);
      setEditorOpen(false);
    } catch (e: any) {
      alert(e?.response?.data?.message || '保存失败');
    } finally {
      setBusy(false);
    }
  }

  // 复制模板（副本不继承作业类型，作为通用模板，避免与原模板抢占关联）
  async function duplicate(t: PrintTemplate) {
    const copy: PrintTemplate = {
      ...JSON.parse(JSON.stringify(t)),
      id: uid(),
      name: `${t.name}（副本）`,
      workPermitType: undefined,
      updatedAt: new Date().toISOString(),
    };
    const next = [...templates, copy];
    await saveTemplates(next);
    setTemplates(next);
  }

  // 删除模板（用自定义确认 Modal，避免浏览器 confirm 被拦截导致「删不掉」）
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  async function confirmDoDelete() {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    const next = templates.filter((t) => t.id !== id);
    await saveTemplates(next);
    setTemplates(next);
    const cleaned = { ...assignments };
    Object.keys(cleaned).forEach((k) => { if (cleaned[k] === id) delete cleaned[k]; });
    await saveAssignments(cleaned);
    setAssignmentsState(cleaned);
    setConfirmDelete(null);
  }
  async function restorePresets() {
    if (!confirm('恢复内置预设模板？将覆盖 9 套同名预设并重置按作业类型关联，自建模板不受影响。')) return;
    setBusy(true);
    try {
      const { templates: next, assignments: assign } = await restorePresetTemplates();
      setTemplates(next);
      setAssignmentsState(assign);
    } catch (e: any) {
      alert(e?.response?.data?.message || '恢复失败');
    } finally {
      setBusy(false);
    }
  }

  // 修改按 type 的默认模板关联
  async function setAssignment(typeKey: string, templateId: string) {
    const cleaned = { ...assignments };
    if (templateId) cleaned[typeKey] = templateId;
    else delete cleaned[typeKey];
    try {
      await saveAssignments(cleaned);
      setAssignmentsState(cleaned);
    } catch (e: any) {
      alert(e?.response?.data?.message || '保存关联失败');
    }
  }

  // 作业类型列表（含常规）
  const typeRows = useMemo(() => {
    const list: Array<{ key: string; label: string; hazardous: boolean }> = [];
    for (const [k, v] of Object.entries(WORK_PERMIT_TYPES)) {
      list.push({ key: k, label: (v as any).label, hazardous: (v as any).isHazardous });
    }
    return list;
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-base font-bold">
            <LayoutTemplate size={18} className="text-primary" /> 打印模板
          </div>
          <div className="text-sm text-muted-foreground">
            系统已内置 9 套预设模板（动火/高处/受限/吊装/动土断路/临电/盲板/其他/常规），并已按作业类型关联好默认模板。每个模板支持复制、编辑、删除，也可新建模板，并在下方「按作业类型关联」区自由更换每种作业的默认模板。
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={openNew}>
              <Plus size={16} className="mr-1" /> 新建模板
            </Button>
            <Button variant="secondary" onClick={restorePresets} disabled={busy}>
              <RotateCcw size={16} className="mr-1" /> 恢复内置预设
            </Button>
            <Button variant="ghost" onClick={load} disabled={busy}>刷新</Button>
          </div>
        </CardContent>
      </Card>

      {/* 按作业类型关联默认模板 */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-base font-bold">
            <Link2 size={18} className="text-primary" /> 按作业类型关联默认模板
          </div>
          <div className="text-sm text-muted-foreground">
            为每种作业类型分配一个默认打印模板（可自由更换）。打印时按作业类型自动套用；未分配的作业类型使用首个「通用」模板。
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2">作业类型</th>
                  <th className="px-2 py-2">危险作业</th>
                  <th className="px-2 py-2">默认打印模板</th>
                </tr>
              </thead>
              <tbody>
                {typeRows.map((row) => {
                  const tplId = assignments[row.key] || '';
                  const tpl = tplId ? templates.find((t) => t.id === tplId) : null;
                  return (
                    <tr key={row.key} className="border-b last:border-0">
                      <td className="px-2 py-2">
                        <span className="font-medium">{row.label}</span>
                        <span className="ml-1 text-xs text-muted-foreground">({row.key})</span>
                      </td>
                      <td className="px-2 py-2">
                        {row.hazardous ? <Tag color="#ef4444">危险作业</Tag> : <Tag color="#22c55e">常规</Tag>}
                      </td>
                      <td className="px-2 py-2">
                        <Select
                          value={tplId}
                          onChange={(e) => setAssignment(row.key, e.target.value)}
                          className="max-w-md"
                        >
                          <option value="">— 通用默认 —</option>
                          {templates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}{t.workPermitType ? ` · ${t.workPermitType}` : ' · 通用'}
                            </option>
                          ))}
                        </Select>
                        {tpl && <span className="ml-2 text-xs text-muted-foreground">当前：{tpl.name}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <DataTable
        loading={busy}
        rows={templates}
        rowKey={(t) => t.id}
        columns={[
          {
            key: 'name',
            header: '模板名称',
            render: (t) => (
              <span className="flex items-center gap-2">
                <FileText size={15} className="text-primary" />
                <span className="font-medium">{t.name}</span>
                <Tag color="#6366f1">作业票</Tag>
                {t.workPermitType && <Tag color="#0ea5e9">{t.workPermitType}</Tag>}
                {!t.workPermitType && <Tag color="#94a3b8">通用</Tag>}
              </span>
            ),
          },
          { key: 'count', header: '元素数', render: (t) => <span className="text-sm">{(t.elements || []).length}</span> },
          {
            key: 'updatedAt',
            header: '更新时间',
            render: (t) => (
              <span className="text-xs text-muted-foreground">
                {t.updatedAt ? new Date(t.updatedAt).toLocaleString('zh-CN') : '—'}
              </span>
            ),
          },
          {
            key: 'op',
            header: '操作',
            align: 'right',
            render: (t) => (
              <div className="flex items-center justify-end gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => duplicate(t)} title="复制模板">
                  <Copy size={13} className="mr-1" /> 复制
                </Button>
                <Button variant="secondary" size="sm" onClick={() => openEdit(t)}>
                  <Pencil size={13} className="mr-1" /> 编辑
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete({ id: t.id, name: t.name })}>
                  <Trash2 size={13} className="mr-1" /> 删除
                </Button>
              </div>
            ),
          },
        ]}
        empty={
          <EmptyState
            icon={<LayoutTemplate size={26} />}
            title="暂无模板"
            hint="点击「恢复内置预设」生成 9 套预设模板，或点击「新建模板」自行可视化配置。"
          />
        }
      />

      {/* 编辑器（全屏编辑层，画布空间充足）：
          用 createPortal 挂到 body，避免 .page-fade 的 transform 动画使其 fixed 参照页面容器而锁死高度 */}
      {editing &&
        createPortal(
          <div className="fixed inset-0 z-50 overflow-auto bg-[hsl(var(--background))] p-4">
            <PrintTemplateEditor
              template={editing}
              onSave={handleSave}
              onClose={() => { setEditing(null); setEditorOpen(false); }}
            />
          </div>,
          document.body,
        )}

      {/* 删除确认 Modal（避免浏览器 confirm 被拦） */}
      <Modal open={!!confirmDelete} title="删除打印模板" onClose={() => setConfirmDelete(null)}>
        <div className="space-y-3">
          <div className="text-sm">
            确定删除模板「<span className="font-medium">{confirmDelete?.name}</span>」？相关作业类型将回退到通用模板。
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>取消</Button>
            <Button variant="destructive" onClick={confirmDoDelete}>确认删除</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}