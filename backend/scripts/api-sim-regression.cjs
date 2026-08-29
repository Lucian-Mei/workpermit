/**
 * 回归模拟（本轮新增）：
 *  - 110 条隐患填报全流程（覆盖各状态）
 *  - 110 份电子化作业申请单（含危险/常规，覆盖各状态）
 *  - 常规操作 edge 测试：修改内容、暂停/恢复、输入错误、7天超时、独立办理危险作业票
 *  - 过程中记录所有问题
 *
 * 运行：node scripts/api-sim-regression.cjs
 * 前提：后端在 localhost:3100 运行（email.notify 已改为 await，单连接 PGlite 不再崩溃）
 */
const BASE = 'http://localhost:3100/api';

const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// notify 已改为 await，串行窗口可缩短，仅留极小余量防 WASM 抖动
const DELAY = 25;

const AREAS = ['一号厂房冲压区', '二号厂房装配区', '危化品专用库', '成品立体仓库', '高压配电室', '锅炉房泵房区'];
const LOCATIONS = ['北侧消防通道', '1#配电柜', '冲压线', '检修平台', '乙醇暂存区', '喷涂区', '货架区', '登高梯'];
const DEPTS = ['生产一部', '生产二部', '机修保障部', '物流配送部', '安环监察部', '质检管控部', '研发中心', '基建工程部'];
const OPERATORS = ['赵敏', '周强', '孙丽', '吴军', '郑涛', '何星', '李娜', '董磊', '王强', '刘敏'];
const SUPERVISORS = ['王刚', '李伟', '薛梅', '杨帆', '郭华', '刘洋'];

const WP_TYPES = [
  { key: 'hot_work', label: '动火作业', hazardous: true, items: ['焊接不锈钢支架，使用乙炔氧气焰，作业前清理周边易燃物并配灭火器材。', '切割更换蒸汽管道，使用乙炔焰，作业前完成管线隔离与泄压。'] },
  { key: 'high_altitude', label: '高处作业', hazardous: true, items: ['厂房屋面防水施工，登高约4米，沿临边搭设生命线并使用双钩安全带。', '外墙玻璃清洗，登高约6米，使用吊篮并检查配重。'] },
  { key: 'confined_space', label: '受限空间作业', hazardous: true, items: ['乙醇储罐内部清污，需持续气体检测与强制通风，办理进入许可。', '电缆沟内接线，需通风检测并设专职监护人。'] },
  { key: 'lifting', label: '起重吊装作业', hazardous: true, items: ['吊装大型模具入位，使用5吨行车，设吊装警戒区与指挥。', '叉车配合吊装货架，落实绑扎与试吊。'] },
  { key: 'excavation', label: '动土作业', hazardous: false, items: ['开挖电缆沟，深度约0.8米，须查明地下管线并设边坡。', '厂区管沟开挖，深度约1.2米，临近道路设硬隔离。'] },
  { key: 'temporary_electricity', label: '临时用电', hazardous: false, items: ['临时照明配电，含移动配电箱，装漏保并日检。', '设备调试临时接电，一机一闸一漏保。'] },
  { key: 'blind', label: '盲板抽堵作业', hazardous: true, items: ['管廊盲板抽堵，须按盲板图逐一确认并挂牌。', '反应釜盲板抽堵，介质为有机溶剂，置换合格。'] },
  { key: 'road_breaking', label: '断路作业', hazardous: false, items: ['厂区东门道路开挖铺设管道，设交通导向牌与硬隔离。', '物流通道路面修复，分时段施工设引导员。'] },
  { key: 'other', label: '其他作业', hazardous: false, items: ['实验室设备移位重新定位，断电挂牌设指挥。', '平台检修搭设脚手架，验收合格挂牌。'] },
];

