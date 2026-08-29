/* eslint-disable */
/**
 * 模拟 213 份电子化作业票申请（work_permit_applications, channel='electronic'）
 * 覆盖 9 种作业类型、11 种状态，均匀分布。
 *
 * 运行方式：cd backend && node scripts/seed-epermits-213.cjs
 * 前提：后端已停止（释放 PGlite 目录锁）
 * 幂等：重跑前先删除 SIM213- 前缀数据
 */

// 必须在 require 任何模块之前加载 .env（与后端 @nestjs/config 行为一致）
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const DATA_DIR = path.resolve(__dirname, '..', '.pglite-data-v3');

// ---------- 工具 ----------
const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const daysAgoISO = (n) => new Date(Date.now() - n * 86400000).toISOString();
const addDaysISO = (iso, n) => new Date(new Date(iso).getTime() + n * 86400000).toISOString();
function weightedPick(w) {
  const entries = Object.entries(w);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let r = Math.random() * total;
  for (const [k, v] of entries) { if ((r -= v) < 0) return k; }
  return entries[entries.length - 1][0];
}

// ---------- 内容池 ----------
const AREAS = ['一号厂房冲压区','二号厂房装配区','危化品专用库','成品立体仓库','综合楼报告厅','厂东物流主通道','高压配电室','锅炉房泵房区','分子楼红区实验室','试剂楼PCR实验室','仪器楼生产区','厂前区充电站'];
const LOCATIONS = ['北侧消防通道','1#配电柜','冲压线','检修平台','乙醇暂存区','喷涂区','货架区','设备端子','变压器室','临边','焊机区','通风机房','登高梯','控制柜','吊板','压力表','常温库','冷库','办公区'];
const DEPTS = ['生产一部','生产二部','机修保障部','物流配送部','安环监察部','质检管控部','研发中心','基建工程部','行政人事部','承包商管理部'];
const OPERATORS = ['赵敏','周强','孙丽','吴军','郑涛','何星','李娜','董磊','王强','刘敏','陈浩','杨雪'];
const SUPERVISORS = ['王刚','李伟','薛梅','杨帆','郭华','刘洋'];
const REVIEWERS = ['张主任','李主管','王科长'];
const APPROVERS = ['赵经理','钱总监','孙厂长'];

const WP_TYPES = [
  { key: 'hot_work',              label: '动火作业',       hazardous: true,  items: ['焊接不锈钢支架，使用乙炔氧气焰，作业前须清理周边易燃包装物并配备灭火器材。','切割更换蒸汽管道，使用乙炔焰，作业前完成管线隔离与泄压确认。','罐区法兰动火修补，使用电弧焊，须气体检测合格并设接火盘。'] },
  { key: 'high_altitude',         label: '高处作业',       hazardous: true,  items: ['厂房屋面防水施工，登高约4米，沿临边搭设生命线并使用双钩安全带。','外墙玻璃清洗，登高约6米，使用吊篮并检查配重与锁止装置。','管廊支架安装，登高约5米，使用移动式升降平台。'] },
  { key: 'confined_space',        label: '受限空间作业',   hazardous: true,  items: ['乙醇储罐内部清污作业，需持续气体检测与强制通风，办理受限空间进入许可。','电缆沟内接线作业，需通风检测并设专职监护人。','反应釜内部防腐，须置换合格并连续监测有毒气体。'] },
  { key: 'lifting',               label: '起重吊装作业',   hazardous: true,  items: ['吊装大型模具入位，使用5吨行车，设吊装警戒区与指挥。','叉车配合吊装货架，使用3吨叉车，落实绑扎与试吊。','设备整机吊装就位，使用汽车吊，办理占道许可。'] },
  { key: 'excavation',            label: '动土作业',       hazardous: false, items: ['开挖电缆沟，深度约0.8米，须查明地下管线并设边坡。','厂区管沟开挖，深度约1.2米，临近道路须设硬隔离。','基础基坑开挖，深度约2米，落实支护与降水。'] },
  { key: 'temporary_electricity', label: '临时用电',       hazardous: false, items: ['临时照明配电，含移动配电箱，须装漏保并日检。','设备调试临时接电，含一机一闸一漏保。','夜间施工临时供电，配电箱防雨接地可靠。'] },
  { key: 'blind',                 label: '盲板抽堵作业',   hazardous: true,  items: ['管廊盲板抽堵作业，须按盲板图逐一确认并挂牌。','反应釜盲板抽堵，介质为有机溶剂，须置换分析合格。','罐区盲板加装，须上锁挂签并双人确认。'] },
  { key: 'road_breaking',         label: '断路作业',       hazardous: false, items: ['厂区东门道路开挖铺设管道，须设交通导向牌与硬隔离。','物流通道路面修复，须分时段施工并设引导员。'] },
  { key: 'other',                 label: '其他作业',       hazardous: false, items: ['实验室设备移位与重新定位，须断电挂牌并设指挥。','平台检修搭设脚手架，须验收合格挂牌使用。','厂内运输大件物资，须规划路线并设引导。'] },
];

