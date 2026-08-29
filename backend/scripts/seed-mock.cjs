/* eslint-disable */
/**
 * 模拟数据种子脚本（部门 / 员工 / 区域 + 隐患 250 + 作业票 250，按状态随机停留）
 * 运行方式（在 backend 目录下，且后端已停止、释放 PGlite 目录锁时）：
 *   node scripts/seed-mock.cjs
 * 说明：
 *  - 直接复用后端同一份 PGlite 数据目录（.pglite-data-v3），与后端完全一致的 @electric-sql/pglite 版本。
 *  - 仅插入以 MOCK- 单号 / mock_ 用户名 / abbreviation='MOCK' / code='MOCK' 为标记的记录，
 *    重跑时先 DELETE 同类标记数据，幂等安全，不影响既有演示数据（admin 等账号）。
 *  - 外键约束：users 删除级联 department_managers / user_roles；hazards / work_permits 的
 *    submitter/assignee/applicant 等外键为 ON DELETE SET NULL，故即便清理也不破坏其他数据。
 *  - jsonb 字段以 ::jsonb 显式转换插入；密码用 bcryptjs 哈希（Mock@123456，首次登录强制改密）。
 */
const path = require('path');
const bcrypt = require('bcryptjs');
const { PGlite } = require('@electric-sql/pglite');

const DATA_DIR = path.resolve(__dirname, '..', '.pglite-data-v3');
const MOCK_PWD = 'Mock@123456';
const MOCK_HASH = bcrypt.hashSync(MOCK_PWD, 10);

// ---------------- 工具 ----------------
const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const daysAgoISO = (n) => new Date(Date.now() - n * 86400000).toISOString();
const addDaysISO = (iso, n) => new Date(new Date(iso).getTime() + n * 86400000).toISOString();

// 加权随机：w = {key: weight}
function weightedPick(w) {
  const entries = Object.entries(w);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let r = Math.random() * total;
  for (const [k, v] of entries) {
    if ((r -= v) < 0) return k;
  }
  return entries[entries.length - 1][0];
}

// ---------------- 内容池（真实中文 EHS 场景）----------------
const BUILDINGS = ['一号厂房', '二号厂房', '原料库', '成品库', '综合楼', '厂区道路', '配电室', '锅炉房', '分子楼', '试剂楼', '仪器楼'];
const FLOORS = ['一层', '二层', '三层', '屋面', '—', '楼梯', '楼顶'];
const LOCATIONS = ['北侧消防通道', '1#配电柜', '冲压线', '检修平台', '乙醇暂存区', '喷涂区', '货架区', '设备端子', '变压器室', '临边', '焊机区', '通风机房', '登高梯', '控制柜', '吊板', '压力表', '常温库', '冷库', '办公区'];
const RISKS = ['normal', 'major', 'critical'];
const OPERATORS = ['赵敏', '周强', '孙丽', '吴军', '郑涛', '何星', '李娜', '董磊', '王强', '刘敏', '陈浩', '杨雪'];
const SUPERVISORS = ['王刚', '李伟', '薛梅', '杨帆', '郭华', '刘洋'];

// 部门池（MOCK 标记写入 abbreviation 列，便于幂等清理，UI 显示的 name 保持真实）
// 注意：库中可能已存在真实部门（如“设备动力部”），故插入前先按 name 查重，已存在则复用，避免唯一约束冲突。
const DEPT_DEFS = [
  { name: '生产一部', rp: '王建国', coord: '李红', phone: '13901000001', desc: '负责一号、二号厂房生产线日常安全与隐患排查。' },
  { name: '生产二部', rp: '赵立军', coord: '孙倩', phone: '13901000002', desc: '负责精密装配与调试区域的安全生产管理。' },
  { name: '机修保障部', rp: '陈志强', coord: '周敏', phone: '13901000003', desc: '负责全厂设备、电气、公用动力系统的检维修安全。' },
  { name: '物流配送部', rp: '刘海涛', coord: '吴静', phone: '13901000004', desc: '负责原料、成品仓储及厂内物流运输安全。' },
  { name: '安环监察部', rp: '杨帆', coord: '何琳', phone: '13901000005', desc: '统筹全厂安全环保体系、隐患治理与作业票审批。' },
  { name: '质检管控部', rp: '黄文斌', coord: '郑爽', phone: '13901000006', desc: '负责质量体系与现场 5S、职业健康相关管理。' },
  { name: '研发中心', rp: '林志远', coord: '王雪', phone: '13901000007', desc: '负责实验室研发区域危化品与受限空间作业安全。' },
  { name: '基建工程部', rp: '高建军', coord: '马丽', phone: '13901000008', desc: '负责厂内改扩建、动土与吊装等施工安全。' },
  { name: '行政人事部', rp: '郭涛', coord: '朱琳', phone: '13901000009', desc: '负责行政后勤、消防与交通安全综合事务。' },
  { name: '承包商管理部', rp: '罗伟', coord: '胡月', phone: '13901000010', desc: '负责外来承包商入场培训、资质与作业过程监管。' },
];

