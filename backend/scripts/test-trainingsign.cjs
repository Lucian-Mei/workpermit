const BASE = 'http://localhost:3100/api';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function api(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  await sleep(25);
  return { ok: res.ok, status: res.status, data: json };
}
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

(async () => {
  const login = await api('POST', '/auth/login', null, { username: 'admin', password: 'Admin@123456' });
  const token = login.data.token;
  // 1. 创建申请单 + 更新
  const c = await api('POST', '/e-applications', token, {});
  const id = c.data.id;
  await api('PUT', `/e-applications/${id}`, token, { jobName: '培训签字测试', content: '内容', planStart: new Date().toISOString(), planEnd: new Date(Date.now()+2*86400000).toISOString(), operatorNames: ['张三'], department: '生产一部' });
  // 2. 保存培训（必填项）
  const t = await api('POST', `/e-applications/${id}/training`, token, { trainer: '王培训', trainingTopics: '安全操作规程', testResult: '合格' });
  console.log('保存培训:', t.ok ? 'OK' : 'FAIL ' + t.data.message);
  // 3. 生成签字令牌
  const tk = await api('POST', `/e-applications/${id}/training/sign-tokens`, token, {});
  console.log('生成令牌:', tk.ok ? 'OK url=' + tk.data.url : 'FAIL ' + tk.data.message);
  const signToken = tk.data.token;
  // 4. GET 公开签字信息（应为 training / generic）
  const info = await api('GET', `/public/sign/${signToken}`, null, null);
  console.log('公开签字信息:', info.ok ? `targetType=${info.data.targetType}, generic=${info.data.generic}` : 'FAIL ' + info.data.message);
  // 5. 模拟两人扫码签字（通用，无姓名）
  const s1 = await api('POST', `/public/sign/${signToken}`, null, { signImg: SIG });
  const s2 = await api('POST', `/public/sign/${signToken}`, null, { signImg: SIG });
  console.log('第1人签字:', s1.ok ? 'OK' : 'FAIL ' + s1.data.message);
  console.log('第2人签字:', s2.ok ? 'OK' : 'FAIL ' + s2.data.message);
  // 6. 查看培训记录签字数
  const app = await api('GET', `/e-applications/${id}`, token, null);
  const sigs = app.data.training?.traineeSignatures || [];
  console.log('培训签字数:', sigs.length, '(应为2)');
  // 7. 完成培训签到
  const cmp = await api('POST', `/e-applications/${id}/training/complete-sign`, token, {});
  console.log('完成培训签到:', cmp.ok ? 'OK' : 'FAIL ' + cmp.data.message);
  const app2 = await api('GET', `/e-applications/${id}`, token, null);
  console.log('signCompletedAt:', app2.data.training?.signCompletedAt || '未设置');
  // 8. 负向：无签名提交应被拒
  const bad = await api('POST', `/public/sign/${signToken}`, null, {});
  console.log('空签名拦截:', !bad.ok ? `OK(${bad.status})` : 'FAIL 未拦截');
  console.log('\n=== 培训签字流程测试完成 ===');
})().catch(e => { console.error('异常:', e); process.exit(1); });
