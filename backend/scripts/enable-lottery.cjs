const http = require('http');
const BASE = 'http://localhost:3000';
function req(m, p, b, t) {
  return new Promise((res, rej) => {
    const d = b ? JSON.stringify(b) : null;
    const u = require('url').parse(BASE + p);
    const o = { method: m, hostname: u.hostname, port: u.port, path: u.path, headers: { 'Content-Type': 'application/json' } };
    if (t) o.headers['Authorization'] = 'Bearer ' + t;
    if (d) o.headers['Content-Length'] = Buffer.byteLength(d);
    const q = http.request(o, (r) => { let s = ''; r.on('data', (c) => (s += c)); r.on('end', () => res({ status: r.statusCode, body: s })); });
    q.on('error', rej); if (d) q.write(d); q.end();
  });
}
(async () => {
  const L = await req('POST', '/api/auth/login', { username: 'admin', password: 'Admin@123456' });
  const tk = JSON.parse(L.body).token;
  const cfg = await req('GET', '/api/lottery/config', null, tk);
  console.log('config before:', cfg.body);
  const save = await req('PUT', '/api/lottery/config', {
    enabled: true, name: '隐患上报抽奖', description: '提交隐患后参与抽奖',
    prizes: [{ label: '一等奖', weight: 1 }, { label: '二等奖', weight: 3 }, { label: '三等奖', weight: 6 }, { label: '谢谢参与', weight: 90 }],
  }, tk);
  console.log('save:', save.status, save.body);
  const draw = await req('POST', '/api/lottery/draw', { source: 'hazard', refId: 'test', refNo: 'TEST-1' }, tk);
  console.log('draw:', draw.body);
  const my = await req('GET', '/api/lottery/my', null, tk);
  console.log('my wins:', my.body);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