// 区域池（MOCK 标记写入 code 列；名称刻意避开库中既有真实区域，插入前仍查重以确保幂等）
const AREA_DEFS = [
  { name: '一号厂房冲压区', building: '一号厂房', floor: '一层', rd: '生产一部', desc: '冲压、焊接、装配主产线区域。' },
  { name: '二号厂房装配区', building: '二号厂房', floor: '二层', rd: '生产二部', desc: '精密装配与调试区域。' },
  { name: '危化品专用库', building: '原料库', floor: '一层', rd: '物流配送部', desc: '危化品与非危化品分区暂存区。' },
  { name: '成品立体仓库', building: '成品库', floor: '一层', rd: '物流配送部', desc: '成品码放与出入库通道区域。' },
  { name: '综合楼报告厅', building: '综合楼', floor: '三层', rd: '行政人事部', desc: '办公、会议与档案区域。' },
  { name: '厂东物流主通道', building: '厂区道路', floor: '—', rd: '物流配送部', desc: '厂内主运输通道与装卸平台。' },
  { name: '高压配电室', building: '配电室', floor: '一层', rd: '机修保障部', desc: '10kV 变配电与应急电源区域。' },
  { name: '锅炉房泵房区', building: '锅炉房', floor: '一层', rd: '机修保障部', desc: '蒸汽锅炉及附属压力管道区域。' },
  { name: '分子楼红区实验室', building: '分子楼', floor: '三层', rd: '研发中心', desc: '涉及危化品与加热反应的高风险实验区。' },
  { name: '试剂楼PCR实验室', building: '试剂楼', floor: '二层', rd: '研发中心', desc: '生物安全与试剂配制区域。' },
  { name: '仪器楼生产区', building: '仪器楼', floor: '三层', rd: '生产二部', desc: '仪器装配、校准与老化测试区域。' },
  { name: '厂前区充电站', building: '综合楼', floor: '屋面', rd: '行政人事部', desc: '员工停车与车辆充电区域。' },
];

// 姓名池（员工）
const SURNAMES = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '高', '林', '罗', '郑', '谢', '韩', '唐'];
const GIVEN = ['伟', '芳', '娜', '敏', '静', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '霞', '平', '刚', '桂英', '建华', '志强', '丽华', '晓东', '春梅'];

