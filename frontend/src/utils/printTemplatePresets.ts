// 各作业类型的打印预设模板（9 套）—— 变量驱动版。
// 设计原则（按目的 + 变量字段）：
//   模板只定义"版面结构 + 字段绑定"，所有内容字段（作业内容 / 风险 / 措施 / JSA / 交底）
//   均通过 fieldKey 在打印时从作业票数据动态解析，随每次输入变化 —— 模板不是写死的。
//   目的：把"风险 + 控制措施告知正文"交到现场作业人员手中，因此版面只呈现风险与管控两类信息。
// 布局（单页 A4）：
//   页眉 → 票面 5 行 → 主要风险（派生字段）→ 安全措施落实情况（动态勾选）→
//   危险作业：JSA 步骤风险分析（每步风险定级） ／ 常规作业：现场安全交底勾选 → 现场交底人员
// 高度策略：元素 minHeight=预设 h，实际高度按内容撑开（height:auto 不截断）；
// 元素之间留 0.5~1 行（≈3mm）间隔，y 坐标按"内容行数精确估算 + 间隔"生成，避免重叠。
// 全部单页 A4（page=1）。
import revvityLogo from '@/assets/revvity-logo.png';
import type { PrintTemplate, PrintElement } from './printTemplate';

type El = PrintElement;
const FONT = 8.5; // 默认字号（最小字号：措施/交底统一 7.5pt）

function el(p: Partial<El> & { id: string }): El {
  return { fontSize: FONT, align: 'left', valign: 'top', ...p } as El;
}

// 标题与表单编号（表单编号暂不在打印文件中体现，沿用电子票号即可；如需纸质体系文件编号，后续在此补充）
const META: Record<string, { formNo: string; title: string }> = {
  hot_work:              { formNo: '', title: '危险作业许可证-动火作业' },
  high_altitude:         { formNo: '', title: '危险作业许可证-高处作业' },
  temporary_electricity: { formNo: '', title: '危险作业许可证-临时用电作业' },
  lifting:               { formNo: '', title: '危险作业许可证-起重吊装作业' },
  excavation:            { formNo: '', title: '危险作业许可证-挖掘/断路作业' },
  confined_space:        { formNo: '', title: '危险作业许可证-受限空间作业' },
  blind:                 { formNo: '', title: '危险作业许可证-盲板抽堵作业' },
  other:                 { formNo: '', title: '危险作业许可证-其他危险作业' },
  routine:               { formNo: '', title: '安全作业票-常规作业' },
};

// 顶部页眉：左 logo + 中标题（居中粗体）+ 右 表单编号/版本号（当前为空）
function permitHeader(els: El[], formNo: string, title: string): number {
  els.push(el({ id: 'h_logo', type: 'image', x: 15, y: 8, w: 22, h: 8, src: revvityLogo, align: 'left', valign: 'middle' }));
  els.push(el({ id: 'h_title', type: 'text', x: 37, y: 6, w: 115, h: 12, text: title, fontSize: 18, bold: true, align: 'center', valign: 'middle' }));
  els.push(el({ id: 'h_formno', type: 'text', x: 152, y: 6, w: 50, h: 12, text: formNo, fontSize: 7.5, align: 'right', valign: 'middle', color: '#475569' }));
  els.push(el({ id: 'h_line', type: 'line', x: 15, y: 20, w: 180, h: 1, border: true }));
  let y = 23;
  // 票面 5 行（singleLine 保证 label + value 单行显示，不换行撑高）
  els.push(el({ id: 'f_dept', type: 'field', x: 15, y, w: 90, h: 6, fieldKey: 'department', label: '申请部门：', singleLine: true }));
  els.push(el({ id: 'f_type', type: 'field', x: 109, y, w: 89, h: 6, fieldKey: 'typeLabel', label: '作业类别：', singleLine: true }));
  y += 7;
  els.push(el({ id: 'f_unit', type: 'field', x: 15, y, w: 90, h: 6, fieldKey: 'contractorUnit', label: '作业单位：', singleLine: true }));
  els.push(el({ id: 'f_loc', type: 'field', x: 109, y, w: 89, h: 6, fieldKey: 'location', label: '作业地点：', singleLine: true }));
  y += 7;
  els.push(el({ id: 'f_content', type: 'field', x: 15, y, w: 183, h: 6, fieldKey: 'content', label: '作业内容：', singleLine: true }));
  y += 7;
  els.push(el({ id: 'f_operator', type: 'field', x: 15, y, w: 90, h: 6, fieldKey: 'operatorNames', label: '直接作业人员：', singleLine: true }));
  els.push(el({ id: 'f_super', type: 'field', x: 109, y, w: 89, h: 6, fieldKey: 'supervisorName', label: '现场监护人：', singleLine: true }));
  y += 7;
  els.push(el({ id: 'f_start', type: 'field', x: 15, y, w: 90, h: 6, fieldKey: 'startTime', label: '作业开始：', singleLine: true }));
  els.push(el({ id: 'f_end', type: 'field', x: 109, y, w: 89, h: 6, fieldKey: 'endTime', label: '作业结束：', singleLine: true }));
  return y + 6;
}

