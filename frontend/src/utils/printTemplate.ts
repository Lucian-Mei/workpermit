// 打印模板：类型定义、字段库、默认模板、存储与渲染工具
// 模板通过「系统设置 → 打印模板」可视化编辑器维护，存于 system_config (key=print_templates)。
import dayjs from 'dayjs';
import api from '@/api/client';
import { WORK_PERMIT_TYPES, WORK_PERMIT_STATUS } from '@/constants';
import { presetTemplates } from '@/utils/printTemplatePresets';

// A4 尺寸（mm）
export const A4_W = 210;
export const A4_H = 297;

export type PrintElementType = 'field' | 'text' | 'line' | 'sign' | 'image' | 'table';

export interface PrintTableData {
  rows: number;
  cols: number;
  cells: string[][]; // cells[r][c]；支持 {{fieldKey}} 占位符绑定字段值
}

export interface PrintElement {
  id: string;
  type: PrintElementType;
  x: number; // mm，相对 A4 左上角
  y: number;
  w: number;
  h: number;
  // field：绑定字段
  fieldKey?: string;
  label?: string; // 字段前缀标签，如「申请人：」（为空则只显示值）
  // text：自由文本
  text?: string;
  // sign：签字框
  signRole?: string; // 如「申请人签字」
  // image：图片（base64 dataURL）
  src?: string;
  // table：表格
  table?: PrintTableData;
  // 通用样式
  fontSize: number; // pt
  bold?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
  /** 文本/字段在元素内的垂直对齐（默认 top）。用于实现「左上对齐」等组合 */
  valign?: 'top' | 'middle' | 'bottom';
  /** 所属页码（1=A4 第一面，2=A4 第二面）。默认 1。正反面打印时第二面元素填 page:2 */
  page?: 1 | 2;
  border?: boolean; // field/sign 显示边框
  /** 值为空时仍渲染（保留 label/边框），如检查结果空列、需展示的留白框 */
  always?: boolean;
  /** 字段/文本为空时显示的占位文本（如交底未勾选字段显示"（未勾选）"） */
  emptyHint?: string;
  /** 单行不换行（票面字段用：避免 value 过长撑高与下个元素重叠） */
  singleLine?: boolean;
}

export interface PrintTemplate {
  id: string;
  name: string;
  kind: 'work_permit'; // 适用单据类型（当前仅作业票）
  /** 适用作业类型（hot_work / high_altitude / ... / routine），'all' 表示通用模板（兜底） */
  workPermitType?: string;
  elements: PrintElement[];
  updatedAt?: string;
}

export const STORAGE_KEY = 'print_templates';
/** 按作业类型关联默认模板：{ [workPermitType]: templateId } */
export const ASSIGNMENTS_KEY = 'print_template_assignments';