const HAZARD_CONTENT = {
  消防安全: {
    desc: ['车间消防通道被物料托盘占用，有效宽度不足 1 米，违反疏散通道要求。', '灭火器箱被设备遮挡，取用不便且存在探测盲区。', '疏散指示标志部分不亮，应急指引缺失。', '防火卷帘下方堆放杂物，影响降落隔离。', '消防栓箱体锈蚀无法开启，周边堆放杂物。'],
    act: ['立即清空通道并画线标识，纳入每日点检。', '迁移灭火器箱至通道口并张贴醒目标识。', '更换损坏灯具并落实月度测试卡。', '清理卷帘下方物品，保持净空高度。', '除锈保养消防栓，清理周边恢复取用空间。'],
  },
  用电安全: {
    desc: ['配电柜上方桥架线缆绝缘层老化龟裂，存在短路起火风险。', '临时插座线路私拉，负荷过载发热明显。', '设备接地端子松动，外壳存在带电隐患。', '配电室挡鼠板高度不足，鼠害引发短路风险。', '移动配电箱未装漏电保护，雨天作业危险。'],
    act: ['更换破损线缆，加装线槽并做绝缘检测。', '拆除临时线路，按规范重新布线并加装漏保。', '重新压接并复测接地电阻至合格。', '加高挡鼠板至 60cm 并封堵管线孔洞。', '补装额定漏保并做动作试验。'],
  },
  机械设备: {
    desc: ['冲压设备急停按钮被周转箱遮挡，无法快速拍停。', '传送带防护网松动，存在肢体卷入风险。', '机械防护罩拆除后仅临时绑扎未恢复固定。', '砂轮机体裂纹未报废，继续使用有崩裂风险。', '叉车制动系统响应迟缓，厂内运输隐患。'],
    act: ['急停按钮加装防护罩并重新标识醒目位置。', '紧固并加固防护网固定点，每日班前检查。', '恢复为固定式防护罩并点检确认。', '立即停用并报废裂纹砂轮，配置合格备件。', '检修叉车制动并复测，合格后方可作业。'],
  },
  高处作业: {
    desc: ['喷涂线检修平台护栏高度不足 1.05 米，临边有坠落风险。', '屋面检修无生命线，临边作业无防坠措施。', '外墙清洗吊板无安全锁止装置。', '登高梯脚垫缺失，使用时易滑动。', '脚手架连墙件不足，大风天气有倾覆风险。'],
    act: ['护栏加高至 1.2 米并增设踢脚板。', '安装水平生命线并配置双钩安全带。', '配重与锁止装置检查合格后方可作业。', '更换防滑脚垫并固定梯脚。', '补足连墙件并设缆风绳，大风停用。'],
  },
  危化品: {
    desc: ['乙醇暂存区未设置防泄漏围堰，地面无防静电措施。', '危化品库通风风机故障停用 2 天。', 'MSDS 卡片缺失、未上墙公示。', '危化品出入库台账登记不及时。', '危化品暂存超量，未落实分区存放。'],
    act: ['增设防泄漏收集槽，地面做防静电处理并张贴 MSDS。', '修复风机并加装备用电源，监测运行。', '补全 MSDS 并上墙公示，组织培训。', '落实双人收发与日清台账制度。', '按禁忌分区存放并核减超量库存。'],
  },
  职业健康: {
    desc: ['喷涂岗位部分员工未规范佩戴防毒半面罩。', '噪声岗位未张贴职业危害警示标识。', '叉车尾气在密闭库区积聚。', '焊接烟尘局部浓度偏高，局部排风不足。', '夏季高温岗点未配足防暑降温物资。'],
    act: ['配发新滤毒罐并组织 PPE 佩戴培训与考核。', '张贴噪声有害警示与护耳器提示标识。', '增设强制通风并限时作业，检测达标。', '增设局部排风罩并定期检测烟尘浓度。', '配发防暑药品与盐汽水，落实轮休。'],
  },
  其他: {
    desc: ['地面线缆横跨通道未做防护，绊倒风险。', '安全出口指示牌被宣传海报遮挡。', '有限空间警示标识脱落未及时补装。'],
    act: ['线缆穿管或桥架敷设，通道恢复平整。', '撤除遮挡物，恢复出口标识可视。', '补装有限空间警示标识并登记。'],
  },
};
const WP_CONTENT = {
  hot_work: { label: '动火作业', items: ['焊接不锈钢支架，使用乙炔氧气焰，作业前须清理周边易燃包装物并配备灭火器材。', '切割更换蒸汽管道，使用乙炔焰，作业前完成管线隔离与泄压确认。', '罐区法兰动火修补，使用电弧焊，须气体检测合格并设接火盘。'] },
  high_altitude: { label: '高处作业', items: ['厂房屋面防水施工，登高约 4 米，沿临边搭设生命线并使用双钩安全带。', '外墙玻璃清洗，登高约 6 米，使用吊篮并检查配重与锁止装置。', '管廊支架安装，登高约 5 米，使用移动式升降平台。'] },
  confined_space: { label: '受限空间', items: ['乙醇储罐内部清污作业，需持续气体检测与强制通风，办理受限空间进入许可。', '电缆沟内接线作业，需通风检测并设专职监护人。', '反应釜内部防腐，须置换合格并连续监测有毒气体。'] },
  lifting: { label: '吊装作业', items: ['吊装大型模具入位，使用 5 吨行车，设吊装警戒区与指挥。', '叉车配合吊装货架，使用 3 吨叉车，落实绑扎与试吊。', '设备整机吊装就位，使用汽车吊，办理占道许可。'] },
  excavation: { label: '动土作业', items: ['开挖电缆沟，深度约 0.8 米，须查明地下管线并设边坡。', '厂区管沟开挖，深度约 1.2 米，临近道路须设硬隔离。', '基础基坑开挖，深度约 2 米，落实支护与降水。'] },
  temporary_electricity: { label: '临时用电', items: ['临时照明配电，含移动配电箱，须装漏保并日检。', '设备调试临时接电，含一机一闸一漏保。', '夜间施工临时供电，配电箱防雨接地可靠。'] },
  blind: { label: '盲板抽堵', items: ['管廊盲板抽堵作业，须按盲板图逐一确认并挂牌。', '反应釜盲板抽堵，介质为有机溶剂，须置换分析合格。', '罐区盲板加装，须上锁挂签并双人确认。'] },
  other: { label: '其他危险作业', items: ['实验室设备移位与重新定位，须断电挂牌并设指挥。', '平台检修搭设脚手架，须验收合格挂牌使用。', '厂内运输大件物资，须规划路线并设引导。'] },
};
const WP_TYPES = Object.keys(WP_CONTENT);