const FLOWS_HAZARDOUS = {
  draft: [], pending_review: ['submit'], reviewing: ['submit', 'review'],
  approved: ['submit', 'review', 'approve'], printed: ['submit', 'review', 'approve', 'approve-wp', 'print'],
  paused: ['submit', 'review', 'approve', 'approve-wp', 'print', 'pause'],
  finished: ['submit', 'review', 'approve', 'approve-wp', 'print', 'finish'],
  completed: ['submit', 'review', 'approve', 'approve-wp', 'print', 'finish', 'archive'],
  voided: ['submit', 'void'], rejected: ['submit', 'review'],
};
const FLOWS_NON_HAZARDOUS = {
  draft: [], pending_review: ['submit'], reviewing: ['submit', 'review'],
  approved: ['submit', 'review'], printed: ['submit', 'review', 'print'],
  paused: ['submit', 'review', 'print', 'pause'],
  finished: ['submit', 'review', 'print', 'add-training', 'finish'],
  completed: ['submit', 'review', 'print', 'add-training', 'finish', 'archive'],
  voided: ['submit', 'void'], rejected: ['submit', 'review'],
};

const STATES_OTHER = ['draft', 'pending_review', 'reviewing', 'approved', 'printed', 'paused', 'finished', 'voided', 'rejected'];

const MINIMAL_PNG = Buffer.from([
  0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A, 0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,
  0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01, 0x08,0x06,0x00,0x00,0x00,0x1F,0x15,0xC4,
  0x89,0x00,0x00,0x00,0x0D,0x49,0x44,0x41, 0x54,0x78,0x9C,0x63,0x00,0x01,0x00,0x00,
  0x05,0x00,0x01,0x0D,0x0A,0x2D,0xB4,0x00, 0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82,
]);

async function api(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
      await sleep(DELAY);
      return { ok: res.ok, status: res.status, data: json };
    } catch (e) {
      lastErr = e; await sleep(1000 * (attempt + 1));
    }
  }
  return { ok: false, status: 0, data: { message: `网络失败: ${lastErr && lastErr.message}` } };
}

async function uploadCert(token, permitId) {
  try {
    const formData = new FormData();
    formData.append('file', new Blob([MINIMAL_PNG], { type: 'image/png' }), 'cert.png');
    formData.append('issuer', '模拟发证机关');
    const res = await fetch(`${BASE}/e-permits/${permitId}/certificates`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData,
    });
    return res.ok;
  } catch { return false; }
}

async function approveWorkPermit(token, wpId, typeMeta) {
  const now = Date.now();
  const startTime = new Date(now).toISOString();
  const endTime = new Date(now + 12 * 3600000).toISOString();
  const u = await api('PUT', `/e-permits/${wpId}`, token, {
    content: pick(typeMeta.items), area: pick(AREAS), location: pick(LOCATIONS),
    operatorNames: [pick(OPERATORS), pick(OPERATORS)], supervisorName: pick(SUPERVISORS),
    supervisorContact: `138${rnd(10000000,99999999)}`, operatorContact: `139${rnd(10000000,99999999)}`,
    startTime, endTime,
  });
  if (!u.ok) return { ok: false, error: `更新作业票失败: ${u.data.message || ''}` };
  if (!await uploadCert(token, wpId)) return { ok: false, error: '上传证书照片失败' };
  for (const [step, fn] of [
    ['submit', () => api('POST', `/e-permits/${wpId}/submit`, token, {})],
    ['review', () => api('PUT', `/e-permits/${wpId}/review`, token, { approve: true, opinion: '审核合格。' })],
    ['ehs', () => api('PUT', `/e-permits/${wpId}/approve-ehs`, token, { approve: true, opinion: 'EHS审批通过。' })],
    ['approve', () => api('PUT', `/e-permits/${wpId}/approve`, token, { approve: true, opinion: '批准。' })],
  ]) {
    const r = await fn();
    if (!r.ok) return { ok: false, error: `作业票${step}失败: ${r.data.message || ''}` };
  }
  return { ok: true };
}