// 状态分布（权重），合计 213
const STATUS_WEIGHTS = {
  draft:          20,  // 草稿
  pending_review: 22,  // 待审核
  reviewing:      22,  // 审批中
  approved:       20,  // 已批准
  printed:        18,  // 执行中
  paused:          8,  // 已暂停
  finished:       20,  // 完工待归档
  completed:      25,  // 已归档
  voided:         12,  // 已作废
  rejected:       10,  // 已驳回
  ehs_reviewing:   6,  // 待EHS审批
};
// 总权重 = 183... 需要调整为 213
// draft:20 + pending_review:22 + reviewing:22 + approved:20 + printed:18 + paused:8 + finished:20 + completed:25 + voided:12 + rejected:10 + ehs_reviewing:6 = 183
// 差 30，补到几个中间状态
// 修正：draft:25, pending_review:25, reviewing:25, approved:22, printed:20, paused:10, finished:22, completed:28, voided:14, rejected:12, ehs_reviewing:10 = 213
const STATUS_W = {
  draft:          25,
  pending_review: 25,
  reviewing:      25,
  approved:       22,
  printed:        20,
  paused:         10,
  finished:       22,
  completed:      28,
  voided:         14,
  rejected:       12,
  ehs_reviewing:   10,
};

// 生成固定分布（而非随机），确保每类型和每状态都有覆盖
function buildPlan(total) {
  const types = WP_TYPES.map(t => t.key);
  const statuses = Object.keys(STATUS_W);
  const plan = [];
  let seq = 0;
  // 先确保每个 (type, status) 组合至少 1 条（9 * 11 = 99）
  for (const type of types) {
    for (const status of statuses) {
      seq++;
      plan.push({ seq, type, status, isHazardous: WP_TYPES.find(t => t.key === type).hazardous });
    }
  }
  // 剩余 213 - 99 = 114 条按权重分配
  const remaining = total - plan.length;
  for (let i = 0; i < remaining; i++) {
    const status = weightedPick(STATUS_W);
    const type = pick(types);
    seq++;
    plan.push({ seq, type, status, isHazardous: WP_TYPES.find(t => t.key === type).hazardous });
  }
  return plan;
}

