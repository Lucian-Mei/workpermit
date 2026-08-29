const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const outfile = path.join(process.cwd(), '.gen.cjs');
execSync(`npx esbuild src/utils/printTemplatePresets.ts --bundle --format=cjs --outfile="${outfile}" --loader:.png=dataurl --external:react --log-level=error`, { stdio: 'inherit' });
const { presetTemplates } = require(outfile);
const defOut = path.join(process.cwd(), '.gen2.cjs');
execSync(`npx esbuild src/utils/printTemplate.ts --bundle --format=cjs --outfile="${defOut}" --external:react --log-level=error`, { stdio: 'inherit' });
const { defaultTemplate } = require(defOut);
const presets = presetTemplates();
const d = defaultTemplate();
const all = [...presets, d];
const map = new Map();
for (const t of all) map.set(t.id, t);
const final = [...map.values()];
const assign = {};
for (const t of final) if (t.workPermitType) assign[t.workPermitType] = t.id;
const BASE = 'http://localhost:3100/api';
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
(async () => {
  const lg = await call('POST', '/auth/login', { username: 'admin', password: 'admin123456' });
  await call('PUT', '/settings/config/print_templates', { value: JSON.stringify(final) }, lg.token);
  await call('PUT', '/settings/config/print_template_assignments', { value: JSON.stringify(assign) }, lg.token);
  let warn = 0;
  for (const t of final) {
    const maxY = t.elements.reduce((m, e) => Math.max(m, (e.y || 0) + (e.h || 0)), 0);
    const n = t.elements.filter((e) => e.type === 'text' && e.id.startsWith('m_b')).reduce((s, e) => s + (e.text || '').split('\n').length, 0);
    const flag = maxY > 275 ? '[SUPER]' : '';
    if (maxY > 275) warn++;
    console.log(` - ${t.id.padEnd(22)} | items=${n} | maxY=${Math.round(maxY)}mm ${flag}`);
  }
  console.log(`synced ${final.length} templates + ${Object.keys(assign).length} assignments; superpages: ${warn}`);
  try { fs.unlinkSync(outfile); fs.unlinkSync(defOut); } catch {}
})();