// ============ 隐患 ============
const CATEGORIES = ['消防安全', '用电安全', '机械设备', '高处作业', '危化品', '职业健康', '其他'];
const RISK_LEVELS = ['normal', 'major', 'critical'];
const BUILDINGS = ['一号厂房', '二号厂房', '综合楼', '危化品库区', '动力站房', '研发中心'];
const FLOORS = ['一层', '二层', '三层', '负一层', '屋面'];
const HAZ_AREAS = ['冲压区', '装配区', '喷涂线', '配电室', '实验室红区', '立体货架区', '充电站', '物流主通道'];
const HAZ_LOC = ['北侧消防通道', '1#配电柜', '冲压线端子箱', '检修平台临边', '乙醇暂存区', '焊接工位'];
const SUBMITTERS = ['赵敏', '周强', '孙丽', '吴军', '郑涛', '何星', '李娜', '董磊'];
const ASSIGNEES = ['王刚', '李伟', '薛梅', '杨帆', '郭华', '刘洋'];
const DESC_BY_CAT = {
  消防安全: ['消防通道被货物占用，宽度不足 0.8 米。', '灭火器压力表指针进入红区，已失效需更换。', '防火门被杂物顶开无法自动闭合。'],
  用电安全: ['配电柜内接线端子发热变色，存在过载隐患。', '临时用电线路直接落地敷设，绝缘破损。', '配电箱未安装漏电保护器。'],
  机械设备: ['冲压机安全光栅失效，手部易进入危险区。', '行车限位开关损坏，存在冒顶风险。', '设备旋转部位防护罩缺失。'],
  高处作业: ['检修平台临边护栏缺失一段，坠落风险高。', '登高钢直梯护笼锈蚀断裂。', '屋面采光带无防坠网。'],
  危化品: ['乙醇暂存区无防爆照明且通风不足。', '危化品未分类存放，酸碱混放。', '气瓶未固定且瓶帽缺失。'],
  职业健康: ['喷涂岗位未配备有效防毒面具，苯系物暴露超标。', '噪声岗位未设置隔声屏障。', '打磨工位粉尘弥漫，除尘设施失效。'],
  其他: ['厂区地面油污湿滑，未设警示标识。', '安全标识牌褪色缺失。', '应急照明灯故障。'],
};
const HAZARD_PLAN = [
  { status: 'accepted', count: 70 }, { status: 'pending_assign', count: 8 }, { status: 'assigned', count: 8 },
  { status: 'rectified', count: 8 }, { status: 'dept_confirmed', count: 6 }, { status: 'rejected_dept', count: 5 },
  { status: 'rejected_ehs', count: 5 }, { status: 'cancelled', count: 8 },
];
const HAZARD_FLOWS = {
  pending_assign: [], assigned: ['assign'], rectified: ['assign', 'rectify'],
  dept_confirmed: ['assign', 'rectify', 'dept-confirm'], accepted: ['assign', 'rectify', 'dept-confirm', 'accept-pass'],
  rejected_dept: ['assign', 'rectify', 'dept-reject'], rejected_ehs: ['assign', 'rectify', 'dept-confirm', 'accept-fail'],
  cancelled: ['assign', 'cancel'],
};