// 安全措施落实情况（红字大标题 + 主要风险摘要 + 动态勾选清单）
// 主要风险与措施内容均从作业票数据动态派生（riskSummary / checkedMeasures 字段），
// 模板仅定义版面结构，内容随每次输入变化，不写死任何风险文本。
function riskAndMeasures(els: El[], startY: number): number {
  let y = startY;
  els.push(el({ id: 'l1', type: 'line', x: 15, y, w: 180, h: 1, border: true }));
  y += 4;
  els.push(el({ id: 't_risk_title', type: 'text', x: 15, y, w: 180, h: 7, text: '安全措施落实情况', fontSize: 10, bold: true, color: '#b91c1c' }));
  y += 8;
  // 主要风险：绑定派生字段 riskSummary（JSA 危害 + 已确认风险清单自动汇总）；空时给占位
  els.push(el({ id: 'f_risk', type: 'field', x: 15, y, w: 180, h: 14, fieldKey: 'riskSummary', label: '主要风险：', fontSize: 7.5, bold: true, color: '#b91c1c', emptyHint: '（未识别主要风险）' }));
  y += 16;
  // 动态勾选措施清单（最多 ~25 条 ≈ 90mm，height:auto 实际按内容撑开）
  const h = 90;
  els.push(el({ id: 'f_measures', type: 'field', x: 15, y, w: 180, h, fieldKey: 'checkedMeasures', label: '', fontSize: 7.5, emptyHint: '（未勾选措施）' }));
  y += h + 3;
  return y;
}

// JSA 步骤风险分析（青色，危险作业专用；含每步风险定级 高/中/低，仅步骤级，不评整体风险等级）
// 内容绑定字段 jsaSteps，由作业票 jsas 动态渲染，随每次输入变化。
function jsaSection(els: El[], startY: number): number {
  let y = startY;
  els.push(el({ id: 'l_jsa', type: 'line', x: 15, y, w: 180, h: 1, border: true }));
  y += 4;
  els.push(el({ id: 't_jsa_title', type: 'text', x: 15, y, w: 180, h: 7, text: 'JSA 步骤风险分析（每步风险定级）', fontSize: 10, bold: true, color: '#0e7490' }));
  y += 8;
  els.push(el({ id: 'f_jsa', type: 'field', x: 15, y, w: 180, h: 40, fieldKey: 'jsaSteps', label: '', emptyHint: '（未填写 JSA）' }));
  return y + 42;
}

// 现场安全交底勾选项（青色标题 + 4 行 brief 字段：未勾选显示「（未勾选）」灰色占位；高度按内容自适应）
function briefSection(els: El[], startY: number): number {
  let y = startY;
  els.push(el({ id: 'l_brief', type: 'line', x: 15, y, w: 180, h: 1, border: true }));
  y += 4;
  els.push(el({ id: 't_brief_title', type: 'text', x: 15, y, w: 180, h: 7, text: '现场安全交底勾选项', fontSize: 10, bold: true, color: '#0e7490' }));
  y += 8;
  const briefRows: Array<[string, string]> = [
    ['f_bh', 'briefHazards'],
    ['f_be', 'briefEnv'],
    ['f_bp', 'briefProcess'],
    ['f_bm', 'briefMeasures'],
  ];
  for (const [id, key] of briefRows) {
    const labelMap: Record<string, string> = {
      briefHazards: '涉及危险作业：',
      briefEnv: '工作环境危害因素：',
      briefProcess: '作业过程危害因素：',
      briefMeasures: '风险控制措施：',
    };
    // h=12 容纳 label + 1 行「（未勾选）」占位；如有勾选内容则按行数撑开（height:auto 不截断）
    els.push(el({ id, type: 'field', x: 15, y, w: 180, h: 12, fieldKey: key, label: labelMap[key], emptyHint: '（未勾选）' }));
    y += 13; // 字段 + 0.5~1 行间隔
  }
  return y + 2;
}

