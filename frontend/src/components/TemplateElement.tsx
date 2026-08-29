// 模板元素渲染：始终 fill 父容器（由调用方负责 el.x/y/w/h mm 定位）。
// 编辑器中：外层父 div 用 el.x/y/w/h 定位（事件/拖拽/选中框），TemplateElement fill；
// 打印中：PrintView 用 wrapper div 用 el.x/y/w/h 定位，TemplateElement fill。
import React from 'react';
import { PrintElement, resolveField, resolveText } from '@/utils/printTemplate';

/** 编辑器预览用样例数据，让画布看到效果 */
export const SAMPLE_PERMIT: any = {
  permitNo: 'GWP-202608-0001',
  type: 'hot_work',
  status: 'printed',
  content: '设备检修、管线维护等常规作业',
  jobName: '常规检修作业',
  area: '综合楼 一楼 会议区',
  location: '3号机位',
  department: '设备动力部',
  applicantName: '李伟',
  operatorNames: ['张工', '王工'],
  supervisorName: '赵磊',
  supervisorContact: '13900000000',
  contractorUnit: 'XX工程建设有限公司',
  contractorHead: '施工负责人',
  contractorPhone: '13800000000',
  managementDept: '设备动力部',
  managementPerson: '吴磊',
  workCode: '482913',
  riskLevel: 'major',
  startTime: '2026-08-21T09:00:00',
  endTime: '2026-08-21T18:00:00',
  jsas: [
    { step: '1. 断电挂牌', hazard: '触电', control: '验电、上锁挂牌（LOTO）' },
    { step: '2. 拆装设备', hazard: '机械伤害', control: '佩戴防护手套、多人协作' },
    { step: '3. 试运行', hazard: '设备飞出', control: '设置警示区、佩戴防护眼镜' },
  ],
  application: {
    projectName: '年度检修项目',
    building: '综合楼',
    floor: '一层',
    materialsList: '密封圈、润滑油、螺栓',
    equipmentList: '电动扳手、吊带、警示带',
    expectedOperatorCount: 4,
  },
  briefing: {
    briefer: '李伟',
    briefedAt: '2026-08-21T10:30:00',
    content: '现场已确认作业区域与周边环境，措施已逐条交底确认。',
    points: [
      {
        key: 'hazard_types', title: '涉及危险作业',
        items: [
          { text: '无危险作业', checked: false },
          { text: '动火作业', checked: true },
          { text: '高处作业', checked: false },
        ],
      },
      {
        key: 'env', title: '工作环境危害因素',
        items: [
          { text: '天气因素（风雨雪雷电等）', checked: true },
          { text: '照度不足', checked: false },
          { text: '绊倒', checked: true },
        ],
      },
      {
        key: 'equip', title: '待修设备危害因素',
        items: [
          { text: '带电体裸露（触电）', checked: true },
          { text: '机械伤害（撞、割、挤压、缠绕、卷入）', checked: true },
        ],
      },
      {
        key: 'process', title: '作业过程危害因素',
        items: [
          { text: '电动工具（触电、飞出物、刺伤）', checked: true },
          { text: '物体打击（坍塌、倾倒、掉落）', checked: false },
        ],
      },
      {
        key: 'measures', title: '风险控制措施',
        items: [
          { text: '绝缘', checked: true },
          { text: '接地', checked: true },
          { text: '漏电保护', checked: true },
          { text: '安全帽', checked: true },
          { text: '防护眼镜', checked: false },
        ],
      },
      {
        key: 'tool_checks', title: '设备工具检查', mode: 'choice',
        items: [
          { text: '1.机械设备', status: 'normal' },
          { text: '2.电动设备', status: 'normal' },
          { text: '3.登高工具', status: 'normal' },
        ],
      },
    ],
  },
};