// ---------- 构造行 ----------
function buildApp(item, userId, userName, dept, area) {
  const meta = WP_TYPES.find(t => t.key === item.type);
  const status = item.status;
  const created = daysAgoISO(rnd(0, 60));
  const planStart = addDaysISO(created, rnd(0, 5));
  const planEnd = addDaysISO(planStart, rnd(1, 3));
  const operators = Array.from(new Set([pick(OPERATORS), pick(OPERATORS)]));
  const supervisor = pick(SUPERVISORS);
  const reviewer = pick(REVIEWERS);
  const approver = pick(APPROVERS);

  const row = {
    permit_no: `SIM213-EP-${String(item.seq).padStart(4, '0')}`,
    channel: 'electronic',
    applicant_id: userId,
    applicant_name: userName,
    department: dept,
    area: area,
    location: pick(LOCATIONS),
    job_name: `${area}·${meta.label}作业`,
    content: pick(meta.items),
    plan_start: planStart,
    plan_end: planEnd,
    operator_names: JSON.stringify(operators),
    supervisor_name: supervisor,
    supervisor_contact: `138${String(rnd(10000000, 99999999))}`,
    operator_contact: `139${String(rnd(10000000, 99999999))}`,
    involves_hazardous: item.isHazardous,
    training_id: null,
    status: status,
    reviewer_id: null,
    reviewer_name: null,
    review_opinion: null,
    reviewed_at: null,
    approver_id: null,
    approver_name: null,
    approval_opinion: null,
    approved_at: null,
    print_count: 0,
    printed_at: null,
    finished_at: null,
    archived_at: null,
    paused_at: null,
    paused_by: null,
    paused_by_name: null,
    pause_reason: null,
    voided_at: null,
    voided_by: null,
    voided_by_name: null,
    void_reason: null,
    daily_override: null,
    created_at: created,
    updated_at: created,
  };

  // 待审核及以上：有审核人
  if (['pending_review','ehs_reviewing','reviewing','approved','rejected','printed','paused','finished','completed','voided'].includes(status)) {
    row.reviewer_id = userId; // 简化：用同一用户
    row.reviewer_name = reviewer;
    row.review_opinion = status === 'rejected'
      ? pick(['作业方案安全措施不充分，退回重新编制。','未提供有效盲板位置图，退回补充。','监护人配置不足，退回后重新申报。','气体检测数据不完整，退回复检。'])
      : '安全措施与作业方案审核合格，同意进入下一环节。';
    row.reviewed_at = addDaysISO(created, 1);
  }

  // 审批中及以上（非驳回）：有审批人
  if (['reviewing','approved','printed','paused','finished','completed','voided'].includes(status)) {
    row.approver_id = userId;
    row.approver_name = approver;
    row.approval_opinion = '批准作业，须严格执行作业票安全措施。';
    row.approved_at = addDaysISO(created, 2);
  }

  // 执行中
  if (status === 'printed') {
    row.print_count = rnd(1, 3);
    row.printed_at = addDaysISO(created, 2);
  }

  // 已暂停
  if (status === 'paused') {
    row.print_count = rnd(1, 3);
    row.printed_at = addDaysISO(created, 2);
    row.paused_at = addDaysISO(created, 3);
    row.paused_by = userId;
    row.paused_by_name = reviewer;
    row.pause_reason = pick(['现场风力超过5级，暂停作业待条件恢复。','监护人临时离开，暂停作业。','设备故障需排查，暂停作业。']);
  }

  // 完工待归档
  if (status === 'finished') {
    row.print_count = rnd(1, 3);
    row.printed_at = addDaysISO(created, 2);
    row.finished_at = addDaysISO(created, 3);
  }

  // 已归档
  if (status === 'completed') {
    row.print_count = rnd(1, 3);
    row.printed_at = addDaysISO(created, 2);
    row.finished_at = addDaysISO(created, 3);
    row.archived_at = addDaysISO(created, 4);
  }

  // 已作废
  if (status === 'voided') {
    row.voided_at = addDaysISO(created, 1);
    row.voided_by = userId;
    row.voided_by_name = reviewer;
    row.void_reason = pick(['作业计划取消，申请单作废。','项目延期，暂不需要作业。','重复申请，合并至其他单据。']);
  }

  return row;
}

