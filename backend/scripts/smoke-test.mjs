#!/usr/bin/env node
/**
 * S20：后端冒烟测试（最小回归）
 * 覆盖：匿名公开端点 200 / 受保护端点 401 / 登录成功 / 带 token 访问 / 上传白名单拒绝。
 * 用法：
 *   BASE_URL=http://localhost:3100 ADMIN_USERNAME=admin ADMIN_PASSWORD='Admin@123456' npm run smoke
 * 退出码：全部通过 0，任一失败 1。
 */
import zlib from 'node:zlib';

const BASE = (process.env.BASE_URL || 'http://localhost:3100').replace(/\/$/, '');
const ADMIN = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PWD = process.env.ADMIN_PASSWORD || 'Admin@123456';

let failed = 0;
let passed = 0;

function ok(name) {
  passed++;
  console.log(`  ✅ ${name}`);
}
function bad(name, detail = '') {
  failed++;
  console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
}

async function request(path, { method = 'GET', token, body, form } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let payload;
  if (form) {
    headers['Content-Type'] = form.contentType;
    payload = form.body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  let text = '';
  try { text = await res.text(); } catch {}
  return { status: res.status, text };
}

// 最小真实 PNG（1x1 透明）
function realPng() {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  const idat = zlib.deflateSync(Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]));
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c;
}
function toForm(buffer, filename, mime) {
  const boundary = '----smoke' + Date.now();
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, buffer, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

console.log(`冒烟测试 → ${BASE}`);

// 1. 匿名公开端点
for (const p of ['/api/areas', '/api/hazards/captcha', '/api/public/worker-register/tasks']) {
  const r = await request(p);
  r.status === 200 ? ok(`匿名公开 ${p} → 200`) : bad(`匿名公开 ${p} → ${r.status}`, r.text.slice(0, 120));
}

// 2. 受保护端点无 token 必须 401
for (const p of ['/api/training/config', '/api/e-onsite/inspections', '/api/contractors', '/api/hazards']) {
  const r = await request(p);
  r.status === 401 ? ok(`受保护无token ${p} → 401`) : bad(`受保护无token ${p} → ${r.status}（应 401）`, r.text.slice(0, 120));
}

// 3. 登录（限流窗口内可能 429，给出明确提示）
const login = await request('/api/auth/login', { method: 'POST', body: { username: ADMIN, password: ADMIN_PWD } });
let token = '';
if (login.status === 200 || login.status === 201) {
  try { token = JSON.parse(login.text).token || ''; } catch {}
  token ? ok('管理员登录 → token 获取成功') : bad('登录返回缺少 token', login.text.slice(0, 120));
} else if (login.status === 429) {
  bad('管理员登录 → 429 限流', '10 分钟窗口内失败次数过多，请稍后再试（限流本身符合 S08 预期）');
} else {
  bad(`管理员登录 → ${login.status}`, login.text.slice(0, 120));
}

// 4. 带 token 访问
if (token) {
  const me = await request('/api/auth/me', { token });
  me.status === 200 ? ok('/api/auth/me 带token → 200') : bad(`/api/auth/me → ${me.status}`, me.text.slice(0, 120));
  const tcfg = await request('/api/training/config', { token });
  tcfg.status === 200 ? ok('/api/training/config 带token → 200') : bad(`/api/training/config 带token → ${tcfg.status}`);
}

// 5. 上传白名单
const fake = await request('/api/files/anonymous-upload', { method: 'POST', form: toForm(Buffer.from('<html><script>alert(1)</script></html>'), 'x.jpg', 'image/jpeg'), });
fake.status === 400 ? ok('上传伪装 jpeg → 400 拒绝') : bad(`上传伪装 jpeg → ${fake.status}（应 400）`, fake.text.slice(0, 120));
const png = await request('/api/files/anonymous-upload', { method: 'POST', form: toForm(realPng(), 'ok.png', 'image/png') });
png.status === 200 || png.status === 201 ? ok('上传真实 PNG → 2xx') : bad(`上传真实 PNG → ${png.status}`, png.text.slice(0, 120));

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