// ============ 字段库（作业票可打印字段） ============
export interface PrintFieldDef {
  key: string;
  label: string;
  group: 'base' | 'person' | 'time' | 'risk' | 'briefing' | 'other';
}
export const PRINT_FIELD_GROUPS: { key: string; label: string }[] = [
  { key: 'base', label: '票面信息' },
  { key: 'person', label: '人员/单位' },
  { key: 'time', label: '时间' },
  { key: 'risk', label: '风险/代码' },
  { key: 'briefing', label: '交底/风险' },
  { key: 'other', label: '申请补充' },
];
export const PRINT_FIELDS: PrintFieldDef[] = [
  { key: 'permitNo', label: '作业票号', group: 'base' },
  { key: 'typeLabel', label: '作业类型', group: 'base' },
  { key: 'statusLabel', label: '状态', group: 'base' },
  { key: 'jobName', label: '作业名称', group: 'base' },
  { key: 'content', label: '作业内容', group: 'base' },
  { key: 'area', label: '作业区域', group: 'base' },
  { key: 'location', label: '作业位置', group: 'base' },
  { key: 'department', label: '申请部门', group: 'person' },
  { key: 'applicantName', label: '申请人', group: 'person' },
  { key: 'operatorNames', label: '作业人', group: 'person' },
  { key: 'supervisorName', label: '监护人', group: 'person' },
  { key: 'supervisorContact', label: '监护人电话', group: 'person' },
  { key: 'contractorUnit', label: '承包商单位', group: 'person' },
  { key: 'contractorHead', label: '承包商负责人', group: 'person' },
  { key: 'contractorPhone', label: '承包商电话', group: 'person' },
  { key: 'managementDept', label: '管理部门', group: 'person' },
  { key: 'managementPerson', label: '管理责任人', group: 'person' },
  { key: 'startTime', label: '作业开始', group: 'time' },
  { key: 'endTime', label: '作业结束', group: 'time' },
  { key: 'workCode', label: '作业代码', group: 'risk' },
  { key: 'riskSummary', label: '主要风险摘要', group: 'risk' },
  // —— 交底 / 风险（来自现场安全交底，d.briefing.points）——
  { key: 'briefHazards', label: '涉及危险作业', group: 'briefing' },
  { key: 'briefEnv', label: '工作环境危害因素', group: 'briefing' },
  { key: 'briefEquip', label: '待修设备危害因素', group: 'briefing' },
  { key: 'briefProcess', label: '作业过程危害因素', group: 'briefing' },
  { key: 'briefMeasures', label: '风险控制措施', group: 'briefing' },
  { key: 'briefToolChecks', label: '设备工具检查', group: 'briefing' },
  { key: 'briefContent', label: '交底内容', group: 'briefing' },
  { key: 'briefBriefer', label: '交底人', group: 'briefing' },
  { key: 'briefTime', label: '交底时间', group: 'briefing' },
  { key: 'jsaSteps', label: 'JSA分析步骤', group: 'briefing' },
  { key: 'checkedMeasures', label: '已确认安全措施清单', group: 'briefing' },
  // —— 申请补充（作业申请单扩展字段）——
  { key: 'projectName', label: '项目名称', group: 'other' },
  { key: 'building', label: '楼栋', group: 'other' },
  { key: 'floor', label: '楼层', group: 'other' },
  { key: 'materialsList', label: '材料清单', group: 'other' },
  { key: 'equipmentList', label: '设备清单', group: 'other' },
  { key: 'operatorCount', label: '作业人数', group: 'other' },
];

export function fieldLabel(key: string): string {
  return PRINT_FIELDS.find((f) => f.key === key)?.label || key;
}

