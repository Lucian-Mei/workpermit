// 清理本次 API 模拟创建的全部 electronic 渠道作业票/申请单及其子表数据
import { PGlite } from '@electric-sql/pglite';

const dataDir = 'D:/Users/45518/AppData/Local/Temp/ehs-pglite-v4';
const db = await PGlite.create({ dataDir });

const tables = [
  `DELETE FROM certificate_ocr WHERE work_permit_id IN (SELECT id FROM work_permits WHERE channel='electronic')`,
  `DELETE FROM work_permit_checks WHERE work_permit_id IN (SELECT id FROM work_permits WHERE channel='electronic')`,
  `DELETE FROM inspection_records WHERE work_permit_id IN (SELECT id FROM work_permits WHERE channel='electronic')`,
  `DELETE FROM inspection_records WHERE application_id IN (SELECT id FROM work_permit_applications WHERE channel='electronic')`,
  `DELETE FROM work_permit_trainings WHERE application_id IN (SELECT id FROM work_permit_applications WHERE channel='electronic')`,
  `DELETE FROM safety_briefings WHERE application_id IN (SELECT id FROM work_permit_applications WHERE channel='electronic')`,
  `DELETE FROM entry_registrations WHERE application_id IN (SELECT id FROM work_permit_applications WHERE channel='electronic')`,
  `DELETE FROM work_permits WHERE channel='electronic'`,
  `DELETE FROM work_permit_applications WHERE channel='electronic'`,
];

for (const q of tables) {
  try {
    await db.query(q);
  } catch (e) {
    console.log('SKIP(表可能不存在):', q.slice(0, 60), '->', e.message);
  }
}

// action_tokens：删除今天生成的、指向 application/work_permit 的令牌
try {
  await db.query(`DELETE FROM action_tokens WHERE created_at >= now() - interval '1 day'`);
} catch (e) {
  console.log('action_tokens 清理跳过:', e.message);
}

const r1 = await db.query(`SELECT count(*) AS c FROM work_permits WHERE channel='electronic'`);
const r2 = await db.query(`SELECT count(*) AS c FROM work_permit_applications WHERE channel='electronic'`);
console.log('清理后 electronic work_permits =', r1.rows[0].c, '| work_permit_applications =', r2.rows[0].c);

await db.close();
