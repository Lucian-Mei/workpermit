import { and, eq, isNotNull } from 'drizzle-orm';
import * as schema from '@/database/schema';

/** 按用户姓名查邮箱，复用于审批通知。返回 null 表示未找到。 */
export async function emailByName(
  db: any,
  name?: string | null,
): Promise<string | null> {
  if (!name) return null;
  const [u] = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.name, name))
    .limit(1);
  return u?.email || null;
}

/**
 * 按部门名取该部门全部在职人员邮箱（用于「抄送 EHS」这类部门级知会）。
 * 无人或无邮箱时返回空数组，调用方据此静默跳过，不阻断业务。
 */
export async function emailsByDepartment(db: any, deptName?: string | null): Promise<string[]> {
  if (!deptName) return [];
  try {
    const rows = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(and(eq(schema.users.department, deptName), eq(schema.users.status, 'active'), isNotNull(schema.users.email)));
    return rows.map((r: any) => r.email).filter((e: any) => !!e);
  } catch {
    return [];
  }
}
