/**
 * 一次性修复：给普通员工(employee)角色补「查看全部/部门」权限，并把所有 mock_% 员工分配该角色。
 * 解决：mock 员工无角色→403→每个列表页空白；且 employee 仅有 view_own，看不到模拟数据。
 *
 * 用法（需先停后端以释放 PGlite 目录锁）：
 *   node scripts/assign-employee-role.cjs
 */
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const DATA_DIR = path.resolve(__dirname, '..', '.pglite-data-v3');

async function main() {
  const db = await PGlite.create({ dataDir: DATA_DIR });
  console.log('已连接 PGlite:', DATA_DIR);

  // 1) employee 角色
  const roleRes = await db.query("SELECT id, key, name FROM roles WHERE key = 'employee'");
  if (!roleRes.rows.length) {
    console.error('未找到 employee 角色，终止。');
    process.exit(1);
  }
  const roleId = roleRes.rows[0].id;
  console.log('employee 角色:', roleRes.rows[0].name, roleId);

  // 2) 需要补的权限点
  const targets = [
    ['hazard', 'view_all'],
    ['hazard', 'view_department'],
    ['work_permit', 'view_all'],
    ['work_permit', 'view_department'],
  ];
  const placeholders = targets.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
  const flat = targets.flat();
  const permRes = await db.query(
    `SELECT id, subject, action FROM permissions WHERE (subject, action) IN (${placeholders})`,
    flat,
  );
  const permMap = new Map();
  for (const p of permRes.rows) permMap.set(`${p.subject}:${p.action}`, p.id);
  console.log('命中的权限点:', permRes.rows.length, '/ 期望', targets.length);

  // 3) 给 employee 角色补 role_permissions（已存在则跳过）
  let added = 0;
  for (const [subject, action] of targets) {
    const pid = permMap.get(`${subject}:${action}`);
    if (!pid) { console.warn('  缺少权限点（未初始化？）:', `${subject}:${action}`); continue; }
    const ex = await db.query('SELECT 1 FROM role_permissions WHERE role_id = $1 AND permission_id = $2', [roleId, pid]);
    if (!ex.rows.length) {
      await db.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)', [roleId, pid]);
      added += 1;
      console.log('  + 角色权限:', `${subject}:${action}`);
    }
  }
  console.log(`employee 角色新增权限 ${added} 项。`);

  // 4) 所有 mock_% 员工分配 employee 角色（已分配则跳过）
  const usersRes = await db.query(
    "SELECT id, username FROM users WHERE username LIKE 'mock_%' AND status = 'active'",
  );
  console.log(`待分配员工 ${usersRes.rows.length} 人。`);
  let linked = 0;
  for (const u of usersRes.rows) {
    const ex = await db.query('SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2', [u.id, roleId]);
    if (!ex.rows.length) {
      await db.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [u.id, roleId]);
      linked += 1;
    }
  }
  console.log(`已为 ${linked} 名员工分配 employee 角色（其余已分配，跳过）。`);

  await db.close();
  console.log('完成。');
}

main().catch((e) => { console.error('ERROR', e); process.exit(1); });