// ---------------- 通用插入（支持 jsonb 转换）----------------
async function insert(db, table, row, jsonbCols) {
  jsonbCols = jsonbCols || new Set();
  const cols = Object.keys(row);
  const params = cols.map((k) => row[k]);
  const ph = cols.map((k, i) => (jsonbCols.has(k) ? `$${i + 1}::jsonb` : `$${i + 1}`));
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph.join(',')})`;
  await db.query(sql, params);
}
async function insertReturning(db, table, row, jsonbCols, returning) {
  const cols = Object.keys(row);
  const params = cols.map((k) => row[k]);
  const ph = cols.map((k, i) => (jsonbCols && jsonbCols.has(k) ? `$${i + 1}::jsonb` : `$${i + 1}`));
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph.join(',')}) RETURNING ${returning}`;
  const r = await db.query(sql, params);
  return r.rows[0];
}

// ---------------- 隐患行构造 ----------------
function buildHazard(status, seq, users, deptNames, areaNames) {
  const category = pick(Object.keys(HAZARD_CONTENT));
  const c = HAZARD_CONTENT[category];
  const submitter = pick(users);
  const assignee = pick(users.filter((u) => u.id !== submitter.id)) || submitter;
  const risk = pick(RISKS);
  const created = daysAgoISO(rnd(0, 60));
  const building = pick(BUILDINGS);
  const floor = pick(FLOORS);
  const location = pick(LOCATIONS);
  const area = pick(areaNames);
  const department = pick(deptNames);
  const base = {
    hazard_no: `MOCK-YH-${String(seq).padStart(5, '0')}`,
    submitter_user_id: submitter.id,
    submitter_name: submitter.name,
    is_anonymous: false,
    building,
    floor,
    location,
    area,
    department,
    description: pick(c.desc),
    suggest_department: department,
    suggest_action: pick(c.act),
    ai_description: '',
    ai_category: category,
    ai_risk_level: risk,
    ai_regulation: '',
    ai_suggestion: '',
    ai_root_cause: '',
    ai_5why: '',
    ai_control_measures: '',
    category_approved: '[]',
    risk_level: risk,
    status,
    is_public: '是',
    created_at: created,
    updated_at: created,
  };
  if (status === 'pending_assign' || status === 'cancelled') {
    base.allocated_department = null;
    base.assignee_id = null;
    base.assignee_name = null;
  } else {
    base.allocated_department = assignee.department || department;
    base.assignee_id = assignee.id;
    base.assignee_name = assignee.name;
  }
  if (['rectified', 'dept_confirmed', 'accepted', 'rejected'].includes(status)) {
    base.rectification_desc = pick(c.act);
    base.rectification_files = '[]';
    base.rectification_date = addDaysISO(created, rnd(1, 3));
    base.updated_at = base.rectification_date;
  } else {
    base.rectification_desc = null;
    base.rectification_files = '[]';
    base.rectification_date = null;
  }
  if (status === 'accepted') {
    base.acceptance_result = 'pass';
    base.rejection_reason = null;
  } else if (status === 'rejected') {
    base.acceptance_result = 'fail';
    base.rejection_reason = pick(['整改未附现场监护与验收照片，需补充后重新提交。', '防护罩未恢复为固定式，存在脱落风险，退回重新整改。', '气体检测记录不完整，缺少作业中复检数据。']);
  } else {
    base.acceptance_result = null;
    base.rejection_reason = null;
  }
  base.deadline = addDaysISO(created, risk === 'critical' ? 1 : risk === 'major' ? 3 : 7);
  return base;
}

