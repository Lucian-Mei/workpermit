// 补充：让 8/21~8/25 期间「进行中(printed)」作业达到 10+ 张
// 全部走真实 API + 数据库用户全流程（创建→审批→开工）
import { randomUUID } from 'node:crypto';

const BASE = 'http://localhost:3100/api';
const PASS = 'Demo@123456';
const ADMIN_PASS = 'admin123456';
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const log = (s) => console.log(s);
const tokenCache = new Map();
async function tokenOf(username) {
  if (tokenCache.has(username)) return tokenCache.get(username);
  const pwd = username === 'admin' ? ADMIN_PASS : PASS;
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: pwd }) });
  if (!r.ok) throw new Error(`登录失败 ${username} -> ${r.status}`);
  const t = (await r.json()).token;
  tokenCache.set(username, t);
  return t;
}
async function api(method, path, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  else if (form) body = form;
  const r = await fetch(`${BASE}${path}`, { method, headers, body });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, ok: r.ok, json: j };
}
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

async function loadPools() {
  const adminTok = await tokenOf('admin');
  const users = (await api('GET', '/users?pageSize=100', { token: adminTok })).json.items;
  const areas = (await api('GET', '/areas', { token: adminTok })).json;
  return {
    applicants: users.filter((u) => u.roles?.some((r) => r.key === 'employee')).map((u) => u.username),
    approvers: users.filter((u) => u.roles?.some((r) => r.key === 'approver')).map((u) => u.username),
    safeties: users.filter((u) => u.roles?.some((r) => r.key === 'safety')).map((u) => u.username),
    areas: areas.map((a) => ({ name: a.name, building: a.building, floor: a.floor })),
  };
}

// 常规票：走 FOR001 申请单 → 转作业票 → 审批 → 开工，目标 printed，窗口 8/21~8/25
async function createRoutinePrinted(pool, spec) {
  const { startOffset, endOffset } = spec; // 0=8/21, 1=8/22, 2=8/23; end 0=8/24, 1=8/25
  const applicant = rand(pool.applicants);
  const appTok = await tokenOf(applicant);
  const reviewer = rand(pool.approvers), manager = rand(pool.approvers);
  const revTok = await tokenOf(reviewer), mgrTok = await tokenOf(manager);
  const area = rand(pool.areas);

  const ps = new Date(2026, 7, 21 + startOffset, 8, 30, 0);
  const pe = new Date(2026, 7, 24 + endOffset, 17, 30, 0);
  const t = { kind: 'routine', no: null, wpId: null, issue: null };
  const step = async (name, fn) => {
    const r = await fn();
    if (!r.ok) { t.issue = `${name} -> ${r.status} ${JSON.stringify(r.json)}`; throw new Error(t.issue); }
    return r.json;
  };

  try {
    const app = await step('POST /e-applications', () => api('POST', '/e-applications', {
      token: appTok,
      json: {
        building: area.building, floor: area.floor, area: area.name,
        location: `${area.name} ${randInt(1, 8)}号机位`,
        jobName: `8月检修作业-${startOffset}-${endOffset}`, content: '设备检修、管线维护等常规作业',
        supervisorName: rand(pool.applicants), contractorUnit: 'XX工程建设有限公司', contractorHead: '施工负责人', contractorPhone: '13800000000',
        managementDept: '设备动力部', managementPerson: manager,
        planStart: ps.toISOString(), planEnd: pe.toISOString(),
        involvesHazardous: false, permitType: 'routine', expectedOperatorCount: randInt(2, 5),
      },
    }));
    const appId = app.id;
    await step('POST /e-applications/:id/training', () => api('POST', `/e-applications/${appId}/training`, {
      token: appTok, json: { trainer: '安全培训讲师', trainingTopics: '入厂安全须知', traineeNames: ['李伟'], testResult: '合格', trainingDate: ps.toISOString() },
    }));
    await step('POST /e-applications/:id/training/sign', () => api('POST', `/e-applications/${appId}/training/sign`, {
      token: appTok, json: { name: '李伟', signImg: SIG, testResult: '合格' },
    }));
    await step('POST /e-applications/:id/submit', () => api('POST', `/e-applications/${appId}/submit`, { token: appTok }));
    const det = (await api('GET', `/e-applications/${appId}`, { token: await tokenOf('admin') })).json;
    const wpId = (det.workPermits || [])[0]?.id;
    if (!wpId) throw new Error('申请单提交后未生成作业票');
    t.wpId = wpId; t.no = det.workPermits[0].permitNo;

    const wpStatus = async () => (await api('GET', `/e-permits/${wpId}`, { token: await tokenOf('admin') })).json.status;
    let st = await wpStatus();
    if (st === 'pending_review' || st === 'reviewing') {
      await step('review', () => api('PUT', `/e-permits/${wpId}/review`, { token: revTok, json: { approve: true, opinion: '同意' } }));
      st = await wpStatus();
    }
    if (st === 'reviewing') {
      await step('approve', () => api('PUT', `/e-permits/${wpId}/approve`, { token: mgrTok, json: { approve: true, opinion: '同意作业' } }));
      st = await wpStatus();
    }
    if (st !== 'approved') throw new Error(`审批后状态异常: ${st}`);
    await step('start', () => api('PUT', `/e-permits/${wpId}/start`, { token: appTok }));
    await step('checks', () => api('POST', `/e-permits/${wpId}/checks`, { token: appTok, json: { checkerName: rand(pool.applicants), checkItems: { safety: true }, note: '现场巡检正常' } }));
    const final = (await api('GET', `/e-permits/${wpId}`, { token: await tokenOf('admin') })).json;
    t.actual = final.status;
    return t;
  } catch (e) { t.issue = t.issue || e.message; return t; }
}