// 解析字段值（入参 d 为 work_permits 详情对象）
export function resolveField(d: any, key: string): string {
  if (!d) return '';
  const app = d.application || {};
  const get = (v: any) => (v === null || v === undefined ? '' : String(v));
  switch (key) {
    case 'permitNo': return get(d.permitNo);
    case 'typeLabel': return (WORK_PERMIT_TYPES[d.type]?.label || get(d.type));
    case 'statusLabel': return (WORK_PERMIT_STATUS[d.status]?.label || get(d.status));
    case 'jobName': return get(app.jobName || d.content || d.jobName || '');
    case 'content': return get(d.content || app.content || '');
    case 'area': return get(d.area || app.area || '');
    case 'location': return get(d.location || app.location || '');
    case 'department': return get(d.department || app.department || '');
    case 'applicantName': return get(d.applicantName || app.applicantName || '');
    case 'operatorNames': {
      const o = d.operatorNames || app.operatorNames;
      if (Array.isArray(o)) return o.join('、');
      return get(o);
    }
    case 'supervisorName': return get(d.supervisorName || app.managementPerson || '');
    case 'supervisorContact': return get(d.supervisorContact || '');
    case 'contractorUnit': return get(app.contractorUnit || '');
    case 'contractorHead': return get(app.contractorHead || '');
    case 'contractorPhone': return get(app.contractorPhone || '');
    case 'managementDept': return get(app.managementDept || d.department || '');
    case 'managementPerson': return get(app.managementPerson || '');
    case 'startTime': return d.startTime ? dayjs(d.startTime).format('YYYY-MM-DD HH:mm') : (app.planStart ? dayjs(app.planStart).format('YYYY-MM-DD HH:mm') : '');
    case 'endTime': return d.endTime ? dayjs(d.endTime).format('YYYY-MM-DD HH:mm') : (app.planEnd ? dayjs(app.planEnd).format('YYYY-MM-DD HH:mm') : '');
    case 'workCode': return get(d.workCode || '');
    // 主要风险摘要：由 JSA 危害 + 已确认风险清单(riskHazards[checked]) + 交底危害 动态汇总（不写死）
    // 本次口径：不评整体风险等级，仅呈现各步骤/各条危害，供现场人员识别。
    case 'riskSummary': {
      const set = new Set<string>();
      const rh = Array.isArray(d.riskHazards) ? d.riskHazards : [];
      rh.forEach((r: any) => { if (r && r.checked !== false) { const h = get(r.hazard); if (h) set.add(h); } });
      const jsas = Array.isArray(d.jsas) ? d.jsas : [];
      jsas.forEach((j: any) => { const h = get(j.hazard); if (h) set.add(h); });
      // 常规作业：从交底勾选清单取危害（hazard_types / env / process）
      ['hazard_types', 'env', 'process'].forEach((k) => {
        briefChecked(d, k).split('\n').forEach((x) => { const t = x.trim(); if (t) set.add(t); });
      });
      return [...set].join('；');
    }
    // —— 交底/风险：从 d.briefing.points（勾选清单）取勾选项 ——
    case 'briefHazards': return briefChecked(d, 'hazard_types');
    case 'briefEnv': return briefChecked(d, 'env');
    case 'briefEquip': return briefChecked(d, 'equip');
    case 'briefProcess': return briefChecked(d, 'process');
    case 'briefMeasures': return briefChecked(d, 'measures');
    case 'briefToolChecks': return briefChecked(d, 'tool_checks');
    case 'briefContent': return get(d.briefing?.content);
    case 'briefBriefer': return get(d.briefing?.briefer);
    case 'briefBrieferInternal': return get(d.briefing?.briefer);
    case 'briefBrieferContractor': return get(app.contractorHead || '');
    case 'briefTime': return d.briefing?.briefedAt ? dayjs(d.briefing.briefedAt).format('YYYY-MM-DD HH:mm') : '';
    // JSA 步骤风险分析（含每步风险定级，按本次口径仅做步骤级定级，不做整体风险等级）
    case 'jsaSteps': {
      const jsas = Array.isArray(d.jsas) ? d.jsas : [];
      return jsas
        .map((j: any, i: number) => {
          const step = get(j.step || j.process || `步骤${i + 1}`);
          const hazard = get(j.hazard);
          const risk = get(j.risk); // 高/中/低（步骤级）
          const control = get(j.control || j.measure);
          const parts: string[] = [step];
          if (hazard) parts.push(`危害：${hazard}`);
          if (risk) parts.push(`风险定级：${risk}`);
          if (control) parts.push(`措施：${control}`);
          return parts.join(' / ');
        })
        .join('\n');
    }
    // 已勾选安全措施清单：measureSelections 中 checked===true 的项（申请/审批时确认过，未勾选=不适用，不打印）
    case 'checkedMeasures': {
      let list: any[] = [];
      if (Array.isArray(d.measureSelections)) list = d.measureSelections;
      else if (Array.isArray(d.safetyMeasures)) list = d.safetyMeasures.map((s: any) => (typeof s === 'string' ? { content: s, checked: true } : s));
      else if (Array.isArray(app.measureSelections)) list = app.measureSelections;
      const checked = list.filter((m: any) => m && m.checked !== false);
      return checked
        .map((m: any, i: number) => {
          const content = get(m.content);
          const note = get(m.note);
          return note ? `${i + 1}. ${content}（${note}）` : `${i + 1}. ${content}`;
        })
        .join('\n');
    }
    // —— 申请补充 ——
    case 'projectName': return get(d.application?.projectName || app.projectName || '');
    case 'building': return get(app.building || d.building || '');
    case 'floor': return get(app.floor || d.floor || '');
    case 'materialsList': return get(app.materialsList || d.materialsList || '');
    case 'equipmentList': return get(app.equipmentList || d.equipmentList || '');
    case 'operatorCount': return get(app.expectedOperatorCount || app.operatorCount || d.expectedOperatorCount || '');
    default: return '';
  }
}

// 从交底勾选清单（d.briefing.points）取某组已勾选/异常项，多行文本
function briefChecked(d: any, key: string): string {
  const points = d?.briefing?.points || d?.briefing?.groups || [];
  if (!Array.isArray(points)) return '';
  const g = points.find((x: any) => x?.key === key);
  if (!g || !Array.isArray(g.items)) return '';
  return (g.items as any[])
    .filter((it) => it?.checked || it?.status === 'abnormal')
    .map((it) => {
      const txt = it.text || '';
      const custom = it._userInput || it.custom || '';
      if (custom) return txt.includes('：') || txt.includes(':') ? txt + custom : txt + '：' + custom;
      return txt;
    })
    .join('\n');
}

