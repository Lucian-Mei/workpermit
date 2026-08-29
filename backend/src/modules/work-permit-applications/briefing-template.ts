// 现场安全交底预设勾选项（依据作业申请单交底清单）
// 由承包商管理部门和承包商共同在现场逐条勾选确认；无需 AI 生成。
export interface BriefItem {
  text: string;
  checked?: boolean;
  status?: 'normal' | 'abnormal'; // 仅 mode==='choice' 使用
}

export interface BriefGroup {
  key: string;
  title: string;
  mode?: 'check' | 'choice'; // choice=正常/异常二选一
  items: BriefItem[];
}

export const BRIEFING_GROUPS: BriefGroup[] = [
  {
    key: 'hazard_types',
    title: '一、作业中存在的危害和潜在事故后果（风险）·本次涉及的危险作业',
    mode: 'check',
    items: [
      '无危险作业',
      '动火作业',
      '临时用电',
      '高空作业',
      '吊装作业',
      '挖掘作业',
      '断路作业',
      '受限空间',
      '其它经评估为危险作业（如涉及以上危险作业，需另外办理《危险作业许可证》）',
    ].map((text) => ({ text, checked: false })),
  },
  {
    key: 'env',
    title: '二、工作环境危害因素',
    mode: 'check',
    items: [
      '天气因素（风雨雪雷电等）',
      '生物危害（虫蛇等）',
      '附近存放化学品',
      '交叉作业',
      '照度不足',
      '通道不顺畅',
      '绊倒',
      '滑倒',
      '行走失衡（沟槽、台阶、上下站立面落差大）',
      '净高不足',
      '空间狭窄',
      '其它：',
    ].map((text) => ({ text, checked: false })),
  },
  {
    key: 'equip',
    title: '三、待修设备、设施的危害因素',
    mode: 'check',
    items: [
      '设备储存的能量和压力',
      '有害物质',
      '机械伤害（撞、割、挤压、缠绕、卷入）',
      '高温烫伤',
      '低温冻伤',
      '带电体裸露（触电）',
      '登高操作',
      '站立不稳',
      '姿势受限',
      '尖角利边',
      '拆装的部件不利抓握',
      '重量危害',
      '其它：',
    ].map((text) => ({ text, checked: false })),
  },
  {
    key: 'process',
    title: '四、作业过程的危害因素',
    mode: 'check',
    items: [
      '人工搬运（挤压、划伤）',
      '机械伤害',
      '电动工具（触电、飞出物、刺伤）',
      '手动工具（砸伤、割伤、擦伤）',
      '使用登高工具',
      '使用高压水枪或气体',
      '电气操作（线路接驳、设备安装、检修）',
      '切割、打磨（飞屑、断裂物飞出）',
      '物体打击（坍塌、倾倒、掉落）',
      '用力过猛或工具使用不当，导致身体失衡、坠落',
      '噪声',
      '使用化学品（毒害、腐蚀、易燃）',
      '其它：',
    ].map((text) => ({ text, checked: false })),
  },
  {
    key: 'measures',
    title: '五、风险控制措施',
    mode: 'check',
    items: [
      '防风、雨、高温、雪、结冰的措施',
      '环境通风',
      '移走（或保护）危险物品及其它受影响物品',
      '腾出作业区域',
      '把作业区与非作业区隔开（关上门、设立警示带）',
      '与受影响方沟通危害',
      '警示标识',
      '增加照明',
      '保持通道畅通',
      '整理整洁',
      '地面平整',
      '小心脚下',
      '排净管线、容器',
      '能源隔离',
      '上锁、挂牌（LOTO）',
      '辅助站稳',
      '登高工具牢靠栓固',
      '轻拿轻放',
      '避免用力过猛',
      '降低噪声影响',
      '使用机械代替人力搬运',
      '多人合作，步调一致',
      '物品摆放稳固，朝向正确',
      '绝缘',
      '接地',
      '漏电保护',
      '安全防护罩',
      '设备安全连锁',
      'MSDS',
      '安全标签',
      '用容器收集有害物质',
      '容器密闭',
      '泄漏预防',
      '防止有害（气味）扩散到生产、办公区',
      '应急冲淋设施',
      '废弃物分类收集、定点存放',
      '安全帽',
      '防砸鞋',
      '防护眼镜',
      '长袖长裤',
      '防护手套',
      '口罩',
      '防冲击面屏',
      '其它：',
    ].map((text) => ({ text, checked: false })),
  },
  {
    key: 'tool_checks',
    title: '六、设备、工具检查结果',
    mode: 'choice',
    items: [
      { text: '1.机械设备', status: 'normal' },
      { text: '2.电动设备', status: 'normal' },
      { text: '3.登高工具', status: 'normal' },
      { text: '4.管线、容器', status: 'normal' },
      { text: '5.其它：', status: 'normal' },
    ],
  },
];

// 返回一份全新的预设（每项未勾选），供前端「载入预设交底清单」调用
export function buildBriefingTemplate(): BriefGroup[] {
  return JSON.parse(JSON.stringify(BRIEFING_GROUPS));
}