async function simulateHazards(token, issues, results) {
  const plan = [];
  let seq = 0;
  for (const p of HAZARD_PLAN) for (let i = 0; i < p.count; i++) plan.push({ seq: ++seq, target: p.status });
  for (let i = plan.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [plan[i], plan[j]] = [plan[j], plan[i]]; }
  console.log(`\n--- 隐患模拟：${plan.length} 条 ---`);
  for (const item of plan) {
    const cat = pick(CATEGORIES), risk = pick(RISK_LEVELS), dept = pick(DEPTS), desc = pick(DESC_BY_CAT[cat]);
    const location = `${pick(BUILDINGS)}${pick(FLOORS)}${pick(HAZ_LOC)}`;
    const expected = item.target.startsWith('rejected') ? 'rejected' : item.target;
    try {
      const c = await api('POST', '/hazards', token, {
        description: desc, building: pick(BUILDINGS), floor: pick(FLOORS), area: pick(HAZ_AREAS),
        location, department: dept, submitterName: pick(SUBMITTERS), photos: ['https://sim.local/hazard/photo1.jpg'],
      });
      if (!c.ok) { issues.push(`[隐患#${item.seq}] 创建失败(${item.target}): ${c.data.message || c.data.raw}`); continue; }
      const id = c.data.id;
      await api('PUT', `/hazards/${id}/ai`, token, { aiCategory: cat, riskLevel: risk });
      const flow = HAZARD_FLOWS[item.target] || [];
      for (const step of flow) {
        let r;
        if (step === 'assign') r = await api('PUT', `/hazards/${id}/assign`, token, { allocatedDepartment: dept, assigneeName: pick(ASSIGNEES), deadline: new Date(Date.now() + rnd(1,7)*86400000).toISOString(), riskLevel: risk });
        else if (step === 'rectify') r = await api('PUT', `/hazards/${id}/rectify`, token, { rectificationDesc: '已按要求完成整改，隐患已消除。', rectificationFiles: ['https://sim.local/hazard/rectify1.jpg'] });
        else if (step === 'dept-confirm') r = await api('PUT', `/hazards/${id}/dept-review`, token, { result: 'confirm' });
        else if (step === 'dept-reject') r = await api('PUT', `/hazards/${id}/dept-review`, token, { result: 'reject', rejectReason: '整改不彻底，退回。' });
        else if (step === 'accept-pass') r = await api('PUT', `/hazards/${id}/accept`, token, { result: 'pass' });
        else if (step === 'accept-fail') r = await api('PUT', `/hazards/${id}/accept`, token, { result: 'fail', rejectionReason: '验收不通过。' });
        else if (step === 'cancel') r = await api('PUT', `/hazards/${id}/cancel`, token, {});
        if (!r || !r.ok) { issues.push(`[隐患#${item.seq}] 步骤 ${step} 失败(${item.target}): ${r ? r.data.message : 'no resp'}`); break; }
      }
      const d = await api('GET', `/hazards/${id}`, token);
      const actual = d.ok ? d.data.status : '?';
      results.push({ target: item.target, expected, actual, match: actual === expected });
    } catch (e) { issues.push(`[隐患#${item.seq}] 异常(${item.target}): ${e.message}`); }
  }
}