// ---------------- 作业票行构造 ----------------
function buildWp(status, seq, users, deptNames, areaNames) {
  const type = pick(WP_TYPES);
  const meta = WP_CONTENT[type];
  const applicant = pick(users);
  const reviewer = pick(users.filter((u) => u.id !== applicant.id)) || applicant;
  const approver = pick(users.filter((u) => u.id !== applicant.id && u.id !== reviewer.id)) || reviewer;
  const created = daysAgoISO(rnd(0, 60));
  const operators = Array.from(new Set([pick(OPERATORS), pick(OPERATORS)]));
  const supervisor = pick(SUPERVISORS);
  const row = {
    permit_no: `MOCK-ZY-${String(seq).padStart(5, '0')}`,
    application_id: null,
    type,
    is_hazardous: type !== 'excavation' && type !== 'temporary_electricity' && type !== 'other',
    area: pick(areaNames),
    location: pick(LOCATIONS),
    start_time: created,
    end_time: addDaysISO(created, 1),
    applicant_id: applicant.id,
    applicant_name: applicant.name,
    department: pick(deptNames),
    operator_names: JSON.stringify(operators),
    supervisor_name: supervisor,
    supervisor_contact: `138${String(rnd(10000000, 99999999))}`,
    content: pick(meta.items),
    ai_risk_analysis: '',
    safety_measures: '[]',
    ai_review_analysis: '',
    status,
    reviewer_id: null,
    reviewer_name: null,
    review_opinion: null,
    approver_id: null,
    approver_name: null,
    approval_opinion: null,
    print_count: 0,
    qr_code: null,
    created_at: created,
    updated_at: created,
  };
  if (['reviewing', 'approved', 'printed', 'paused', 'finished', 'completed', 'voided', 'rejected'].includes(status)) {
    row.reviewer_id = reviewer.id;
    row.reviewer_name = reviewer.name;
    row.review_opinion = '作业风险辨识与安全措施审核合格，同意进入下一环节。';
  }
  if (['approved', 'printed', 'finished', 'completed'].includes(status)) {
    row.approver_id = approver.id;
    row.approver_name = approver.name;
    row.approval_opinion = '批准作业，须严格执行作业票安全措施与监护要求。';
  }
  if (status === 'printed') row.print_count = rnd(1, 3);
  if (status === 'paused') {
    row.paused_at = addDaysISO(created, 1);
    row.paused_by = reviewer.id;
    row.paused_by_name = reviewer.name;
    row.pause_reason = '现场风力超过 5 级且生命线锚点需重新加固，暂停作业待条件恢复。';
  }
  if (status === 'finished') row.finished_at = addDaysISO(created, 1);
  if (status === 'completed') {
    row.finished_at = addDaysISO(created, 1);
    row.archived_at = addDaysISO(created, 2);
  }
  if (status === 'voided') {
    row.voided_at = addDaysISO(created, 1);
    row.voided_by = reviewer.id;
    row.voided_by_name = reviewer.name;
    row.void_reason = '作业计划取消，相关许可同步作废。';
  }
  if (status === 'rejected') {
    row.review_opinion = pick(['未提供盲板位置图与管线隔离确认单，退回补充。', '作业方案安全措施不充分，退回重新编制。', '监护人配置不足，退回补充后重新申报。']);
  }
  return row;
}