// 现场交底人员（公司内部 + 承包商负责人，并排展示）
function brieferSection(els: El[], startY: number): number {
  let y = startY;
  els.push(el({ id: 'l_briefer', type: 'line', x: 15, y, w: 180, h: 1, border: true }));
  y += 4;
  els.push(el({ id: 't_briefer_title', type: 'text', x: 15, y, w: 180, h: 7, text: '现场交底人员', fontSize: 10, bold: true }));
  y += 8;
  els.push(el({ id: 'f_bInt', type: 'field', x: 15, y, w: 88, h: 12, fieldKey: 'briefBrieferInternal', label: '公司交底人：' }));
  els.push(el({ id: 'f_bCon', type: 'field', x: 107, y, w: 88, h: 12, fieldKey: 'briefBrieferContractor', label: '承包商负责人：' }));
  return y + 14;
}

// 模板工厂（单页 A4）
//   - mode='hazard'（危险作业 8 套）：动态措施 + JSA 步骤风险分析（每步风险定级） + 交底人员
//   - mode='routine'（常规作业）：动态措施 + 现场安全交底勾选（4 项） + 交底人员
// 所有内容字段均绑定数据（fieldKey），模板仅定义版面结构，作业内容/风险/措施随每次输入变化。
function buildPermitTemplate(
  typeKey: string,
  mode: 'hazard' | 'routine' = 'hazard',
): PrintTemplate {
  const meta = META[typeKey];
  const els: El[] = [];
  let y = permitHeader(els, meta.formNo, meta.title);
  y = riskAndMeasures(els, y);
  if (mode === 'hazard') {
    y = jsaSection(els, y);
  } else {
    y = briefSection(els, y);
  }
  y = brieferSection(els, y);
  return {
    id: `preset_${typeKey}`,
    name: `${meta.title.replace('危险作业许可证-', '').replace('安全作业票-', '')}（内置预设·变量驱动）`,
    kind: 'work_permit',
    workPermitType: typeKey,
    elements: els,
    updatedAt: new Date().toISOString(),
  };
}

// ============ 9 套预设（内容全部变量驱动，无写死风险/措施文本） ============
export const WORK_PERMIT_TYPE_PRESETS: Record<string, () => PrintTemplate> = {
  hot_work:              () => buildPermitTemplate('hot_work', 'hazard'),
  high_altitude:         () => buildPermitTemplate('high_altitude', 'hazard'),
  temporary_electricity: () => buildPermitTemplate('temporary_electricity', 'hazard'),
  lifting:               () => buildPermitTemplate('lifting', 'hazard'),
  excavation:            () => buildPermitTemplate('excavation', 'hazard'),
  confined_space:        () => buildPermitTemplate('confined_space', 'hazard'),
  blind:                 () => buildPermitTemplate('blind', 'hazard'),
  other:                 () => buildPermitTemplate('other', 'hazard'),
  routine:               () => buildPermitTemplate('routine', 'routine'),
};

export function presetTemplates(): PrintTemplate[] {
  return Object.entries(WORK_PERMIT_TYPE_PRESETS).map(([, fn]) => fn());
}

export function presetByType(type: string): PrintTemplate | null {
  const fn = WORK_PERMIT_TYPE_PRESETS[type];
  return fn ? fn() : null;
}

export function presetTypeNames(): { key: string; label: string }[] {
  const labels: Record<string, string> = {
    hot_work: '动火作业', high_altitude: '高处作业', confined_space: '受限空间作业',
    lifting: '起重吊装', excavation: '动土/断路作业', temporary_electricity: '临时用电',
    blind: '盲板抽堵', other: '其他危险作业', routine: '常规作业',
  };
  return Object.keys(WORK_PERMIT_TYPE_PRESETS).map((k) => ({ key: k, label: labels[k] || k }));
}
