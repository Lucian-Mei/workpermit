import React, { useState } from 'react';
import { Card, CardContent, Button, Input, Textarea, Select } from '@/components/ui';
import { Section } from '@/components/kit';
import { CheckCircle } from 'lucide-react';

export interface JsaItem {
  step: string;
  hazard: string;
  control: string;
  risk?: string;
}

const RISK_LEVELS = ['低', '中', '高', '重大'];
const RISK_COLOR: Record<string, string> = {
  低: 'bg-success/15 text-success',
  中: 'bg-warning/15 text-warning',
  高: 'bg-destructive/15 text-destructive',
  重大: 'bg-destructive text-destructive-foreground',
};

// 工作安全分析（JSA）：5 列可编辑表格
// 列：步骤编号 / 步骤内容 / 危害描述 / 风险等级 / 控制措施
// 同一步骤多危害时 step 相同、各占一行（编号合并显示）
export default function JsaSection({
  items,
  editable,
  onSave,
}: {
  items: JsaItem[];
  editable: boolean;
  onSave: (items: JsaItem[]) => Promise<void>;
}) {
  const [list, setList] = useState<JsaItem[]>(items || []);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => setList(items || []), [items]);

  function update(i: number, key: keyof JsaItem, val: string) {
    setList((l) => l.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)));
  }
  function add() {
    // 追加一行：默认沿用上一条的步骤（同步骤多危害场景）或空行
    const last = list[list.length - 1];
    setList((l) => [...l, { step: last?.step || '', hazard: '', control: '', risk: '中' }]);
  }
  function remove(i: number) {
    setList((l) => l.filter((_, idx) => idx !== i));
  }
  async function save() {
    setSaving(true);
    try {
      await onSave(list.filter((it) => it.step || it.hazard || it.control));
    } finally {
      setSaving(false);
    }
  }

  // 有效条目数：step/hazard/control 任一非空
  const validCount = list.filter((it) => it.step || it.hazard || it.control).length;

  // 步骤编号：step 与上一行相同则合并显示（不重复编号），否则按出现顺序编号
  const stepNos: number[] = [];
  let no = 0;
  list.forEach((it, i) => {
    if (i === 0 || it.step !== list[i - 1].step) {
      no += 1;
      stepNos.push(no);
    } else {
      stepNos.push(no);
    }
  });

  return (
    <Section title="工作安全分析（JSA）" icon={<CheckCircle size={16} className="text-primary" />}>
      <Card>
        <CardContent className="space-y-2">
          {editable && (
            <div className="flex items-center justify-end gap-2">
              <span className="text-xs text-muted-foreground mr-auto">已分析 {validCount} 条危害</span>
              <Button variant="secondary" onClick={add}>+ 手动添加一行</Button>
              <Button onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
            </div>
          )}

          {validCount === 0 && (
            <div className="text-xs text-destructive">⚠ 尚未填写 JSA 分析——无法提交此作业票。请填写至少 1 条危害分析与控制措施。</div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  <th className="text-left font-normal py-1.5 pr-2 w-10">步骤</th>
                  <th className="text-left font-normal py-1.5 pr-2 w-1/4">步骤内容</th>
                  <th className="text-left font-normal py-1.5 pr-2 w-1/3">危害描述</th>
                  <th className="text-left font-normal py-1.5 pr-2 w-16">风险等级</th>
                  <th className="text-left font-normal py-1.5 pr-2 w-1/3">控制措施</th>
                  {editable && <th className="w-8" />}
                </tr>
              </thead>
              <tbody>
                {list.map((it, i) => (
                  <tr key={i} className="border-b border-border/60 align-top">
                    <td className="py-1.5 pr-2 text-muted-foreground whitespace-nowrap">
                      {editable ? (
                        <Input value={it.step || ''} onChange={(e) => update(i, 'step', e.target.value)} className="w-14" />
                      ) : (
                        <span>步骤{stepNos[i]}</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      {editable ? (
                        <Input value={it.step} onChange={(e) => update(i, 'step', e.target.value)} placeholder="如：停机断电" />
                      ) : (
                        <span className="whitespace-pre-wrap">{it.step || '—'}</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      {editable ? (
                        <Textarea rows={2} value={it.hazard} onChange={(e) => update(i, 'hazard', e.target.value)} placeholder="如：未验电导致触电（≤30字）" />
                      ) : (
                        <span className="whitespace-pre-wrap">{it.hazard || '—'}</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      {editable ? (
                        <Select value={it.risk || '中'} onChange={(e) => update(i, 'risk', e.target.value)} className="!h-8 !py-0 !text-xs">
                          {RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </Select>
                      ) : (
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${RISK_COLOR[it.risk || ''] || 'bg-muted text-muted-foreground'}`}>
                          {it.risk || '—'}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      {editable ? (
                        <Textarea rows={2} value={it.control} onChange={(e) => update(i, 'control', e.target.value)} placeholder="如：验电笔逐相验电确认无电压（≤30字）" />
                      ) : (
                        <span className="whitespace-pre-wrap">{it.control || '—'}</span>
                      )}
                    </td>
                    {editable && (
                      <td className="py-1.5">
                        <button className="text-destructive text-xs underline" onClick={() => remove(i)}>删</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </Section>
  );
}