export default function TemplateElement({ el, data }: { el: PrintElement; data?: any }) {
  // 高度自适应内容：minHeight 取 el.h（占位），实际高度由内容撑开（height:auto），不截断、不锁死。
  // 元素间间隔与"不重叠"由模板 y 坐标（估算高度 + 0.5~1 行间距）保证。
  const fillStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    minHeight: el.h ? `${el.h}mm` : undefined,
    height: el.type === 'line' ? '100%' : 'auto',
    boxSizing: 'border-box',
    overflow: 'visible',
  };

  // 分隔线：fill 父容器，用上边框渲染横线（线粗由父容器高度决定）
  if (el.type === 'line') {
    return (
      <div
        style={{
          ...fillStyle,
          borderTop: `${Math.max(el.h, 0.5)}pt solid ${el.color || '#333'}`,
        }}
      />
    );
  }

  // 图片：fill 父容器，等比缩放填满
  if (el.type === 'image') {
    return el.src ? (
      <div style={{ ...fillStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img
          src={el.src}
          alt=""
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
        />
      </div>
    ) : (
      <div style={{ ...fillStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed #bbb', color: '#999', fontSize: '9pt' }}>
        图片
      </div>
    );
  }

  // 表格：fill 父容器，渲染 rows×cols 网格
  if (el.type === 'table') {
    const tb = el.table || { rows: 3, cols: 2, cells: [] };
    const rows = Math.max(1, tb.rows || 1);
    const cols = Math.max(1, tb.cols || 1);
    const cells: string[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: string[] = [];
      for (let c = 0; c < cols; c++) row.push(tb.cells?.[r]?.[c] ?? '');
      cells.push(row);
    }
    return (
      <table
        style={{
          width: '100%',
          height: '100%',
          borderCollapse: 'collapse',
          fontSize: `${el.fontSize}pt`,
          color: el.color || '#111',
          textAlign: el.align || 'left',
          tableLayout: 'fixed',
        }}
      >
        <tbody>
          {cells.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td
                  key={c}
                  style={{
                    border: '0.3pt solid #999',
                    padding: '0.5mm 1mm',
                    fontWeight: el.bold ? 700 : 400,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    overflow: 'hidden',
                  }}
                >
                  {resolveText(cell, data)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  const baseStyle: React.CSSProperties = {
    ...fillStyle,
    fontSize: `${el.fontSize}pt`,
    fontWeight: el.bold ? 700 : 400,
    color: el.color || '#111',
    textAlign: el.align || 'left',
    lineHeight: 1.4,
    display: 'flex',
    alignItems:
      el.valign === 'middle' ? 'center'
      : el.valign === 'bottom' ? 'flex-end'
      : 'flex-start',
    gap: '1mm',
    padding: '0 1mm',
    overflow: 'visible', // 高度自适应（不锁死）：让 text/field 内容撑开元素
    border: el.border ? '0.3pt solid #999' : 'none',
  };

  // 签字框：左侧角色名 + 右侧手写区
  if (el.type === 'sign') {
    return (
      <div style={baseStyle}>
        <span style={{ whiteSpace: 'nowrap', flexShrink: 0, fontSize: `${Math.max(el.fontSize - 2, 8)}pt` }}>
          {el.signRole || '签字'}
        </span>
        <span style={{ flex: 1 }} />
      </div>
    );
  }

  // value 为空时规则：
  //   - 交底人员字段（briefBriefer 前缀）：保留 label 显示（让工人知道此处应有该人员）
  //   - 字段设置了 emptyHint：保留 label + 显示灰色占位文字（如交底勾选未选时显示"（未勾选）"）
  //   - 其他：整个不渲染（避免显示空 label）
  const label = el.type === 'field' ? el.label || '' : '';
  const value =
    el.type === 'field' ? resolveField(data, el.fieldKey || '') : el.type === 'text' ? el.text || '' : '';
  const isBriefPersonField = el.type === 'field' && (el.fieldKey || '').startsWith('briefBriefer');
  const isEmpty = value === '' || value === undefined || value === null;
  if (isEmpty && !(label && (isBriefPersonField || el.emptyHint)) && !el.always) {
    return null;
  }
  // 单行 row 布局：label 与 value 同行；容器固定 el.h（不撑开），value 换行超出的部分被 overflow:hidden 截断。
  const containerStyle: React.CSSProperties = {
    ...baseStyle,
    flexDirection: 'row',
    alignItems:
      el.valign === 'top' ? 'flex-start'
      : el.valign === 'bottom' ? 'flex-end'
      : 'center',
    textAlign: el.align || 'left',
  };
  const valueStyle: React.CSSProperties = el.singleLine
    ? { flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.35 }
    : { flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'break-word', lineHeight: 1.35 };
  const emptyHintStyle: React.CSSProperties = { ...valueStyle, color: '#94a3b8', fontStyle: 'italic' };
  return (
    <div style={containerStyle}>
      {label && (
        <span style={{ fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}>{label}</span>
      )}
      {isEmpty && el.emptyHint ? (
        <span style={emptyHintStyle}>{el.emptyHint}</span>
      ) : (value !== '' && value !== undefined && value !== null && (
        <span style={valueStyle}>{value}</span>
      ))}
    </div>
  );
}