// 关联危险作业票（仅 involvesHazardous=true 且状态 >= approved 时创建）
function buildPermit(app, item, userId, userName, dept, area) {
  const meta = WP_TYPES.find(t => t.key === item.type);
  const created = daysAgoISO(rnd(0, 50));
  const operators = JSON.parse(app.operator_names);

  const row = {
    permit_no: `SIM213-WP-${String(item.seq).padStart(4, '0')}`,
    type: item.type,
    is_hazardous: true,
    channel: 'electronic',
    application_id: app.id || null,
    area: area,
    location: app.location,
    start_time: app.plan_start,
    end_time: app.plan_end,
    applicant_id: userId,
    applicant_name: userName,
    department: dept,
    operator_names: JSON.stringify(operators),
    supervisor_name: app.supervisor_name,
    supervisor_contact: app.supervisor_contact,
    content: app.content,
    ai_risk_analysis: '',
    safety_measures: JSON.stringify(['配备灭火器材','设专职监护人','作业前气体检测合格','清理周边易燃物']),
    jsas: JSON.stringify([{step:'作业准备',hazard:'易燃物未清理',control:'清理半径10米内易燃物'},{step:'作业执行',hazard:'火花飞溅',control:'设接火盘和防火毯'}]),
    ai_review_analysis: '',
    measure_selections: JSON.stringify([]),
    status: 'approved',
    reviewer_id: userId,
    reviewer_name: pick(REVIEWERS),
    review_opinion: '危险作业票审核合格。',
    reviewed_at: addDaysISO(created, 1),
    ehs_approver_id: userId,
    ehs_approver_name: pick(['陈工EHS','刘工EHS','张工EHS']),
    ehs_approval_opinion: 'EHS审批通过，安全措施充分。',
    ehs_approved_at: addDaysISO(created, 1),
    approver_id: userId,
    approver_name: pick(APPROVERS),
    approval_opinion: '批准作业。',
    approved_at: addDaysISO(created, 2),
    print_count: rnd(1,2),
    qr_code: null,
    printed_at: app.printed_at,
    finished_at: app.finished_at,
    archived_at: app.archived_at,
    signatures: JSON.stringify([]),
    paused_at: app.paused_at,
    paused_by: app.paused_by,
    paused_by_name: app.paused_by_name,
    pause_reason: app.pause_reason,
    voided_at: app.voided_at,
    voided_by: app.voided_by,
    voided_by_name: app.voided_by_name,
    void_reason: app.void_reason,
    daily_override: null,
    created_at: created,
    updated_at: created,
  };

  // 同步状态
  if (app.status === 'printed') row.status = 'printed';
  if (app.status === 'paused') row.status = 'paused';
  if (app.status === 'finished') row.status = 'finished';
  if (app.status === 'completed') row.status = 'completed';
  if (app.status === 'voided') row.status = 'voided';

  return row;
}