// ============ 默认模板（A4 正面版式） ============
const FONT = 12;
export function defaultTemplate(): PrintTemplate {
  const el = (p: Partial<PrintElement> & { id: string }): PrintElement => ({ fontSize: FONT, align: 'left', ...p } as PrintElement);
  const els: PrintElement[] = [];
  let y = 16;
  // 标题
  els.push(el({ id: 't1', type: 'text', x: 30, y: 10, w: 150, h: 10, text: '安全作业票', fontSize: 20, bold: true, align: 'center' }));
  y = 26;
  // 顶部信息
  els.push(el({ id: 'f0', type: 'field', x: 12, y, w: 92, h: 8, fieldKey: 'permitNo', label: '作业票号：', border: true }));
  els.push(el({ id: 'f1', type: 'field', x: 106, y, w: 92, h: 8, fieldKey: 'typeLabel', label: '作业类型：', border: true }));
  y += 10;
  els.push(el({ id: 'f2', type: 'field', x: 12, y, w: 92, h: 8, fieldKey: 'statusLabel', label: '状态：', border: true }));
  els.push(el({ id: 'f3', type: 'field', x: 106, y, w: 92, h: 8, fieldKey: 'workCode', label: '作业代码：', border: true }));
  y += 10;
  els.push(el({ id: 'f4', type: 'field', x: 12, y, w: 186, h: 8, fieldKey: 'jobName', label: '作业名称：', border: true }));
  y += 10;
  els.push(el({ id: 'f5', type: 'field', x: 12, y, w: 186, h: 18, fieldKey: 'content', label: '作业内容：', border: true }));
  y += 20;
  els.push(el({ id: 'f6', type: 'field', x: 12, y, w: 92, h: 8, fieldKey: 'area', label: '作业区域：', border: true }));
  els.push(el({ id: 'f7', type: 'field', x: 106, y, w: 92, h: 8, fieldKey: 'location', label: '作业位置：', border: true }));
  y += 10;
  els.push(el({ id: 'f8', type: 'field', x: 12, y, w: 92, h: 8, fieldKey: 'department', label: '申请部门：', border: true }));
  els.push(el({ id: 'f9', type: 'field', x: 106, y, w: 92, h: 8, fieldKey: 'applicantName', label: '申请人：', border: true }));
  y += 10;
  els.push(el({ id: 'f10', type: 'field', x: 12, y, w: 186, h: 8, fieldKey: 'operatorNames', label: '作业人：', border: true }));
  y += 10;
  els.push(el({ id: 'f11', type: 'field', x: 12, y, w: 92, h: 8, fieldKey: 'supervisorName', label: '监护人：', border: true }));
  els.push(el({ id: 'f12', type: 'field', x: 106, y, w: 92, h: 8, fieldKey: 'supervisorContact', label: '监护人电话：', border: true }));
  y += 10;
  els.push(el({ id: 'f13', type: 'field', x: 12, y, w: 92, h: 8, fieldKey: 'contractorUnit', label: '承包商单位：', border: true }));
  els.push(el({ id: 'f14', type: 'field', x: 106, y, w: 92, h: 8, fieldKey: 'contractorHead', label: '负责人：', border: true }));
  y += 10;
  els.push(el({ id: 'f15', type: 'field', x: 12, y, w: 92, h: 8, fieldKey: 'startTime', label: '作业开始：', border: true }));
  els.push(el({ id: 'f16', type: 'field', x: 106, y, w: 92, h: 8, fieldKey: 'endTime', label: '作业结束：', border: true }));
  y += 10;
  els.push(el({ id: 'f17', type: 'field', x: 12, y, w: 92, h: 8, fieldKey: 'managementDept', label: '管理部门：', border: true }));
  els.push(el({ id: 'f18', type: 'field', x: 106, y, w: 92, h: 8, fieldKey: 'managementPerson', label: '管理责任人：', border: true }));
  y += 14;
  els.push(el({ id: 'l1', type: 'line', x: 12, y, w: 186, h: 1 }));
  y += 6;
  els.push(el({ id: 't2', type: 'text', x: 12, y, w: 60, h: 8, text: '现场签字', fontSize: 13, bold: true }));
  y += 11;
  els.push(el({ id: 's1', type: 'sign', x: 12, y, w: 92, h: 18, signRole: '申请人签字', border: true }));
  els.push(el({ id: 's2', type: 'sign', x: 106, y, w: 92, h: 18, signRole: '监护人签字', border: true }));
  y += 20;
  els.push(el({ id: 's3', type: 'sign', x: 12, y, w: 92, h: 18, signRole: '作业人签字', border: true }));
  els.push(el({ id: 's4', type: 'sign', x: 106, y, w: 92, h: 18, signRole: 'EHS/验收签字', border: true }));

  return {
    id: 'work_permit_default',
    name: '作业票 A4（默认）',
    kind: 'work_permit',
    elements: els,
    updatedAt: dayjs().toISOString(),
  };
}

