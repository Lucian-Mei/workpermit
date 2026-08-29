/**
 * 通过 HTTP API 批量模拟隐患填报全流程
 * 覆盖 7 种隐患类型 × 3 风险等级，约 210 条，其中 ~60 条停留在不同非终态
 *
 * 隐患状态机（真实，含摘要遗漏的 dept_confirmed）：
 *   pending_assign → assign() → assigned → rectify() → rectified
 *     → dept-review(confirm) → dept_confirmed → accept(pass) → accepted
 *     → dept-review(reject) → rejected  |  accept(fail) → rejected
 *   任意态 cancel() → cancelled
 *
 * 强状态校验：dept-review 要求当前=rectified；accept 要求当前=dept_confirmed
 * 无状态校验：assign / rectify / cancel（可从任意态调用）
 * 必填：create 需 description|location 至少一个 + photos[] ≥1
 * 权限：必须用 admin（hazard:rectify 仅 admin 拥有）
 *
 * 运行：node scripts/api-seed-hazards.cjs
 */
const BASE = 'http://localhost:3100/api';

const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ⭐ 关键：创建/流转隐患会 fire-and-forget 触发 email.notify()（内部 3~4 次 DB 读），
// 与下一个请求并发访问单连接 PGlite 会导致崩溃。每次请求后留出串行窗口让 notify 的 DB 读完成。
const DELAY = 60;

const CATEGORIES = ['消防安全', '用电安全', '机械设备', '高处作业', '危化品', '职业健康', '其他'];
const RISK_LEVELS = ['normal', 'major', 'critical'];
const BUILDINGS = ['一号厂房', '二号厂房', '综合楼', '危化品库区', '动力站房', '研发中心', '成品仓库', '厂前区'];
const FLOORS = ['一层', '二层', '三层', '负一层', '屋面', '设备夹层'];
const AREAS = ['冲压区', '装配区', '喷涂线', '配电室', '锅炉房', '实验室红区', '立体货架区', '充电站', '物流主通道', '暂存区'];
const LOCATIONS = ['北侧消防通道', '1#配电柜', '冲压线端子箱', '检修平台临边', '乙醇暂存区', '喷涂废气管道', '货架第三层', '变压器室门口', '登高钢直梯', '压力表接口', '冷库压缩机房', '焊接工位'];
const DEPTS = ['生产一部', '生产二部', '机修保障部', '物流配送部', '安环监察部', '质检管控部', '研发中心', '基建工程部', '行政人事部', '承包商管理部'];
const SUBMITTERS = ['赵敏', '周强', '孙丽', '吴军', '郑涛', '何星', '李娜', '董磊', '王强', '刘敏', '陈浩', '杨雪'];
const ASSIGNEES = ['王刚', '李伟', '薛梅', '杨帆', '郭华', '刘洋'];

const DESC_BY_CAT = {
  消防安全: ['消防通道被货物占用，宽度不足 0.8 米，影响紧急疏散。', '灭火器压力表指针进入红区，已失效需更换。', '防火门被杂物顶开无法自动闭合，失去防火分隔作用。', '室内消火栓箱内水带缺失，无法正常取用。'],
  用电安全: ['配电柜内接线端子发热变色，存在过载隐患。', '临时用电线路直接落地敷设，绝缘破损裸露铜线。', '插座面板破裂，带电部分外露有触电风险。', '配电箱未安装漏电保护器，防护缺失。'],
  机械设备: ['冲压机安全光栅失效，手部易进入危险区。', '行车限位开关损坏，存在冒顶碰撞风险。', '设备旋转部位防护罩缺失，卷入伤害风险高。', '压力容器安全阀超期未校验。'],
  高处作业: ['检修平台临边护栏缺失一段，坠落风险高。', '登高钢直梯护笼锈蚀断裂。', '屋面采光带无防坠网，检修易踩空坠落。', '脚手架连墙件缺失，整体稳定性不足。'],
  危化品: ['乙醇暂存区无防爆照明，且通风不足。', '危化品未分类存放，酸碱混放存在反应风险。', '气瓶未固定且瓶帽缺失，倾倒撞击风险。', '危废暂存间未设围堰，渗漏污染风险。'],
  职业健康: ['喷涂岗位未配备有效防毒面具，苯系物暴露超标。', '噪声岗位未设置隔声屏障，长期暴露损害听力。', '打磨工位粉尘弥漫，除尘设施失效。', '高温岗位缺少防暑降温措施。'],
  其他: ['厂区地面油污湿滑，未设警示标识，易滑倒。', '安全标识牌褪色缺失，警示作用弱化。', '应急照明灯故障，停电时无法照明疏散。', '楼梯扶手松动存在坠落风险。'],
};