// ---------- 插入工具 ----------
async function insertReturning(db, table, row, jsonbCols, returning) {
  const cols = Object.keys(row);
  const params = cols.map((k) => row[k]);
  const ph = cols.map((k, i) => (jsonbCols && jsonbCols.has(k) ? `$${i + 1}::jsonb` : `$${i + 1}`));
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph.join(',')}) RETURNING ${returning}`;
  const r = await db.query(sql, params);
  return r.rows[0];
}

// ---------- 主流程 ----------
async function main() {
  console.log('打开 PGlite 数据目录:', DATA_DIR);
  const db = await PGlite.create({ dataDir: DATA_DIR });

  // 获取已有用户
  const { rows: users } = await db.query("SELECT id, name, department FROM users WHERE status='active' ORDER BY created_at");
  if (!users.length) {
    console.error('数据库中无活跃用户，无法模拟。请先初始化基础数据。');
    await db.close();
    process.exit(1);
  }
  console.log(`可用用户 ${users.length} 个`);

  // 幂等清理
  await db.query("DELETE FROM work_permits WHERE permit_no LIKE 'SIM213-%'");
  await db.query("DELETE FROM work_permit_applications WHERE permit_no LIKE 'SIM213-%'");
  console.log('已清理上一批 SIM213 数据');

  // 检查 work_permit_applications 表是否有 channel 列
  const { rows: cols } = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'work_permit_applications' AND column_name = 'channel'
  `);
  const hasChannel = cols.length > 0;
  if (!hasChannel) {
    console.warn('⚠️ work_permit_applications 表缺少 channel 列！将不写入 channel 字段。');
  }

  // 检查 work_permit_applications 表是否有所有必要列
  const { rows: appCols } = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'work_permit_applications'
    ORDER BY ordinal_position
  `);
  const appColNames = appCols.map(c => c.column_name);
  console.log('work_permit_applications 列:', appColNames.join(', '));

  // 检查 work_permits 表是否有所有必要列
  const { rows: wpCols } = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'work_permits'
    ORDER BY ordinal_position
  `);
  const wpColNames = wpCols.map(c => c.column_name);
  console.log('work_permits 列:', wpColNames.join(', '));

  // 生成 213 条计划
  const plan = buildPlan(213);
  console.log(`\n生成计划：${plan.length} 条`);

  // 统计分布
  const typeDist = {};
  const statusDist = {};
  plan.forEach(p => {
    typeDist[p.type] = (typeDist[p.type] || 0) + 1;
    statusDist[p.status] = (statusDist[p.status] || 0) + 1;
  });
  console.log('类型分布:', JSON.stringify(typeDist, null, 2));
  console.log('状态分布:', JSON.stringify(statusDist, null, 2));

  const jsonbApp = new Set(['operator_names']);
  const jsonbWp = new Set(['operator_names', 'safety_measures', 'jsas', 'measure_selections', 'signatures']);

  let appCount = 0;
  let wpCount = 0;
  const issues = [];

  for (const item of plan) {
    const user = pick(users);
    const dept = user.department || pick(DEPTS);
    const area = pick(AREAS);

    // 过滤掉表中不存在的列
    const appRow = buildApp(item, user.id, user.name, dept, area);
    const filteredAppRow = {};
    for (const [k, v] of Object.entries(appRow)) {
      if (appColNames.includes(k)) filteredAppRow[k] = v;
      else if (k === 'channel' && !hasChannel) {
        issues.push(`[#${item.seq}] channel 列不存在，已跳过`);
      }
    }

    try {
      const ins = await insertReturning(db, 'work_permit_applications', filteredAppRow, jsonbApp, 'id, permit_no, status');
      appCount++;

      // 对涉及危险作业且状态 >= approved 的，创建关联 work_permits
      if (item.isHazardous && ['approved','printed','paused','finished','completed','voided'].includes(item.status)) {
        const wpRow = buildPermit(ins, item, user.id, user.name, dept, area);
        const filteredWpRow = {};
        for (const [k, v] of Object.entries(wpRow)) {
          if (wpColNames.includes(k)) filteredWpRow[k] = v;
          else {
            issues.push(`[#${item.seq}] work_permits 表缺少列 ${k}，已跳过该字段`);
          }
        }
        try {
          await insertReturning(db, 'work_permits', filteredWpRow, jsonbWp, 'id, permit_no');
          wpCount++;
        } catch (e) {
          issues.push(`[#${item.seq}] work_permits 插入失败: ${e.message}`);
        }
      }
    } catch (e) {
      issues.push(`[#${item.seq}] work_permit_applications 插入失败: ${e.message}`);
    }
  }

  await db.close();

  console.log('\n========== 模拟完成 ==========');
  console.log(`作业申请单 (work_permit_applications): ${appCount} 条`);
  console.log(`关联危险作业票 (work_permits): ${wpCount} 条`);
  if (issues.length > 0) {
    console.log(`\n⚠️ 发现 ${issues.length} 个问题：`);
    issues.forEach((iss, i) => console.log(`  ${i + 1}. ${iss}`));
  } else {
    console.log('\n✅ 无问题');
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('脚本失败:', e);
  process.exit(1);
});
