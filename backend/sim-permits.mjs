// 随机模拟 50 组不同类型、不同状态的作业票（8/20 ~ 9/15）
// 全部通过真实 API + 数据库真实用户走完整流程，用于发现流程问题
import { randomUUID } from 'node:crypto';

const BASE = 'http://localhost:3100/api';
const PASS = 'Demo@123456';
const ADMIN_PASS = 'admin123456';
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const D0 = new Date(2026, 7, 20); // 2026-08-20
const NOW = new Date();

const log = (s) => console.log(s);
const tokenCache = new Map();
async function tokenOf(username) {
  if (tokenCache.has(username)) return tokenCache.get(username);
  const pwd = username === 'admin' ? ADMIN_PASS : PASS;
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: pwd }),
  });
  if (!r.ok) throw new Error(`登录失败 ${username} -> ${r.status}`);
  const t = (await r.json()).token;
  tokenCache.set(username, t);
  return t;
}

async function api(method, path, { token, json, form, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  else if (form) body = form; // FormData，不手动设 Content-Type
  else if (raw) body = raw;
  const r = await fetch(`${BASE}${path}`, { method, headers, body });
  let j = null;
  try { j = await r.json(); } catch { /* 非 JSON */ }
  return { status: r.status, ok: r.ok, json: j, text: await r.text().catch(() => '') };
}

function day(offset) { const d = new Date(D0); d.setDate(d.getDate() + offset); return d; }
function iso(d) { return d.toISOString(); }
function dayStart(offset, hh) { const d = day(offset); d.setHours(hh, 30, 0, 0); return d; }
function pad(n) { return String(n).padStart(2, '0'); }

// 随机工具
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 当前电子票流水起点（创建后会自增，这里仅估算编号展示用）
let seq = {};

async function loadPools() {
  const adminTok = await tokenOf('admin');
  const users = (await api('GET', '/users?pageSize=100', { token: adminTok })).json.items;
  const areas = await api('GET', '/areas', { token: adminTok }).then((r) => r.json);
  const pools = {
    applicants: users.filter((u) => u.roles?.some((r) => r.key === 'employee')).map((u) => u.username),
    approvers: users.filter((u) => u.roles?.some((r) => r.key === 'approver')).map((u) => u.username),
    safeties: users.filter((u) => u.roles?.some((r) => r.key === 'safety')).map((u) => u.username),
    areas: areas.map((a) => ({ name: a.name, building: a.building, floor: a.floor })),
  };
  log(`用户池: 申请人${pools.applicants.length} 审核/批准${pools.approvers.length} EHS${pools.safeties.length} | 区域${pools.areas.length}`);
  return pools;
}

// ========== 常规票完整流程 ==========
async function createRoutineTicket(pool, spec) {
  const { target, offset } = spec;
  const applicant = rand(pool.applicants);
  const appTok = await tokenOf(applicant);
  const area = rand(pool.areas);
  const reviewer = rand(pool.approvers);
  const manager = rand(pool.approvers);
  const revTok = await tokenOf(reviewer);
  const mgrTok = await tokenOf(manager);
  const onsiteTok = appTok; // 申请人可做现场检查
  const safetyTok = await tokenOf(rand(pool.safeties));

  const ps = dayStart(offset, 9);
  const durDays = randInt(1, 3);
  const pe = new Date(ps); pe.setDate(pe.getDate() + durDays); pe.setHours(17, 30, 0, 0);
  // 执行态票确保 planEnd 不过期（避免被 autoArchiveExpired 提前收走）
  if (['printed', 'paused', 'finished'].includes(target) && pe < new Date(NOW.getTime() + 6 * 3600e3)) {
    pe.setTime(NOW.getTime() + 6 * 3600e3 + 60e3);
  }

  const t = { kind: 'routine', type: 'routine', target, no: null, wpId: null, steps: [], issue: null };
  const step = async (name, fn) => {
    try { const r = await fn(); t.steps.push({ api: name, status: r.status, ok: r.ok }); if (!r.ok) throw new Error(`${name} -> ${r.status} ${JSON.stringify(r.json)}`); return r.json; }
    catch (e) { t.issue = e.message; throw e; }
  };

  try {
    // 1) 创建 FOR001 申请单
    const app = await step('POST /e-applications', () => api('POST', '/e-applications', {
      token: appTok,
      json: {
        building: area.building, floor: area.floor, area: area.name,
        location: `${area.name} ${randInt(1, 6)}号机位`,
        jobName: `常规检修作业-${pad(offset + 1)}`, content: '设备检修、管线维护、区域清洁等常规作业，含简单工具使用',
        supervisorName: rand(pool.applicants), contractorUnit: 'XX工程建设有限公司', contractorHead: '施工负责人', contractorPhone: '13800000000',
        managementDept: '设备动力部', managementPerson: manager,
        planStart: iso(ps), planEnd: iso(pe),
        involvesHazardous: false, permitType: 'routine',
        expectedOperatorCount: randInt(2, 6),
      },
    }));
    const appId = app.id;
    t.appId = appId;
    // 2) 录入 FOR002 培训
    await step('POST /e-applications/:id/training', () => api('POST', `/e-applications/${appId}/training`, {
      token: appTok,
      json: { trainer: '安全培训讲师', trainingTopics: '入厂安全须知/劳保用品穿戴', traineeNames: ['李伟'], testResult: '合格', trainingDate: iso(dayStart(offset, 8)) },
    }));
    await step('POST /e-applications/:id/training/sign', () => api('POST', `/e-applications/${appId}/training/sign`, {
      token: appTok,
      json: { name: '李伟', signImg: SIG, testResult: '合格' },
    }));

    // 3) 提交申请单（自动建常规作业票）
    const sub = await step('POST /e-applications/:id/submit', () => api('POST', `/e-applications/${appId}/submit`, { token: appTok }));
    void sub;
    // 4) 取 wpId
    const det = await api('GET', `/e-applications/${appId}`, { token: await tokenOf('admin') });
    const wps = det.json.workPermits || [];
    if (!wps.length) throw new Error('申请单提交后未生成作业票');
    const wpId = wps[0].id;
    t.wpId = wpId;
    t.no = wps[0].permitNo;
    if (!seq['GWP']) seq['GWP'] = 0; seq['GWP']++;

    const finish = async (s) => { t.actual = s; return t; };
    const wpStatus = async () => {
      const d = await api('GET', `/e-permits/${wpId}`, { token: await tokenOf('admin') });
      return d.json.status;
    };

    if (target === 'draft') return await finish('draft');
    // submit 后常规票即 pending_review
    if (target === 'pending_review') return await finish('pending_review');
    if (target === 'rejected') {
      await step('PUT /e-permits/:id/review(驳回)', () => api('PUT', `/e-permits/${wpId}/review`, { token: revTok, json: { approve: false, opinion: '作业内容不完整，请补充后重提' } }));
      return await finish('rejected');
    }
    // 审批：状态驱动推进到 approved（审批链可能因一人兼多职被合并为 1 级）
    let st = await wpStatus();
    if (st === 'pending_review' || st === 'reviewing') {
      await step('PUT /e-permits/:id/review', () => api('PUT', `/e-permits/${wpId}/review`, { token: revTok, json: { approve: true, opinion: '同意' } }));
      st = await wpStatus();
    }
    if (target === 'reviewing') return await finish(st);
    if (st === 'reviewing') {
      await step('PUT /e-permits/:id/approve', () => api('PUT', `/e-permits/${wpId}/approve`, { token: mgrTok, json: { approve: true, opinion: '同意作业' } }));
      st = await wpStatus();
    }
    if (st !== 'approved') throw new Error(`审批后状态异常: ${st}`);
    if (target === 'approved') return await finish('approved');
    if (target === 'voided') {
      await step('PUT /e-permits/:id/void', () => api('PUT', `/e-permits/${wpId}/void`, { token: safetyTok, json: { reason: '作业计划取消，作废' } }));
      return await finish('voided');
    }
    // 6) 开工
    await step('PUT /e-permits/:id/start', () => api('PUT', `/e-permits/${wpId}/start`, { token: onsiteTok }));
    // 巡检（当天开工，无历史日，仍记录一次现场检查）
    await step('POST /e-permits/:id/checks', () => api('POST', `/e-permits/${wpId}/checks`, { token: onsiteTok, json: { checkerName: rand(pool.applicants), checkItems: { safety: true, protective: true }, note: '现场巡检正常' } }));
    // 签字（完工前置：applicant + worker）
    await step('POST /e-permits/:id/signatures(申请人)', () => api('POST', `/e-permits/${wpId}/signatures`, { token: onsiteTok, json: { name: '申请人', role: 'applicant', signImg: SIG } }));
    await step('POST /e-permits/:id/signatures(作业人)', () => api('POST', `/e-permits/${wpId}/signatures`, { token: onsiteTok, json: { name: '作业人', role: 'worker', signImg: SIG } }));
    if (target === 'paused') {
      await step('PUT /e-permits/:id/pause', async () => api('PUT', `/e-permits/${wpId}/pause`, { token: await tokenOf('admin'), json: { reason: '天气原因暂停作业' } }));
      return await finish('paused');
    }
    if (target === 'printed') return await finish('printed');
    // 7) 完工 / 归档
    await step('PUT /e-permits/:id/finish', () => api('PUT', `/e-permits/${wpId}/finish`, { token: onsiteTok }));
    if (target === 'finished') return await finish('finished');
    await step('PUT /e-permits/:id/archive', () => api('PUT', `/e-permits/${wpId}/archive`, { token: onsiteTok }));
    return await finish('completed');
  } catch (e) {
    if (!t.issue) t.issue = e.message;
    return t;
  }
}

// ========== 危险票完整流程 ==========
async function createHazardTicket(pool, spec, parentWpId, parentWindow) {
  const { target, offset, type } = spec;
  const applicant = rand(pool.applicants);
  const appTok = await tokenOf(applicant);
  const reviewer = rand(pool.approvers);
  const ehs = rand(pool.safeties);
  const manager = rand(pool.approvers);
  const revTok = await tokenOf(reviewer);
  const ehsTok = await tokenOf(ehs);
  const mgrTok = await tokenOf(manager);
  const onsiteTok = appTok;
  const safetyTok = await tokenOf(rand(pool.safeties));

  // 时间窗口 ⊆ 父常规票窗口（危险票 5~10h；临时用电 24~48h）
  const pw = parentWindow;
  const pwStart = new Date(pw.ps).getTime();
  const pwEnd = new Date(pw.pe).getTime();
  let psMs = pwStart + randInt(2, 22) * 3600e3;
  if (psMs >= pwEnd - 3600e3) psMs = pwStart + 2 * 3600e3; // 父窗口过短时回退
  const ps = new Date(psMs);
  const durH = type === 'temporary_electricity' ? randInt(24, 48) : randInt(5, 10);
  const pe = new Date(Math.min(psMs + durH * 3600e3, pwEnd - 60000));

  const t = { kind: 'hazard', type, target, no: null, wpId: null, steps: [], issue: null };
  const step = async (name, fn) => {
    try { const r = await fn(); t.steps.push({ api: name, status: r.status, ok: r.ok }); if (!r.ok) throw new Error(`${name} -> ${r.status} ${JSON.stringify(r.json)}`); return r.json; }
    catch (e) { t.issue = e.message; throw e; }
  };

  try {
    // 1) 创建草稿并关联父常规票
    const wp = await step('POST /e-permits', () => api('POST', '/e-permits', {
      token: appTok, json: { type, linkedRoutineId: parentWpId, channel: 'electronic' },
    }));
    const wpId = wp.id;
    t.wpId = wpId;
    t.no = wp.permitNo;
    const P = wp.permitNo.split('-')[0];
    if (!seq[P]) seq[P] = 0; seq[P]++;

    const area = rand(pool.areas);
    // 2) 补全信息
    await step('PUT /e-permits/:id', () => api('PUT', `/e-permits/${wpId}`, {
      token: appTok,
      json: {
        content: `${typeLabel(type)}作业模拟-${pad(offset + 1)}`,
        location: `${area.name} ${randInt(1, 6)}号作业点`,
        operatorNames: ['张工', '王工'],
        supervisorName: '专职监护人', supervisorContact: '13900000000',
        startTime: iso(ps), endTime: iso(pe),
      },
    }));
    // 3) 需要证书的类型上传操作证
    const needCert = ['hot_work', 'high_altitude', 'confined_space', 'lifting'].includes(type);
    if (needCert) {
      const fd = new FormData();
      fd.append('file', new Blob([Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF')], { type: 'application/pdf' }), `cert-${randomUUID().slice(0, 8)}.pdf`);
      fd.append('issuer', '应急管理局特种作业操作证');
      await step('POST /e-permits/:id/certificates', () => api('POST', `/e-permits/${wpId}/certificates`, { token: appTok, form: fd }));
    }
    const finish = async (s) => { t.actual = s; return t; };
    const wpStatus = async () => {
      const d = await api('GET', `/e-permits/${wpId}`, { token: await tokenOf('admin') });
      return d.json.status;
    };

    if (target === 'draft') return await finish('draft');
    // 4) 提交
    await step('POST /e-permits/:id/submit', () => api('POST', `/e-permits/${wpId}/submit`, { token: appTok }));
    if (target === 'pending_review') return await finish('pending_review');
    if (target === 'rejected') {
      await step('PUT /e-permits/:id/review(驳回)', () => api('PUT', `/e-permits/${wpId}/review`, { token: revTok, json: { approve: false, opinion: '监护措施不满足要求，驳回' } }));
      return await finish('rejected');
    }
    // 5) 三级会签（状态驱动；链可能因一人兼多职被合并）
    let st = await wpStatus();
    if (st === 'pending_review') {
      await step('PUT /e-permits/:id/review', () => api('PUT', `/e-permits/${wpId}/review`, { token: revTok, json: { approve: true, opinion: '同意' } }));
      st = await wpStatus();
    }
    if (target === 'ehs_reviewing') return await finish(st);
    if (st === 'ehs_reviewing') {
      await step('PUT /e-permits/:id/approve-ehs', () => api('PUT', `/e-permits/${wpId}/approve-ehs`, { token: ehsTok, json: { approve: true, opinion: 'EHS审核通过' } }));
      st = await wpStatus();
    }
    if (target === 'reviewing') return await finish(st);
    if (st === 'reviewing') {
      await step('PUT /e-permits/:id/approve', () => api('PUT', `/e-permits/${wpId}/approve`, { token: mgrTok, json: { approve: true, opinion: '批准作业' } }));
      st = await wpStatus();
    }
    if (st !== 'approved') throw new Error(`审批后状态异常: ${st}`);
    if (target === 'approved') return await finish('approved');
    if (target === 'voided') {
      await step('PUT /e-permits/:id/void', () => api('PUT', `/e-permits/${wpId}/void`, { token: safetyTok, json: { reason: '作业取消，作废' } }));
      return await finish('voided');
    }
    // 6) 开工
    await step('PUT /e-permits/:id/start', () => api('PUT', `/e-permits/${wpId}/start`, { token: onsiteTok }));
    // 动火：0h 检查
    if (type === 'hot_work') {
      await step('POST /e-permits/:id/checks(0h)', () => api('POST', `/e-permits/${wpId}/checks`, { token: onsiteTok, json: { checkerName: '监火人', checkSlot: '0h', checkItems: { fire: true }, note: '动火前检查合格' } }));
    } else {
      await step('POST /e-permits/:id/checks', () => api('POST', `/e-permits/${wpId}/checks`, { token: onsiteTok, json: { checkerName: rand(pool.applicants), checkItems: { safety: true }, note: '现场检查合格' } }));
    }
    // 签字（危险票: applicant + supervisor + worker；动火额外 fire_watcher）
    await step('POST /e-permits/:id/signatures(申请人)', () => api('POST', `/e-permits/${wpId}/signatures`, { token: onsiteTok, json: { name: '申请人', role: 'applicant', signImg: SIG } }));
    await step('POST /e-permits/:id/signatures(监护人)', () => api('POST', `/e-permits/${wpId}/signatures`, { token: onsiteTok, json: { name: '监护人', role: 'supervisor', signImg: SIG } }));
    if (type === 'hot_work') {
      await step('POST /e-permits/:id/signatures(监火人)', () => api('POST', `/e-permits/${wpId}/signatures`, { token: onsiteTok, json: { name: '监火人', role: 'fire_watcher', signImg: SIG } }));
    }
    await step('POST /e-permits/:id/signatures(作业人)', () => api('POST', `/e-permits/${wpId}/signatures`, { token: onsiteTok, json: { name: '作业人', role: 'worker', signImg: SIG } }));
    if (target === 'paused') {
      await step('PUT /e-permits/:id/pause', async () => api('PUT', `/e-permits/${wpId}/pause`, { token: await tokenOf('admin'), json: { reason: '现场安全隐患暂停' } }));
      return await finish('paused');
    }
    if (target === 'printed') return await finish('printed');
    // 7) 完工 / 归档
    await step('PUT /e-permits/:id/finish', () => api('PUT', `/e-permits/${wpId}/finish`, { token: onsiteTok }));
    if (target === 'finished') return await finish('finished');
    await step('PUT /e-permits/:id/archive', () => api('PUT', `/e-permits/${wpId}/archive`, { token: onsiteTok }));
    return await finish('completed');
  } catch (e) {
    if (!t.issue) t.issue = e.message;
    return t;
  }
}

function typeLabel(type) {
  return { hot_work: '动火', high_altitude: '高处', confined_space: '受限空间', lifting: '吊装', excavation: '挖掘', temporary_electricity: '临时用电', blind: '盲板抽堵', other: '其他危险' }[type] || type;
}

// ========== 票单生成 ==========
function buildPlan() {
  const plan = [];
  // 常规票 24
  const routineTargets = [
    'draft', 'draft',
    'pending_review', 'pending_review',
    'reviewing', 'reviewing',
    'approved', 'approved', 'approved',
    'rejected', 'rejected',
    'printed', 'printed', 'printed', 'printed',
    'paused', 'paused', 'paused',
    'finished', 'finished', 'finished',
    'completed', 'completed',
    'voided',
  ];
  const hazardTypes = [
    'hot_work', 'hot_work', 'hot_work', 'hot_work', 'hot_work', 'hot_work',
    'high_altitude', 'high_altitude', 'high_altitude', 'high_altitude', 'high_altitude',
    'confined_space', 'confined_space', 'confined_space', 'confined_space',
    'lifting', 'lifting', 'lifting', 'lifting',
    'excavation', 'excavation',
    'temporary_electricity', 'temporary_electricity',
    'blind', 'other', 'other',
  ];
  const hazardTargets = [
    'draft', 'draft',
    'pending_review', 'pending_review',
    'ehs_reviewing', 'ehs_reviewing',
    'reviewing', 'reviewing',
    'approved', 'approved',
    'rejected',
    'printed', 'printed', 'printed', 'printed', 'printed', 'printed',
    'paused', 'paused', 'paused',
    'finished', 'finished', 'finished',
    'completed', 'completed',
    'voided',
  ];
  // 常规票 offset 均匀覆盖 0~26；执行态偏中后段
  for (const target of routineTargets) {
    const bias = target === 'completed' || target === 'voided' ? randInt(0, 1)
      : (target === 'printed' || target === 'paused' || target === 'finished') ? randInt(1, 12)
      : randInt(10, 26);
    plan.push({ kind: 'routine', type: 'routine', target, offset: bias });
  }
  // 危险票：类型与目标状态分别打乱后配对，offset 随父票
  const types = [...hazardTypes];
  const targets = [...hazardTargets];
  for (let i = types.length - 1; i > 0; i--) { const j = randInt(0, i); [types[i], types[j]] = [types[j], types[i]]; }
  for (let i = targets.length - 1; i > 0; i--) { const j = randInt(0, i); [targets[i], targets[j]] = [targets[j], targets[i]]; }
  for (let i = 0; i < types.length; i++) {
    plan.push({ kind: 'hazard', type: types[i], target: targets[i], offset: randInt(1, 26) });
  }
  return plan;
}

// ========== 主流程 ==========
async function main() {
  log('=== 开始 50 张作业票 API 模拟 ===');
  const pool = await loadPools();
  const plan = buildPlan();
  const routineIdx = plan.map((p, i) => ({ p, i })).filter((x) => x.p.kind === 'routine');
  const hazardIdx = plan.map((p, i) => ({ p, i })).filter((x) => x.p.kind === 'hazard');
  log(`票单: 常规 ${routineIdx.length} 张, 危险 ${hazardIdx.length} 张`);

  const results = [];
  const parents = []; // 可用作父票的常规票 {wpId, ps, pe}

  // Phase 1: 常规票
  log('\n--- Phase 1: 常规作业票 ---');
  for (const { p, i } of routineIdx) {
    log(`[${i + 1}/50] 常规票 target=${p.target} offset=${p.offset}`);
    const r = await createRoutineTicket(pool, p);
    results[i] = r;
    // 收集父票：approved/printed/paused 且流程成功
    if (r.wpId && r.actual && ['approved', 'printed', 'paused'].includes(r.actual)) {
      const det = await api('GET', `/e-permits/${r.wpId}`, { token: await tokenOf('admin') });
      parents.push({ wpId: r.wpId, ps: det.json.startTime, pe: det.json.endTime });
    }
    if (r.issue) log(`  !! ${r.no || r.wpId} 失败: ${r.issue}`);
    else log(`  -> ${r.no || 'N/A'} actual=${r.actual}`);
  }

  // 危险票挂父票
  if (!parents.length) { log('!! 没有可用父常规票'); process.exit(1); }
  log(`父常规票池: ${parents.length} 张`);

  // Phase 2: 危险票
  log('\n--- Phase 2: 危险作业票 ---');
  let pi = 0;
  for (const { p, i } of hazardIdx) {
    const parent = parents[pi % parents.length];
    pi++;
    log(`[${i + 1}/50] 危险票 type=${p.type} target=${p.target} 挂父=${parent.wpId}`);
    const r = await createHazardTicket(pool, p, parent.wpId, parent);
    results[i] = r;
    if (r.issue) log(`  !! ${r.no || r.wpId} 失败: ${r.issue}`);
    else log(`  -> ${r.no} actual=${r.actual}`);
  }

  // 汇总
  log('\n=== 汇总 ===');
  const fail = results.filter((r) => r.issue);
  log(`总数: ${results.length}, 有问题的票: ${fail.length}`);
  const byTarget = {};
  const byActual = {};
  for (const r of results) {
    byTarget[r.target] = (byTarget[r.target] || 0) + 1;
    byActual[r.actual || '未完成'] = (byActual[r.actual || '未完成'] || 0) + 1;
  }
  log('目标状态分布:', JSON.stringify(byTarget));
  log('实际状态分布:', JSON.stringify(byActual));
  log('\n=== 明细 ===');
  for (const r of results) {
    log(`${r.kind === 'routine' ? '常规' : '危险'} ${r.type.padEnd(16)} | 目标=${r.target.padEnd(14)} | 实际=${(r.actual || '未完成').padEnd(14)} | ${r.no || ''} ${r.issue ? '!! ' + r.issue : ''}`);
  }
  log('\n=== 失败明细 ===');
  for (const r of fail) {
    log(`[${r.no || r.wpId}] ${r.kind}/${r.type}/${r.target}`);
    for (const s of r.steps) if (!s.ok) log(`   ✗ ${s.api} -> ${s.status}`);
    log(`   原因: ${r.issue}`);
  }
}

main().catch((e) => { console.error('主流程异常:', e); process.exit(1); });