// 目标状态分布（合计 210；非终态 ~60 满足"50个左右停留在不同状态"）
// accepted 走完整周期；其余为不同停留态
const HAZARD_PLAN = [
  { status: 'accepted',       count: 150 },
  { status: 'pending_assign', count: 10 },
  { status: 'assigned',       count: 10 },
  { status: 'rectified',      count: 10 },
  { status: 'dept_confirmed', count: 8 },
  { status: 'rejected_dept',  count: 6 },   // dept-review 驳回
  { status: 'rejected_ehs',   count: 6 },   // accept 不通过
  { status: 'cancelled',      count: 10 },
];

// 每个目标状态需要执行的流转步骤
const FLOWS = {
  pending_assign: [],
  assigned:       ['assign'],
  rectified:      ['assign', 'rectify'],
  dept_confirmed: ['assign', 'rectify', 'dept-confirm'],
  accepted:       ['assign', 'rectify', 'dept-confirm', 'accept-pass'],
  rejected_dept:  ['assign', 'rectify', 'dept-reject'],
  rejected_ehs:   ['assign', 'rectify', 'dept-confirm', 'accept-fail'],
  cancelled:      ['assign', 'cancel'],
};

async function api(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method, headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
      await sleep(DELAY); // 串行窗口，规避 fire-and-forget notify 的并发 PGlite 访问
      return { ok: res.ok, status: res.status, data: json };
    } catch (e) {
      // 网络错误（后端可能瞬时不可用）→ 退避重试
      lastErr = e;
      await sleep(1500 * (attempt + 1));
    }
  }
  return { ok: false, status: 0, data: { message: `网络失败: ${lastErr && lastErr.message}` } };
}