async function simulatePermits(token, issues, results) {
  // 110 份：55 危险 + 55 常规
  const plan = [];
  let seq = 0;
  const hazTypes = WP_TYPES.filter(t => t.hazardous);
  const nonHazTypes = WP_TYPES.filter(t => !t.hazardous);
  for (let i = 0; i < 55; i++) {
    const t = hazTypes[i % hazTypes.length];
    const status = STATES_OTHER[(i * 3) % STATES_OTHER.length];
    plan.push({ seq: ++seq, type: t, status });
  }
  for (let i = 0; i < 55; i++) {
    const t = nonHazTypes[i % nonHazTypes.length];
    const status = (STATES_OTHER.filter(s => s !== 'reviewing'))[(i * 3) % (STATES_OTHER.length - 1)];
    plan.push({ seq: ++seq, type: t, status });
  }
  for (let i = plan.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [plan[i], plan[j]] = [plan[j], plan[i]]; }
  console.log(`\n--- 作业票模拟：${plan.length} 份 ---`);
  for (const item of plan) {
    const meta = item.type, area = pick(AREAS), dept = pick(DEPTS), now = Date.now();
    const base = now - rnd(0, 3) * 86400000;
    const ps = new Date(base).toISOString();
    const pe = new Date(base + rnd(1, 5) * 86400000).toISOString();
    const jobName = `${area}·${meta.label}作业`, content = pick(meta.items);
    try {
      const c = await api('POST', '/e-applications', token, {});
      if (!c.ok) { issues.push(`[票#${item.seq}] 创建失败(${item.type.key}/${item.status}): ${c.data.message || c.data.raw}`); continue; }
      const appId = c.data.id;
      const u = await api('PUT', `/e-applications/${appId}`, token, {
        area, location: pick(LOCATIONS), department: dept, jobName, content, planStart: ps, planEnd: pe,
        operatorNames: [pick(OPERATORS), pick(OPERATORS)], supervisorName: pick(SUPERVISORS),
        supervisorContact: `138${rnd(10000000,99999999)}`, operatorContact: `139${rnd(10000000,99999999)}`,
        involvesHazardous: false,
      });
      if (!u.ok) { issues.push(`[票#${item.seq}] 更新失败(${item.type.key}/${item.status}): ${u.data.message || ''}`); continue; }
      let wpId = null;
      if (meta.hazardous && item.status !== 'draft') {
        const w = await api('POST', '/e-permits', token, { type: item.type.key, applicationId: appId });
        if (w.ok) wpId = w.data.id; else issues.push(`[票#${item.seq}] 创建危险作业票失败: ${w.data.message || ''}`);
      }
      const flow = meta.hazardous ? (FLOWS_HAZARDOUS[item.status] || []) : (FLOWS_NON_HAZARDOUS[item.status] || []);
      let flowOk = true, finalStatus = 'draft';
      for (const step of flow) {
        let r, body = {}, m = 'PUT';
        if (step === 'submit') { m = 'POST'; }
        else if (step === 'review') body = item.status === 'rejected' ? { approve: false, opinion: '退回。' } : { approve: true, opinion: '审核合格。' };
        else if (step === 'approve') body = { approve: true, opinion: '批准。' };
        else if (step === 'approve-wp') { if (wpId) { const rr = await approveWorkPermit(token, wpId, meta); if (!rr.ok) { issues.push(`[票#${item.seq}] 审批危险作业票失败: ${rr.error}`); flowOk = false; break; } } continue; }
        else if (step === 'add-training') { const tr = await api('POST', `/e-applications/${appId}/training`, token, { trainer: pick(SUPERVISORS), trainingTopics: '安全操作规程、应急处置、个体防护', testResult: '合格', traineeNames: [pick(OPERATORS), pick(OPERATORS)], trainingDate: new Date().toISOString().slice(0,10), remark: '模拟' }); if (!tr.ok) issues.push(`[票#${item.seq}] 培训记录失败: ${tr.data.message || ''}`); continue; }
        else if (step === 'void') body = { voidReason: '计划取消。' };
        else if (step === 'pause') body = { pauseReason: '现场条件不满足，暂停。' };
        else if (step === 'print' || step === 'finish' || step === 'archive') body = {};
        r = await api(m, `/e-applications/${appId}/${step}`, token, body);
        if (!r.ok) { issues.push(`[票#${item.seq}] 流转 ${step} 失败(${item.type.key}/${item.status}): ${r.data.message || ''}`); flowOk = false; break; }
        if (r.data.status) finalStatus = r.data.status;
      }
      const d = await api('GET', `/e-applications/${appId}`, token);
      if (d.ok && d.data.status) finalStatus = d.data.status;
      results.push({ seq: item.seq, type: item.type.key, target: item.status, actual: finalStatus, match: item.status === finalStatus });
    } catch (e) { issues.push(`[票#${item.seq}] 异常(${item.type.key}/${item.status}): ${e.message}`); }
  }
}