// 危险票：挂父常规票，窗口 8/21~8/25，目标 printed
async function createHazardPrinted(pool, spec, parent) {
  const { type } = spec;
  const applicant = rand(pool.applicants);
  const appTok = await tokenOf(applicant);
  const reviewer = rand(pool.approvers), ehs = rand(pool.safeties), manager = rand(pool.approvers);
  const revTok = await tokenOf(reviewer), ehsTok = await tokenOf(ehs), mgrTok = await tokenOf(manager);

  const pwStart = new Date(parent.ps).getTime(), pwEnd = new Date(parent.pe).getTime();
  let psMs = pwStart + randInt(2, 20) * 3600e3;
  if (psMs >= pwEnd - 3600e3) psMs = pwStart + 2 * 3600e3;
  const durH = type === 'temporary_electricity' ? randInt(20, 40) : randInt(5, 10);
  const pe = new Date(Math.min(psMs + durH * 3600e3, pwEnd - 60000));
  const ps = new Date(psMs);
  const area = rand(pool.areas);
  const t = { kind: 'hazard', type, no: null, wpId: null, issue: null };
  const step = async (name, fn) => {
    const r = await fn();
    if (!r.ok) { t.issue = `${name} -> ${r.status} ${JSON.stringify(r.json)}`; throw new Error(t.issue); }
    return r.json;
  };

  try {
    const wp = await step('POST /e-permits', () => api('POST', '/e-permits', { token: appTok, json: { type, linkedRoutineId: parent.wpId, channel: 'electronic' } }));
    const wpId = wp.id; t.wpId = wpId; t.no = wp.permitNo;
    await step('PUT /e-permits/:id', () => api('PUT', `/e-permits/${wpId}`, {
      token: appTok,
      json: {
        content: `${({ hot_work: '动火', high_altitude: '高处', confined_space: '受限空间', lifting: '吊装' })[type] || type}作业-8月下旬`,
        location: `${area.name} ${randInt(1, 8)}号作业点`,
        operatorNames: ['张工', '王工'], supervisorName: '专职监护人', supervisorContact: '13900000000',
        startTime: ps.toISOString(), endTime: pe.toISOString(),
      },
    }));
    if (['hot_work', 'high_altitude', 'confined_space', 'lifting'].includes(type)) {
      const fd = new FormData();
      fd.append('file', new Blob([Buffer.from('%PDF-1.4\n%%EOF')], { type: 'application/pdf' }), `cert-${randomUUID().slice(0, 8)}.pdf`);
      fd.append('issuer', '应急管理局特种作业操作证');
      await step('certificates', () => api('POST', `/e-permits/${wpId}/certificates`, { token: appTok, form: fd }));
    }
    await step('submit', () => api('POST', `/e-permits/${wpId}/submit`, { token: appTok }));
    const wpStatus = async () => (await api('GET', `/e-permits/${wpId}`, { token: await tokenOf('admin') })).json.status;
    let st = await wpStatus();
    if (st === 'pending_review') {
      await step('review', () => api('PUT', `/e-permits/${wpId}/review`, { token: revTok, json: { approve: true, opinion: '同意' } }));
      st = await wpStatus();
    }
    if (st === 'ehs_reviewing') {
      await step('approve-ehs', () => api('PUT', `/e-permits/${wpId}/approve-ehs`, { token: ehsTok, json: { approve: true, opinion: 'EHS通过' } }));
      st = await wpStatus();
    }
    if (st === 'reviewing') {
      await step('approve', () => api('PUT', `/e-permits/${wpId}/approve`, { token: mgrTok, json: { approve: true, opinion: '批准' } }));
      st = await wpStatus();
    }
    if (st !== 'approved') throw new Error(`审批后状态异常: ${st}`);
    await step('start', () => api('PUT', `/e-permits/${wpId}/start`, { token: appTok }));
    if (type === 'hot_work') {
      await step('checks(0h)', () => api('POST', `/e-permits/${wpId}/checks`, { token: appTok, json: { checkerName: '监火人', checkSlot: '0h', checkItems: { fire: true }, note: '动火前检查合格' } }));
    } else {
      await step('checks', () => api('POST', `/e-permits/${wpId}/checks`, { token: appTok, json: { checkerName: rand(pool.applicants), checkItems: { safety: true }, note: '现场检查合格' } }));
    }
    t.actual = (await api('GET', `/e-permits/${wpId}`, { token: await tokenOf('admin') })).json.status;
    return t;
  } catch (e) { t.issue = t.issue || e.message; return t; }
}