async function main() {
  console.log('登录中...');
  const loginRes = await api('POST', '/auth/login', null, { username: 'admin', password: 'Admin@123456' });
  if (!loginRes.ok) { console.error('登录失败:', loginRes.data); process.exit(1); }
  const token = loginRes.data.token;
  console.log('登录成功');

  // 展开计划
  const plan = [];
  let seq = 0;
  for (const p of HAZARD_PLAN) {
    for (let i = 0; i < p.count; i++) {
      seq++;
      plan.push({ seq, target: p.status });
    }
  }
  // 打乱顺序，模拟真实混合上报
  for (let i = plan.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [plan[i], plan[j]] = [plan[j], plan[i]];
  }

  console.log(`\n计划创建 ${plan.length} 条隐患`);
  const targetDist = {};
  plan.forEach(p => { targetDist[p.target] = (targetDist[p.target] || 0) + 1; });
  console.log('目标状态分布:', JSON.stringify(targetDist));

  let success = 0, failed = 0;
  const issues = [];
  const results = []; // { seq, target, actual, category, risk, match }

  for (const item of plan) {
    const cat = pick(CATEGORIES);
    const risk = pick(RISK_LEVELS);
    const dept = pick(DEPTS);
    const desc = pick(DESC_BY_CAT[cat]);
    const location = `${pick(BUILDINGS)}${pick(FLOORS)}${pick(LOCATIONS)}`;

    // 期望最终状态（rejected_dept / rejected_ehs 都归为 rejected）
    const expected = item.target.startsWith('rejected') ? 'rejected' : item.target;

    try {
      // 1. 创建隐患
      const createRes = await api('POST', '/hazards', token, {
        description: desc,
        building: pick(BUILDINGS),
        floor: pick(FLOORS),
        area: pick(AREAS),
        location,
        department: dept,
        submitterName: pick(SUBMITTERS),
        photos: ['https://sim.local/hazard/photo1.jpg'],
      });
      if (!createRes.ok) {
        failed++;
        issues.push(`[#${item.seq}] 创建失败 (${item.target}): ${createRes.data.message || createRes.data.raw}`);
        continue;
      }
      const id = createRes.data.id;

      // 2. 写入类型/风险等级（create 不接收 category，走 /ai 回填）
      await api('PUT', `/hazards/${id}/ai`, token, { aiCategory: cat, riskLevel: risk });

      // 3. 流转
      const flow = FLOWS[item.target] || [];
      let flowOk = true;
      for (const step of flow) {
        let res;
        if (step === 'assign') {
          res = await api('PUT', `/hazards/${id}/assign`, token, {
            allocatedDepartment: dept,
            assigneeName: pick(ASSIGNEES),
            deadline: new Date(Date.now() + rnd(1, 7) * 86400000).toISOString(),
            riskLevel: risk,
          });
        } else if (step === 'rectify') {
          res = await api('PUT', `/hazards/${id}/rectify`, token, {
            rectificationDesc: '已按要求完成整改，隐患已消除，现场恢复安全状态。',
            rectificationFiles: ['https://sim.local/hazard/rectify1.jpg'],
          });
        } else if (step === 'dept-confirm') {
          res = await api('PUT', `/hazards/${id}/dept-review`, token, { result: 'confirm' });
        } else if (step === 'dept-reject') {
          res = await api('PUT', `/hazards/${id}/dept-review`, token, { result: 'reject', rejectReason: '整改不彻底，现场仍存在隐患，退回重新整改。' });
        } else if (step === 'accept-pass') {
          res = await api('PUT', `/hazards/${id}/accept`, token, { result: 'pass' });
        } else if (step === 'accept-fail') {
          res = await api('PUT', `/hazards/${id}/accept`, token, { result: 'fail', rejectionReason: '验收发现整改措施未达标，判定不通过。' });
        } else if (step === 'cancel') {
          res = await api('PUT', `/hazards/${id}/cancel`, token, {});
        }
        if (!res || !res.ok) {
          flowOk = false;
          issues.push(`[#${item.seq}] 流转步骤 ${step} 失败 (目标 ${item.target}): ${res ? (res.data.message || JSON.stringify(res.data).slice(0, 150)) : 'no response'}`);
          break;
        }
      }

      // 4. 查询实际状态
      const detail = await api('GET', `/hazards/${id}`, token);
      const actual = detail.ok ? detail.data.status : '?';

      success++;
      results.push({ seq: item.seq, target: item.target, expected, actual, category: cat, risk, match: actual === expected });
    } catch (e) {
      failed++;
      issues.push(`[#${item.seq}] 异常 (${item.target}): ${e.message}`);
    }

    if (item.seq % 30 === 0) {
      console.log(`  进度: ${item.seq}/${plan.length} (成功 ${success}, 失败 ${failed})`);
    }
  }

  // ===== 报告 =====
  console.log('\n========== 隐患模拟完成 ==========');
  console.log(`总计: ${plan.length} | 成功: ${success} | 失败: ${failed}`);

  const matched = results.filter(r => r.match).length;
  const mismatched = results.filter(r => !r.match);
  console.log(`状态匹配: ${matched}/${results.length} (${mismatched.length} 条不符)`);

  console.log('\n实际状态分布:');
  const actualDist = {};
  results.forEach(r => { actualDist[r.actual] = (actualDist[r.actual] || 0) + 1; });
  Object.entries(actualDist).sort().forEach(([s, c]) => console.log(`  ${s}: ${c}`));

  console.log('\n隐患类型分布:');
  const catDist = {};
  results.forEach(r => { catDist[r.category] = (catDist[r.category] || 0) + 1; });
  Object.entries(catDist).sort().forEach(([s, c]) => console.log(`  ${s}: ${c}`));

  console.log('\n风险等级分布:');
  const riskDist = {};
  results.forEach(r => { riskDist[r.risk] = (riskDist[r.risk] || 0) + 1; });
  Object.entries(riskDist).sort().forEach(([s, c]) => console.log(`  ${s}: ${c}`));

  if (mismatched.length > 0) {
    console.log('\n状态偏差明细:');
    const byKey = {};
    mismatched.forEach(r => {
      const k = `${r.expected} → ${r.actual}`;
      byKey[k] = (byKey[k] || 0) + 1;
    });
    Object.entries(byKey).forEach(([k, c]) => console.log(`  ${k}: ${c} 条`));
  }

  if (issues.length > 0) {
    console.log(`\n⚠️ 发现 ${issues.length} 个问题:`);
    const grouped = {};
    issues.forEach(iss => {
      let key = '其他';
      const m = iss.match(/流转步骤 (\S+) 失败/);
      if (m) key = `步骤 ${m[1]} 失败`;
      else if (iss.includes('创建失败')) key = '创建失败';
      else if (iss.includes('异常')) key = '异常';
      (grouped[key] = grouped[key] || []).push(iss);
    });
    for (const [k, arr] of Object.entries(grouped)) {
      console.log(`\n  [${k}] ${arr.length} 条:`);
      arr.slice(0, 3).forEach(i => console.log(`    - ${i}`));
      if (arr.length > 3) console.log(`    ... 还有 ${arr.length - 3} 条`);
    }
  } else {
    console.log('\n✅ 无问题');
  }
}

main().catch(e => { console.error('脚本异常:', e); process.exit(1); });
