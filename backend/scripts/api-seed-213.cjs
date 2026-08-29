/**
 * 通过 HTTP API 批量创建 213 份电子化作业票申请（FOR001）
 * 覆盖 9 种作业类型 × 10 种状态，均匀分布
 *
 * 关键发现（代码审查）：
 * 1. e-applications 的 review/approve body 字段是 { approve: boolean } 不是 { approved: boolean }
 * 2. e-applications 没有 approve-ehs 端点；approve-ehs 在 e-permits（危险作业票）上
 * 3. involvesHazardous=true 时 submit 会检查 workPermits 表是否有子票记录（count > 0）
 * 4. 创建 e-permit 时传 applicationId 会自动设置父申请单 involvesHazardous=true
 * 5. e-permit submit 要求父申请单 status='approved'|'completed'
 * 6. e-permit submit 要求：content、operatorNames、startTime+endTime(≤24h)、supervisorName(危险)、证书照片
 * 7. e-application print 时检查所有关联 e-permit 状态是否 approved/completed/executing
 * 8. e-application archive 检查每日巡检 + FOR002 培训（可能失败，报为 issue）
 * 9. planStart/planEnd 间距 ≤ 7×24=168 小时
 *
 * 运行：node scripts/api-seed-213.cjs
 * 前提：后端在 localhost:3100 运行
 */
const BASE = 'http://localhost:3100/api';

const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ⭐ 创建/流转会 fire-and-forget 触发 email.notify()（内部多次 DB 读），与下一请求
// 并发访问单连接 PGlite 会崩溃。每次请求后留出串行窗口让 notify 的 DB 读完成。
const DELAY = 40;

const AREAS = ['一号厂房冲压区','二号厂房装配区','危化品专用库','成品立体仓库','综合楼报告厅','厂东物流主通道','高压配电室','锅炉房泵房区','分子楼红区实验室','试剂楼PCR实验室','仪器楼生产区','厂前区充电站'];
const LOCATIONS = ['北侧消防通道','1#配电柜','冲压线','检修平台','乙醇暂存区','喷涂区','货架区','设备端子','变压器室','临边','焊机区','通风机房','登高梯','控制柜','吊板','压力表','常温库','冷库','办公区'];
const DEPTS = ['生产一部','生产二部','机修保障部','物流配送部','安环监察部','质检管控部','研发中心','基建工程部','行政人事部','承包商管理部'];
const OPERATORS = ['赵敏','周强','孙丽','吴军','郑涛','何星','李娜','董磊','王强','刘敏','陈浩','杨雪'];
const SUPERVISORS = ['王刚','李伟','薛梅','杨帆','郭华','刘洋'];

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

// 10 种状态（去掉 ehs_reviewing——它是 e-permit 子票状态，不是申请单状态）
const STATUSES = ['draft','pending_review','reviewing','approved','printed','paused','finished','completed','voided','rejected'];

// 危险作业申请单流转路径（每个状态需要调用的 API 序列）
// 注意：'approve-wp' 是虚拟步骤，表示在此处先完成关联危险作业票的审批
const FLOWS_HAZARDOUS = {
  draft:          [],
  pending_review: ['submit'],
  reviewing:      ['submit', 'review'],                     // review(approve=true) → reviewing
  approved:       ['submit', 'review', 'approve'],           // review → reviewing, approve → approved
  printed:        ['submit', 'review', 'approve', 'approve-wp', 'print'],
  paused:         ['submit', 'review', 'approve', 'approve-wp', 'print', 'pause'],
  finished:       ['submit', 'review', 'approve', 'approve-wp', 'print', 'finish'],
  completed:      ['submit', 'review', 'approve', 'approve-wp', 'print', 'finish', 'archive'],
  voided:         ['submit', 'void'],
  rejected:       ['submit', 'review'],                     // review(approve=false) → rejected
};

// 非危险作业申请单流转路径（review 直接到 approved，无 approve 步骤）
const FLOWS_NON_HAZARDOUS = {
  draft:          [],
  pending_review: ['submit'],
  reviewing:      ['submit', 'review'],     // ⚠ 非危险 review→approved，无法停在 reviewing
  approved:       ['submit', 'review'],     // review(approve=true) → approved
  printed:        ['submit', 'review', 'print'],
  paused:         ['submit', 'review', 'print', 'pause'],
  finished:       ['submit', 'review', 'print', 'add-training', 'finish'],
  completed:      ['submit', 'review', 'print', 'add-training', 'finish', 'archive'],
  voided:         ['submit', 'void'],
  rejected:       ['submit', 'review'],     // review(approve=false) → rejected
};