// ============ 存储 ============
export async function loadTemplates(): Promise<PrintTemplate[]> {
  try {
    const { data } = await api.get(`/settings/config/${STORAGE_KEY}`);
    const raw = data?.value;
    if (raw) {
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(arr) && arr.length) {
        // 自动检测并修复旧版模板：
        //   - preset 模板：要求 h_formno 含 "D-05"（最新版）+ 危险作业需 jsaSteps 字段 + 检查栏元素 m_r*；
        //     常规作业需 brief field 带 emptyHint="（未勾选）"
        //   - 其他：交底人 h<16、logo 无 src、标题字号 <18
        const needsUpgrade = (t: PrintTemplate) => {
          if (t.id.startsWith('preset_')) {
            const fn = t.elements?.find((e) => e.id === 'h_formno');
            if (!fn || typeof fn.text !== 'string' || !fn.text.includes('D-05')) return true;
            const isHazard = !t.id.endsWith('_routine');
            if (isHazard) {
              const hasJsa = t.elements?.some((e) => e.fieldKey === 'jsaSteps');
              // 新版：措施区为动态勾选字段 checkedMeasures，不再有静态 m_b* 文本
              const hasDynamicMeasures = t.elements?.some((e) => e.fieldKey === 'checkedMeasures');
              const hasStaticMeasures = t.elements?.some((e) => (e.id || '').startsWith('m_b'));
              const hasOldCheckCol = t.elements?.some((e) => (e.id || '').startsWith('m_r'));
              if (!hasJsa || !hasDynamicMeasures || hasStaticMeasures || hasOldCheckCol) return true;
            } else {
              const briefHasHint = t.elements?.some((e) => e.fieldKey?.startsWith('brief') && !e.fieldKey.startsWith('briefBriefer') && e.emptyHint);
              if (!briefHasHint) return true;
            }
          }
          const logoEl = t.elements?.find((e) => e.id === 'h_logo');
          const hasLogoNoSrc = logoEl && (!logoEl.src || logoEl.src === '');
          const brieferSmall = t.elements?.some((e) => e.fieldKey === 'briefBrieferInternal' && e.h < 16);
          const titleSmall = (t.elements?.find((e) => e.id === 'h_title')?.fontSize || 0) < 18;
          return hasLogoNoSrc || brieferSmall || titleSmall;
        };
        if (arr.some(needsUpgrade)) {
          const presets = presetTemplates();
          const newDefault = defaultTemplate();
          // 按 id 去重：新版（preset + 新通用默认）覆盖任何旧版本
          // 同时去掉历史遗留的重复通用模板（之前累积出多个 work_permit_default）
          const map = new Map<string, PrintTemplate>();
          // 1) 用户自建模板（既非 preset_ 也非 work_permit_default）
          for (const t of arr) {
            if (!t.id.startsWith('preset_') && t.id !== 'work_permit_default') map.set(t.id, t);
          }
          // 2) 新版预设 + 新通用默认覆盖同名旧版
          for (const t of [...presets, newDefault]) map.set(t.id, t);
          const upgraded = [...map.values()];
          await saveTemplates(upgraded);
          const assign: Record<string, string> = {};
          for (const t of upgraded) if (t.workPermitType) assign[t.workPermitType] = t.id;
          await saveAssignments(assign);
          return upgraded;
        }
        return arr;
      }
    }
  } catch { /* 无记录 */ }
  // 首次（无任何模板）：自动内置 9 套预设 + 通用模板，并按作业类型建立默认关联。
  const presets = presetTemplates();
  const all = [...presets, defaultTemplate()];
  await saveTemplates(all);
  const assign: Record<string, string> = {};
  for (const t of all) {
    if (t.workPermitType) assign[t.workPermitType] = t.id;
  }
  await saveAssignments(assign);
  return all;
}