// ============ edge 测试 ============
async function edgeTests(token, issues, edgeResults) {
  console.log('\n--- 常规操作 edge 测试 ---');

  // 1. 修改内容：草稿创建后连续修改两次再提交
  {
    const c = await api('POST', '/e-applications', token, {});
    const id = c.data.id;
    await api('PUT', `/e-applications/${id}`, token, { jobName: '修改测试-v1', content: '初版内容', planStart: new Date().toISOString(), planEnd: new Date(Date.now()+2*86400000).toISOString(), operatorNames: ['张三'], department: '生产一部' });
    const u2 = await api('PUT', `/e-applications/${id}`, token, { jobName: '修改测试-v2', content: '修订后内容' });
    const sub = await api('POST', `/e-applications/${id}/submit`, token, {});
    const d = await api('GET', `/e-applications/${id}`, token);
    edgeResults.push({ name: '修改内容后提交', ok: u2.ok && sub.ok && d.data.status === 'pending_review', detail: `status=${d.data.status}, content=${d.data.content}` });
    if (!(u2.ok && sub.ok)) issues.push(`[edge-修改内容] 失败: ${!u2.ok ? u2.data.message : sub.data.message}`);
  }

  // 2. 暂停 / 恢复（看板场景）
  {
    const c = await api('POST', '/e-applications', token, {});
    const id = c.data.id;
    await api('PUT', `/e-applications/${id}`, token, { jobName: '暂停测试', content: '内容', planStart: new Date().toISOString(), planEnd: new Date(Date.now()+2*86400000).toISOString(), operatorNames: ['张三'], department: '生产一部' });
    await api('POST', `/e-applications/${id}/submit`, token, {});
    await api('PUT', `/e-applications/${id}/review`, token, { approve: true, opinion: '通过' });
    await api('PUT', `/e-applications/${id}/print`, token, {});
    const p = await api('PUT', `/e-applications/${id}/pause`, token, { pauseReason: '条件不满足' });
    const dp = await api('GET', `/e-applications/${id}`, token);
    const r = await api('PUT', `/e-applications/${id}/resume`, token, {});
    const dr = await api('GET', `/e-applications/${id}`, token);
    const ok = p.ok && dp.data.status === 'paused' && r.ok && dr.data.status !== 'paused';
    edgeResults.push({ name: '暂停→恢复', ok, detail: `pauseStatus=${dp.data.status}, resumeStatus=${dr.data.status}` });
    if (!ok) issues.push(`[edge-暂停/恢复] 失败: pause=${dp.data.status}, resume=${dr.data.status}`);
  }

  // 3. 输入错误：缺少作业内容直接提交
  {
    const c = await api('POST', '/e-applications', token, {});
    const id = c.data.id;
    // 只填部分字段（无 content）
    await api('PUT', `/e-applications/${id}`, token, { jobName: '缺内容测试', planStart: new Date().toISOString(), planEnd: new Date(Date.now()+2*86400000).toISOString(), operatorNames: ['张三'], department: '生产一部' });
    const sub = await api('POST', `/e-applications/${id}/submit`, token, {});
    const ok = !sub.ok && /作业内容/.test(sub.data.message || '');
    edgeResults.push({ name: '缺内容提交被拦截', ok, detail: `status=${sub.status}, msg=${sub.data.message || ''}` });
    if (!ok) issues.push(`[edge-缺内容] 未正确拦截: ${sub.status} ${sub.data.message || ''}`);
  }

  // 4. 7天超时：计划周期 10 天（后端在 update/submit 拦截）
  {
    const c = await api('POST', '/e-applications', token, {});
    const id = c.data.id;
    const u = await api('PUT', `/e-applications/${id}`, token, {
      jobName: '超时测试', content: '内容', planStart: new Date().toISOString(),
      planEnd: new Date(Date.now() + 10 * 86400000).toISOString(), operatorNames: ['张三'], department: '生产一部',
    });
    const ok = !u.ok && /7\s*天/.test(u.data.message || '');
    edgeResults.push({ name: '7天超时被拦截', ok, detail: `status=${u.status}, msg=${u.data.message || ''}` });
    if (!ok) issues.push(`[edge-7天超时] 未正确拦截: ${u.status} ${u.data.message || ''}`);
  }

  // 5. 独立办理危险作业票（先提交常规申请单，再办危险票并关联）
  {
    const c = await api('POST', '/e-applications', token, {});
    const id = c.data.id;
    await api('PUT', `/e-applications/${id}`, token, { jobName: '独立危险票测试', content: '内容', planStart: new Date().toISOString(), planEnd: new Date(Date.now()+2*86400000).toISOString(), operatorNames: ['张三'], department: '生产一部' });
    await api('POST', `/e-applications/${id}/submit`, token, {});
    await api('PUT', `/e-applications/${id}/review`, token, { approve: true, opinion: '通过' });
    // 申请单已成 approved，再办危险作业票并关联
    const w = await api('POST', '/e-permits', token, { type: 'hot_work', applicationId: id });
    let wpOk = false, wpDetail = '';
    if (w.ok) { const rr = await approveWorkPermit(token, w.data.id, WP_TYPES[0]); wpOk = rr.ok; wpDetail = rr.ok ? '危险票审批通过' : rr.error; }
    else wpDetail = w.data.message || '';
    edgeResults.push({ name: '先常规后办危险票', ok: w.ok && wpOk, detail: wpDetail });
    if (!(w.ok && wpOk)) issues.push(`[edge-独立危险票] 失败: ${wpDetail}`);
  }
}