// 最小 1x1 PNG（用于上传作业证书照片）
const MINIMAL_PNG = Buffer.from([
  0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,
  0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,
  0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,
  0x08,0x06,0x00,0x00,0x00,0x1F,0x15,0xC4,
  0x89,0x00,0x00,0x00,0x0D,0x49,0x44,0x41,
  0x54,0x78,0x9C,0x63,0x00,0x01,0x00,0x00,
  0x05,0x00,0x01,0x0D,0x0A,0x2D,0xB4,0x00,
  0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,
  0x42,0x60,0x82
]);

async function api(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
      await sleep(DELAY); // 串行窗口，规避 fire-and-forget notify 的并发 PGlite 访问
      return { ok: res.ok, status: res.status, data: json };
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (attempt + 1));
    }
  }
  return { ok: false, status: 0, data: { message: `网络失败: ${lastErr && lastErr.message}` } };
}

async function uploadCert(token, permitId) {
  try {
    const formData = new FormData();
    const blob = new Blob([MINIMAL_PNG], { type: 'image/png' });
    formData.append('file', blob, 'cert.png');
    formData.append('issuer', '模拟发证机关');
    const res = await fetch(`${BASE}/e-permits/${permitId}/certificates`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function approveWorkPermit(token, wpId, typeMeta) {
  // 1. 更新作业票内容
  const now = Date.now();
  const startTime = new Date(now).toISOString();
  const endTime = new Date(now + 12 * 3600000).toISOString(); // 12 小时内（≤24h 限制）
  const updateRes = await api('PUT', `/e-permits/${wpId}`, token, {
    content: pick(typeMeta.items),
    area: pick(AREAS),
    location: pick(LOCATIONS),
    operatorNames: [pick(OPERATORS), pick(OPERATORS)],
    supervisorName: pick(SUPERVISORS),
    supervisorContact: `138${String(rnd(10000000, 99999999))}`,
    operatorContact: `139${String(rnd(10000000, 99999999))}`,
    startTime,
    endTime,
  });
  if (!updateRes.ok) return { ok: false, error: `更新作业票失败: ${updateRes.data.message || JSON.stringify(updateRes.data).slice(0, 100)}` };

  // 2. 上传证书照片（危险作业必须）
  const certOk = await uploadCert(token, wpId);
  if (!certOk) return { ok: false, error: '上传作业证书照片失败' };

  // 3. 提交作业票（要求父申请单已 approved）
  const submitRes = await api('POST', `/e-permits/${wpId}/submit`, token, {});
  if (!submitRes.ok) return { ok: false, error: `提交作业票失败: ${submitRes.data.message || JSON.stringify(submitRes.data).slice(0, 100)}` };

  // 4. 审核通过 → ehs_reviewing
  const reviewRes = await api('PUT', `/e-permits/${wpId}/review`, token, { approve: true, opinion: '审核合格。' });
  if (!reviewRes.ok) return { ok: false, error: `作业票审核失败: ${reviewRes.data.message || JSON.stringify(reviewRes.data).slice(0, 100)}` };

  // 5. EHS 审批通过 → reviewing
  const ehsRes = await api('PUT', `/e-permits/${wpId}/approve-ehs`, token, { approve: true, opinion: 'EHS审批通过。' });
  if (!ehsRes.ok) return { ok: false, error: `EHS审批失败: ${ehsRes.data.message || JSON.stringify(ehsRes.data).slice(0, 100)}` };

  // 6. 经理批准 → approved
  const apprRes = await api('PUT', `/e-permits/${wpId}/approve`, token, { approve: true, opinion: '批准。' });
  if (!apprRes.ok) return { ok: false, error: `作业票批准失败: ${apprRes.data.message || JSON.stringify(apprRes.data).slice(0, 100)}` };

  return { ok: true };
}

async function main() {
  // 1. 登录
  console.log('登录中...');
  const loginRes = await api('POST', '/auth/login', null, { username: 'admin', password: 'Admin@123456' });
  if (!loginRes.ok) { console.error('登录失败:', loginRes.data); process.exit(1); }
  const token = loginRes.data.token;
  console.log('登录成功');

  // 2. 清理由独立脚本 clean-eapps.cjs 负责，此处跳过

  // 3. 生成计划：每种类型 30 份 completed + 20 份分布在不同状态 = 50/类型 × 9 = 450 条
  const COMPLETED_PER_TYPE = 30;
  const OTHER_PER_TYPE = 20;
  // 非 completed 的其他状态（非危险类型跳过 reviewing——业务上无法停留）
  const STATES_OTHER = ['draft', 'pending_review', 'reviewing', 'approved', 'printed', 'paused', 'finished', 'voided', 'rejected'];
  const plan = [];
  let seq = 0;
  for (const type of WP_TYPES) {
    // 30 份 completed（完结/归档）
    for (let i = 0; i < COMPLETED_PER_TYPE; i++) {
      seq++;
      plan.push({ seq, type: type.key, status: 'completed', isHazardous: type.hazardous, meta: type });
    }
    // 20 份轮流分布在其他状态
    const states = type.hazardous ? STATES_OTHER : STATES_OTHER.filter(s => s !== 'reviewing');
    for (let i = 0; i < OTHER_PER_TYPE; i++) {
      seq++;
      const status = states[i % states.length];
      plan.push({ seq, type: type.key, status, isHazardous: type.hazardous, meta: type });
    }
  }
  // 打乱顺序，模拟真实混合申请
  for (let i = plan.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [plan[i], plan[j]] = [plan[j], plan[i]];
  }

  // 统计
  const typeDist = {}, statusDist = {};
  plan.forEach(p => {
    typeDist[p.type] = (typeDist[p.type] || 0) + 1;
    statusDist[p.status] = (statusDist[p.status] || 0) + 1;
  });
  console.log(`\n计划：${plan.length} 条`);
  console.log('类型分布:', JSON.stringify(typeDist));
  console.log('状态分布:', JSON.stringify(statusDist));

  // 4. 逐条创建
  let success = 0, failed = 0;
  const issues = [];
  const statusResults = {}; // 记录每条最终状态

  for (const item of plan) {
    const meta = item.meta;
    const area = pick(AREAS);
    const dept = pick(DEPTS);
    const now = Date.now();
    // ⭐ 修复：planStart 到 planEnd 间距 ≤ 7 天
    // ⭐ 修复：planEnd 基于 planStart 计算，确保间距 ≤ 5 天（远小于 7 天限制）
    const planStartMs = now - rnd(0, 3) * 86400000;
    const planStart = new Date(planStartMs).toISOString();
    const planEnd = new Date(planStartMs + rnd(1, 5) * 86400000).toISOString();

    const jobName = `${area}·${meta.label}作业`;
    const content = pick(meta.items);

    try {
      // 创建草稿（POST 只存 permitNo/applicant/channel/status=draft）
      const createRes = await api('POST', '/e-applications', token, {});
      if (!createRes.ok) {
        failed++;
        issues.push(`[#${item.seq}] 创建失败 (${item.type}/${item.status}): ${createRes.data.message || createRes.data.raw}`);
        continue;
      }
      const appId = createRes.data.id;

      // 更新申请单：填入所有字段（createDraft 不存 content 等字段）
      const updateBody = {
        area,
        location: pick(LOCATIONS),
        department: dept,
        jobName,
        content,
        planStart,
        planEnd,
        operatorNames: [pick(OPERATORS), pick(OPERATORS)],
        supervisorName: pick(SUPERVISORS),
        supervisorContact: `138${String(rnd(10000000, 99999999))}`,
        operatorContact: `139${String(rnd(10000000, 99999999))}`,
        involvesHazardous: false, // 先设 false，创建子票时会自动设 true
      };
      const updateRes = await api('PUT', `/e-applications/${appId}`, token, updateBody);
      if (!updateRes.ok) {
        failed++;
        issues.push(`[#${item.seq}] 更新失败 (${item.type}/${item.status}): ${updateRes.data.message || JSON.stringify(updateRes.data).slice(0, 200)}`);
        continue;
      }

      // 如果是危险作业类型且目标状态不是 draft，需要创建危险作业票
      let wpId = null;
      if (item.isHazardous && item.status !== 'draft') {
        const wpCreateRes = await api('POST', '/e-permits', token, {
          type: item.type,
          applicationId: appId, // 会自动设置 app.involvesHazardous=true
        });
        if (!wpCreateRes.ok) {
          issues.push(`[#${item.seq}] 创建危险作业票失败 (${item.type}/${item.status}): ${wpCreateRes.data.message || JSON.stringify(wpCreateRes.data).slice(0, 100)}`);
          // 继续尝试提交申请单（可能失败）
        } else {
          wpId = wpCreateRes.data.id;
        }
      }

      // 流转到目标状态
      const flow = item.isHazardous
        ? (FLOWS_HAZARDOUS[item.status] || [])
        : (FLOWS_NON_HAZARDOUS[item.status] || []);

      let flowOk = true;
      let finalStatus = 'draft';

      for (let i = 0; i < flow.length; i++) {
        const step = flow[i];
        let stepBody = {};
        let stepMethod = 'PUT';

        if (step === 'submit') {
          stepMethod = 'POST';
          stepBody = {};
        } else if (step === 'review') {
          // ⭐ 修复：字段名是 approve 不是 approved
          if (item.status === 'rejected') {
            stepBody = { approve: false, opinion: '安全措施不充分，退回重新编制。' };
          } else {
            stepBody = { approve: true, opinion: '审核合格，同意进入下一环节。' };
          }
        } else if (step === 'approve') {
          stepBody = { approve: true, opinion: '批准作业。' };
        } else if (step === 'approve-wp') {
          // 虚拟步骤：审批关联的危险作业票
          if (wpId) {
            const wpResult = await approveWorkPermit(token, wpId, meta);
            if (!wpResult.ok) {
              issues.push(`[#${item.seq}] 审批危险作业票失败 (${item.type}/${item.status}): ${wpResult.error}`);
              flowOk = false;
              break;
            }
          }
          continue; // 跳过后续的 API 调用
        } else if (step === 'add-training') {
          // 虚拟步骤：为非危险作业创建 FOR002 培训记录（finish/archive 前必须）
          const trainBody = {
            trainer: pick(SUPERVISORS),
            trainingTopics: '安全操作规程、应急处置措施、个人防护用品使用',
            testResult: '合格',
            traineeNames: [pick(OPERATORS), pick(OPERATORS)],
            trainingDate: new Date().toISOString().slice(0, 10),
            remark: '模拟培训记录',
          };
          const trainRes = await api('POST', `/e-applications/${appId}/training`, token, trainBody);
          if (!trainRes.ok) {
            issues.push(`[#${item.seq}] 创建培训记录失败 (${item.type}/${item.status}): ${trainRes.data.message || JSON.stringify(trainRes.data).slice(0, 100)}`);
            // 培训创建失败不中断流程，finish 步骤会报具体错误
          }
          continue; // 跳过后续的 API 调用
        } else if (step === 'void') {
          stepBody = { voidReason: '作业计划取消，申请单作废。' };
        } else if (step === 'pause') {
          stepBody = { pauseReason: '现场条件不满足，暂停作业。' };
        } else if (step === 'finish' || step === 'archive') {
          stepBody = {};
        } else if (step === 'print') {
          stepBody = {};
        }

        const stepRes = await api(stepMethod, `/e-applications/${appId}/${step}`, token, stepBody);
        if (!stepRes.ok) {
          issues.push(`[#${item.seq}] 流转步骤 ${step} 失败 (${item.type}/${item.status}): ${stepRes.data.message || JSON.stringify(stepRes.data).slice(0, 200)}`);
          flowOk = false;
          break;
        }
        if (stepRes.data.status) finalStatus = stepRes.data.status;
      }

      // ⭐ 修复：API 部分端点不返回 status 字段，流程结束后查询实际状态
      const detailRes = await api('GET', `/e-applications/${appId}`, token);
      if (detailRes.ok && detailRes.data.status) {
        finalStatus = detailRes.data.status;
      }

      if (flowOk) {
        success++;
        statusResults[item.seq] = { target: item.status, actual: finalStatus, type: item.type, match: item.status === finalStatus };
      } else {
        success++; // 创建成功但流程可能不完整
        statusResults[item.seq] = { target: item.status, actual: finalStatus, type: item.type, match: false };
      }
    } catch (e) {
      failed++;
      issues.push(`[#${item.seq}] 异常: ${e.message}`);
    }

    // 进度报告
    if ((item.seq) % 20 === 0) {
      console.log(`  进度: ${item.seq}/${plan.length} (成功 ${success}, 失败 ${failed})`);
    }
  }

  // 5. 最终报告
  console.log('\n========== 完成 ==========');
  console.log(`总计: ${plan.length} | 成功创建: ${success} | 失败: ${failed}`);

  // 验证实际状态分布
  const verifyRes = await api('GET', '/e-applications?page=1&pageSize=1', token);
  const total = verifyRes.data?.total || '?';
  console.log(`数据库中电子申请单总数: ${total}`);

  // 状态匹配统计
  const matched = Object.values(statusResults).filter(r => r.match).length;
  const mismatched = Object.values(statusResults).filter(r => !r.match);
  console.log(`\n状态匹配: ${matched}/${plan.length} (${mismatched.length} 条状态与目标不符)`);

  if (mismatched.length > 0) {
    // 按目标状态分组
    const byTarget = {};
    mismatched.forEach(r => {
      const key = `${r.target} → ${r.actual}`;
      if (!byTarget[key]) byTarget[key] = [];
      byTarget[key].push(r);
    });
    console.log('\n状态偏差明细:');
    for (const [key, items] of Object.entries(byTarget)) {
      console.log(`  ${key}: ${items.length} 条 (类型: ${items.map(i => i.type).filter((v, i, a) => a.indexOf(v) === i).join(', ')})`);
    }
  }

  if (issues.length > 0) {
    console.log(`\n⚠️ 发现 ${issues.length} 个问题：`);
    // 按问题类型分组
    const grouped = {};
    issues.forEach(iss => {
      let key;
      if (iss.includes('审批危险作业票失败')) key = '审批危险作业票失败';
      else if (iss.includes('创建危险作业票失败')) key = '创建危险作业票失败';
      else if (iss.includes('上传作业证书')) key = '上传证书失败';
      else if (iss.includes('流转步骤')) {
        const m = iss.match(/流转步骤 (\S+) 失败/);
        key = m ? `步骤 ${m[1]} 失败` : '流转失败';
      } else if (iss.includes('更新失败')) key = '更新失败';
      else if (iss.includes('创建失败')) key = '创建失败';
      else key = '其他';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(iss);
    });
    for (const [key, items] of Object.entries(grouped)) {
      console.log(`\n  [${key}] ${items.length} 条：`);
      items.slice(0, 3).forEach(iss => console.log(`    - ${iss}`));
      if (items.length > 3) console.log(`    ... 还有 ${items.length - 3} 条`);
    }
  } else {
    console.log('\n✅ 无问题');
  }

  // 输出实际状态分布统计
  console.log('\n实际状态分布:');
  const actualDist = {};
  Object.values(statusResults).forEach(r => {
    actualDist[r.actual] = (actualDist[r.actual] || 0) + 1;
  });
  for (const [status, count] of Object.entries(actualDist).sort()) {
    console.log(`  ${status}: ${count}`);
  }

  // ⭐ 每类型 × 状态 矩阵（验证：每类型 completed ≥30 且 不同状态 ≥20）
  console.log('\n每类型实际状态矩阵 (completed / 其他状态数 / 覆盖状态种类):');
  const byType = {};
  Object.values(statusResults).forEach(r => {
    (byType[r.type] = byType[r.type] || {});
    byType[r.type][r.actual] = (byType[r.type][r.actual] || 0) + 1;
  });
  const TYPE_LABELS = { hot_work:'动火', high_altitude:'高处', confined_space:'受限空间', lifting:'起重吊装', excavation:'动土', temporary_electricity:'临时用电', blind:'盲板抽堵', road_breaking:'断路', other:'其他' };
  for (const [type, dist] of Object.entries(byType)) {
    const completed = dist.completed || 0;
    const otherStates = Object.entries(dist).filter(([s]) => s !== 'completed');
    const otherCount = otherStates.reduce((a, [, c]) => a + c, 0);
    const otherKinds = otherStates.length;
    const flag = (completed >= 30 && otherCount >= 20) ? '✓' : '✗';
    console.log(`  ${flag} ${TYPE_LABELS[type] || type}: completed=${completed}, 其他=${otherCount}(${otherKinds}种) | ${otherStates.map(([s,c])=>`${s}:${c}`).join(', ')}`);
  }
}

main().catch(e => { console.error('脚本异常:', e); process.exit(1); });