// 恢复内置预设（覆盖同名预设模板 + 重置按类型关联）；不影响用户自建模板
export async function restorePresetTemplates(): Promise<{ templates: PrintTemplate[]; assignments: Record<string, string> }> {
  const presets = presetTemplates();
  const stored = await loadTemplates();
  const next = [...stored];
  for (const p of presets) {
    const i = next.findIndex((x) => x.id === p.id);
    if (i >= 0) next[i] = p; else next.push(p);
  }
  await saveTemplates(next);
  const assign: Record<string, string> = {};
  for (const t of next) if (t.workPermitType) assign[t.workPermitType] = t.id;
  await saveAssignments(assign);
  return { templates: next, assignments: assign };
}

export async function saveTemplates(templates: PrintTemplate[]): Promise<void> {
  await api.put(`/settings/config/${STORAGE_KEY}`, { value: JSON.stringify(templates) });
}

// 加载 type→templateId 分配（默认全空）
export async function loadAssignments(): Promise<Record<string, string>> {
  try {
    const { data } = await api.get(`/settings/config/${ASSIGNMENTS_KEY}`);
    const raw = data?.value;
    if (raw) {
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (obj && typeof obj === 'object') {
        setAssignments(obj);
        return obj;
      }
    }
  } catch { /* 无记录 */ }
  return {};
}

// 保存分配
export async function saveAssignments(map: Record<string, string>): Promise<void> {
  setAssignments(map);
  await api.put(`/settings/config/${ASSIGNMENTS_KEY}`, { value: JSON.stringify(map) });
}

// 取作业票模板：按 workPermitType 精确匹配 → 通用('all' / undefined) 兜底 → 默认模板
export function pickTemplate(templates: PrintTemplate[], kind: 'work_permit' = 'work_permit', workPermitType?: string): PrintTemplate {
  const list = templates.filter((x) => x.kind === kind);
  if (workPermitType) {
    const exact = list.find((x) => x.workPermitType === workPermitType);
    if (exact) return exact;
    // 优先尝试 assignments（手动分配的模板可能没有 workPermitType 字段）
    const assignedId = (pickTemplate as any).__assignments?.[workPermitType];
    if (assignedId) {
      const assigned = list.find((x) => x.id === assignedId);
      if (assigned) return assigned;
    }
  }
  const fallback = list.find((x) => x.workPermitType === 'all' || x.workPermitType === undefined);
  return fallback || list[0] || defaultTemplate();
}

/** 取/缓存 type→templateId 分配（由 PrintView/PrintTemplatePanel 注入；进程内单例） */
export function getAssignments(): Record<string, string> {
  return (pickTemplate as any).__assignments ?? {};
}
export function setAssignments(map: Record<string, string>) {
  (pickTemplate as any).__assignments = map;
}

// 新建元素辅助
export function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

export function newElement(type: PrintElementType, x = 12, y = 12, w = 92, h = 8): PrintElement {
  const base: PrintElement = { id: uid(), type, x, y, w, h, fontSize: 12, align: 'left' };
  if (type === 'field') { base.fieldKey = PRINT_FIELDS[0].key; base.label = PRINT_FIELDS[0].label + '：'; }
  if (type === 'text') { base.text = '文本'; }
  if (type === 'sign') { base.signRole = '签字'; base.border = true; }
  if (type === 'line') { base.h = 1; base.border = true; }
  if (type === 'image') { base.h = 40; }
  if (type === 'table') {
    base.w = 186; base.h = 40;
    base.table = {
      rows: 3,
      cols: 2,
      cells: [
        ['字段一', '字段二'],
        ['{{permitNo}}', '{{typeLabel}}'],
        ['{{area}}', '{{applicantName}}'],
      ],
    };
  }
  return base;
}

// 表格单元格文本：支持 {{fieldKey}} 占位符替换为字段值
export function resolveText(tpl: string, d: any): string {
  if (!tpl) return '';
  return tpl.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_m, key) => resolveField(d, key));
}