async function main() {
  log('=== 补充 8/21~8/25 进行中作业 ===');
  const pool = await loadPools();
  const results = [];
  // 10 张常规 printed：start 分布在 8/21~8/23，end 在 8/24~8/25
  for (let i = 0; i < 10; i++) {
    const spec = { startOffset: randInt(0, 2), endOffset: randInt(0, 1) };
    const r = await createRoutinePrinted(pool, spec);
    results.push(r);
    log(`[常规 ${i + 1}/10] ${r.no || '???'} ${r.issue ? '!! ' + r.issue : '-> ' + r.actual}`);
  }
  // 取 2 张常规票作父票
  const parents = results.filter((r) => r.wpId && r.actual === 'printed').slice(0, 2);
  log(`父常规票: ${parents.map((p) => p.no).join(', ')}`);
  // 2 张危险 printed 挂父票
  const hazardSpecs = [
    { type: 'hot_work' }, { type: 'confined_space' },
  ];
  for (let i = 0; i < hazardSpecs.length; i++) {
    const parent = parents[i % parents.length];
    const det = (await api('GET', `/e-permits/${parent.wpId}`, { token: await tokenOf('admin') })).json;
    const r = await createHazardPrinted(pool, hazardSpecs[i], { wpId: parent.wpId, ps: det.startTime, pe: det.endTime });
    results.push(r);
    log(`[危险 ${i + 1}/2] ${r.no || '???'} ${r.issue ? '!! ' + r.issue : '-> ' + r.actual}`);
  }
  const fail = results.filter((r) => r.issue);
  const ok = results.filter((r) => r.actual === 'printed');
  log(`\n新增总数: ${results.length}, 成功执行中: ${ok.length}, 失败: ${fail.length}`);
  for (const r of fail) log(`  !! ${r.no || r.wpId} ${r.kind}/${r.type}: ${r.issue}`);
}

main().catch((e) => { console.error('主流程异常:', e); process.exit(1); });