// ---------------- 作业申请单行构造 ----------------
function buildApp(status, seq, users, deptNames, areaNames) {
  const type = pick(WP_TYPES);
  const meta = WP_CONTENT[type];
  const applicant = pick(users);
  const reviewer = pick(users.filter((u) => u.id !== applicant.id)) || applicant;
  const approver = pick(users.filter((u) => u.id !== applicant.id && u.id !== reviewer.id)) || reviewer;
  const planStart = daysAgoISO(rnd(0, 40));
  const planEnd = addDaysISO(planStart, rnd(1, 3));
  const operators = Array.from(new Set([pick(OPERATORS), pick(OPERATORS)]));
  const created = daysAgoISO(rnd(0, 45));
  const row = {
    permit_no: `MOCK-ZYAPP-${String(seq).padStart(5, '0')}`,
    applicant_id: applicant.id,
    applicant_name: applicant.name,
    department: pick(deptNames),
    area: pick(areaNames),
    location: pick(LOCATIONS),
    job_name: `${pick(areaNames)}·${meta.label}`,
    content: pick(meta.items),
    plan_start: planStart,
    plan_end: planEnd,
    operator_names: JSON.stringify(operators),
    supervisor_name: pick(SUPERVISORS),
    supervisor_contact: `138${String(rnd(10000000, 99999999))}`,
    operator_contact: `139${String(rnd(10000000, 99999999))}`,
    involves_hazardous: type !== 'excavation' && type !== 'temporary_electricity' && type !== 'other',
    training_id: null,
    status,
    reviewer_id: null,
    reviewer_name: null,
    review_opinion: null,
    reviewed_at: null,
    approver_id: null,
    approver_name: null,
    approval_opinion: null,
    approved_at: null,
    print_count: 0,
    created_at: created,
    updated_at: created,
  };
  if (['approved', 'printed', 'paused', 'finished', 'completed', 'voided', 'rejected'].includes(status)) {
    row.reviewer_id = reviewer.id;
    row.reviewer_name = reviewer.name;
    row.review_opinion = '安全措施与作业方案审核合格，同意进入下一环节。';
    row.reviewed_at = created;
  }
  if (['approved', 'printed', 'finished', 'completed'].includes(status)) {
    row.approver_id = approver.id;
    row.approver_name = approver.name;
    row.approval_opinion = '批准作业，须严格执行作业票安全措施。';
    row.approved_at = created;
  }
  if (status === 'printed') {
    row.print_count = rnd(1, 3);
    row.printed_at = planStart;
  }
  if (status === 'paused') {
    row.paused_at = addDaysISO(created, 1);
    row.paused_by = reviewer.id;
    row.paused_by_name = reviewer.name;
    row.pause_reason = '现场条件不满足，暂停作业待条件恢复。';
  }
  if (status === 'finished') row.finished_at = addDaysISO(created, 1);
  if (status === 'completed') {
    row.finished_at = addDaysISO(created, 1);
    row.archived_at = addDaysISO(created, 2);
  }
  if (status === 'voided') {
    row.voided_at = addDaysISO(created, 1);
    row.voided_by = reviewer.id;
    row.voided_by_name = reviewer.name;
    row.void_reason = '作业计划取消，申请单作废。';
  }
  return row;
}