async function main() {
  console.log('登录中...');
  const login = await api('POST', '/auth/login', null, { username: 'admin', password: 'Admin@123456' });
  if (!login.ok) { console.error('登录失败:', login.data); process.exit(1); }
  const token = login.data.token;
  console.log('登录成功');

  const issues = [];
  const hazardResults = [];
  const permitResults = [];
  const edgeResults = [];

  await simulateHazards(token, issues, hazardResults);
  await simulatePermits(token, issues, permitResults);

  // 先输出主流程报告，避免 edge 测试异常丢失主结果
  console.log('\n==================== 报告 ====================');
  console.log(`隐患：创建 ${hazardResults.length} 条，状态匹配 ${hazardResults.filter(r => r.match).length}`);
  console.log(`作业票：创建 ${permitResults.length} 份，状态匹配 ${permitResults.filter(r => r.match).length}`);

  try {
    await edgeTests(token, issues, edgeResults);
    console.log('\nEdge 测试结果：');
    edgeResults.forEach(e => console.log(`  [${e.ok ? '✓' : '✗'}] ${e.name} — ${e.detail}`));
  } catch (e) {
    console.log('\n⚠️ Edge 测试脚本异常：', e.message);
  }

  if (issues.length > 0) {
    console.log(`\n⚠️ 共发现 ${issues.length} 个问题：`);
    const grouped = {};
    issues.forEach(i => { const k = i.split(']')[0] + ']'; (grouped[k] = grouped[k] || []).push(i); });
    for (const [k, arr] of Object.entries(grouped)) {
      console.log(`\n  ${k} ${arr.length} 条：`);
      arr.slice(0, 4).forEach(i => console.log(`    - ${i}`));
      if (arr.length > 4) console.log(`    ... 还有 ${arr.length - 4} 条`);
    }
  } else {
    console.log('\n✅ 模拟过程未发现问题');
  }

  // 状态分布
  const hazDist = {}; hazardResults.forEach(r => { hazDist[r.actual] = (hazDist[r.actual]||0)+1; });
  console.log('\n隐患实际状态分布:', JSON.stringify(hazDist));
  const permDist = {}; permitResults.forEach(r => { permDist[r.actual] = (permDist[r.actual]||0)+1; });
  console.log('作业票实际状态分布:', JSON.stringify(permDist));
}

main().catch(e => { console.error('脚本异常:', e); process.exit(1); });