// ---------------- 主流程 ----------------
async function main() {
  console.log('打开 PGlite 数据目录:', DATA_DIR);
  const db = await PGlite.create({ dataDir: DATA_DIR });

  // 已有用户（用于外键安全，必要时兜底）
  const { rows: existingUsers } = await db.query('SELECT id, name, department FROM users WHERE username NOT LIKE \'mock_%\' ORDER BY created_at');
  const existingUserList = existingUsers.length ? existingUsers : [{ id: null, name: '匿名', department: '安全环保部' }];
  console.log(`既有用户 ${existingUserList.length} 个（不参与清理）。`);

  // ===== 幂等清理（仅 MOCK 标记数据）=====
  await db.query("DELETE FROM hazards WHERE hazard_no LIKE 'MOCK-%'");
  await db.query("DELETE FROM work_permits WHERE permit_no LIKE 'MOCK-%'");
  await db.query("DELETE FROM work_permit_applications WHERE permit_no LIKE 'MOCK-%'");
  await db.query("DELETE FROM users WHERE username LIKE 'mock_%'"); // 级联删除 department_managers / user_roles
  await db.query("DELETE FROM departments WHERE abbreviation = 'MOCK'"); // 级联删除 department_managers
  await db.query("DELETE FROM areas WHERE code = 'MOCK'");
  console.log('已清理上一批 MOCK 模拟数据。');

  // ===== 1) 部门（先查重，已存在则复用，避免唯一约束冲突）=====
  const deptNames = [];
  const deptRows = [];
  for (const d of DEPT_DEFS) {
    const ex = await db.query('SELECT id, name FROM departments WHERE name = $1', [d.name]);
    let ins;
    if (ex.rows.length) {
      ins = ex.rows[0]; // 复用既有真实部门
    } else {
      ins = await insertReturning(
        db,
        'departments',
        {
          name: d.name,
          abbreviation: 'MOCK',
          responsible_person: d.rp,
          coordinator: d.coord,
          coordinator_phone: d.phone,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        null,
        'id, name',
      );
    }
    deptNames.push(ins.name);
    deptRows.push(ins);
  }
  console.log(`部门：${deptRows.length} 个（含复用既有）`);

  // ===== 2) 区域（先查重，已存在则跳过插入，仍纳入可用名称池）=====
  let areaCount = 0;
  for (const a of AREA_DEFS) {
    const ex = await db.query('SELECT name FROM areas WHERE name = $1', [a.name]);
    if (!ex.rows.length) {
      await insert(db, 'areas', {
        name: a.name,
        code: 'MOCK',
        description: a.desc,
        enabled: true,
        sort_order: areaCount,
        building: a.building,
        floor: a.floor,
        responsible_dept: a.rd,
      }, null);
    }
    areaCount += 1;
  }
  const { rows: areaRows } = await db.query("SELECT name FROM areas WHERE code = 'MOCK' OR name = ANY($1::text[])", [AREA_DEFS.map((a) => a.name)]);
  const areaNames = areaRows.map((r) => r.name);
  console.log(`区域：${areaCount} 个（含复用既有 / MOCK 标记 ${areaRows.filter((r) => true).length}）`);

  // ===== 3) 员工（用户）=====
  const EMP_COUNT = 50;
  const mockUsers = [];
  for (let i = 0; i < EMP_COUNT; i++) {
    const name = pick(SURNAMES) + pick(GIVEN);
    const username = `mock_${String(i + 1).padStart(3, '0')}`;
    const department = pick(deptNames);
    const area = pick(areaNames);
    const ins = await insertReturning(
      db,
      'users',
      {
        username,
        name,
        password_hash: MOCK_HASH,
        email: `${username}@ehs-demo.local`,
        phone: `13${String(rnd(100000000, 999999999))}`,
        department,
        area,
        status: 'active',
        must_change_password: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      null,
      'id, name, department',
    );
    mockUsers.push(ins);
  }
  console.log(`员工（用户）：${mockUsers.length} 个（密码 ${MOCK_PWD}，首次登录强制改密）`);

  // ===== 3.5) 给普通员工(employee)角色补「查看全部/部门」权限，并分配所有 mock 员工 =====
  // 否则 mock 员工无角色 → 列表 403 空白；且 employee 仅 view_own，看不到模拟数据。
  {
    const roleRes = await db.query("SELECT id FROM roles WHERE key = 'employee'");
    if (roleRes.rows.length) {
      const empRoleId = roleRes.rows[0].id;
      const empPermTargets = [['hazard', 'view_all'], ['hazard', 'view_department'], ['work_permit', 'view_all'], ['work_permit', 'view_department']];
      const ph = empPermTargets.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
      const permRes = await db.query(`SELECT id, subject, action FROM permissions WHERE (subject, action) IN (${ph})`, empPermTargets.flat());
      const pmap = new Map(permRes.rows.map((p) => [`${p.subject}:${p.action}`, p.id]));
      for (const [subject, action] of empPermTargets) {
        const pid = pmap.get(`${subject}:${action}`);
        if (!pid) continue;
        const ex = await db.query('SELECT 1 FROM role_permissions WHERE role_id = $1 AND permission_id = $2', [empRoleId, pid]);
        if (!ex.rows.length) {
          await db.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)', [empRoleId, pid]);
        }
      }
      let linked = 0;
      for (const u of mockUsers) {
        const ex = await db.query('SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2', [u.id, empRoleId]);
        if (!ex.rows.length) {
          await db.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [u.id, empRoleId]);
          linked += 1;
        }
      }
      console.log(`普通员工角色已补查看权限，并分配 ${linked} 名 mock 员工。`);
    } else {
      console.warn('未找到 employee 角色，跳过权限分配（请先初始化角色）。');
    }
  }

  // ===== 4) 部门负责人映射 =====
  let mgrCount = 0;
  for (const dept of deptRows) {
    const candidates = mockUsers.filter((u) => u.department === dept.name);
    const mgr = candidates.length ? pick(candidates) : pick(mockUsers);
    await insert(db, 'department_managers', {
      user_id: mgr.id,
      department_id: dept.id,
      created_at: new Date().toISOString(),
    }, null);
    mgrCount += 1;
  }
  console.log(`部门负责人映射：${mgrCount} 条`);

  // ===== 5) 隐患 250（加权随机状态）=====
  const HAZARD_W = { pending_assign: 18, assigned: 20, rectified: 18, dept_confirmed: 14, accepted: 14, rejected: 8, cancelled: 8 };
  const HAZARD_STATUSES = Object.keys(HAZARD_W);
  const WP_W = { draft: 12, pending_review: 14, reviewing: 14, approved: 12, printed: 10, paused: 8, finished: 8, completed: 10, voided: 6, rejected: 6 };
  const WP_STATUSES = Object.keys(WP_W);
  const APP_STATUSES = ['draft', 'approved', 'printed', 'paused', 'finished', 'completed', 'voided', 'rejected'];

  const combinedUsers = existingUserList.concat(mockUsers);
  const jsonbHazard = new Set(['category_approved', 'rectification_files']);
  const jsonbWp = new Set(['operator_names', 'safety_measures']);
  const jsonbApp = new Set(['operator_names']);

  const hazardCounter = {};
  HAZARD_STATUSES.forEach((s) => (hazardCounter[s] = 0));
  let hzSeq = 0;
  for (let i = 0; i < 250; i++) {
    const st = weightedPick(HAZARD_W);
    hzSeq += 1;
    hazardCounter[st] += 1;
    await insert(db, 'hazards', buildHazard(st, hzSeq, combinedUsers, deptNames, areaNames), jsonbHazard);
  }

  // ===== 6) 作业票 250（加权随机状态）=====
  const wpCounter = {};
  WP_STATUSES.forEach((s) => (wpCounter[s] = 0));
  let wpSeq = 0;
  for (let i = 0; i < 250; i++) {
    const st = weightedPick(WP_W);
    wpSeq += 1;
    wpCounter[st] += 1;
    await insert(db, 'work_permits', buildWp(st, wpSeq, combinedUsers, deptNames, areaNames), jsonbWp);
  }

  // ===== 7) 作业申请（保留铺底，每态 2-16 条）=====
  let appSeq = 0;
  const appSummary = [];
  for (const st of APP_STATUSES) {
    const n = rnd(2, 16);
    for (let i = 0; i < n; i++) {
      appSeq += 1;
      await insert(db, 'work_permit_applications', buildApp(st, appSeq, combinedUsers, deptNames, areaNames), jsonbApp);
    }
    appSummary.push(`作业申请[${st}]: ${n}`);
  }

  await db.close();
  console.log('---- 模拟数据生成完成 ----');
  console.log(`部门 ${deptRows.length} | 区域 ${areaCount} | 员工 ${mockUsers.length} | 部门负责人 ${mgrCount}`);
  console.log(`隐患合计 ${hzSeq} 条（分布：${JSON.stringify(hazardCounter)}）`);
  console.log(`作业票合计 ${wpSeq} 条（分布：${JSON.stringify(wpCounter)}）`);
  console.log(`作业申请合计 ${appSeq} 条`);
  console.log('（作业申请明细：' + appSummary.join('，') + '）');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('种子脚本失败：', e);
  process.exit(1);
});
