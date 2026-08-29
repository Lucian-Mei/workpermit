import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '@/database/schema';

export interface DeptDto {
  name: string;
  abbreviation?: string;
  responsiblePerson?: string;
  coordinator?: string; // 协调人（按姓名关联员工账号，邮箱取自员工账号）
  managerUserIds?: string[]; // 部门负责人（多对多）
  defaultRectifierId?: string; // 默认整改人员
}

@Injectable()
export class DepartmentsService {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  async list() {
    const rows = await this.db.select().from(schema.departments).orderBy(schema.departments.name);
    const managers = await this.db
      .select({
        departmentId: schema.departmentManagers.departmentId,
        userId: schema.users.id,
        userName: schema.users.name,
      })
      .from(schema.departmentManagers)
      .innerJoin(schema.users, eq(schema.departmentManagers.userId, schema.users.id));
    const rectIds = rows.map((r) => r.defaultRectifierId).filter(Boolean) as string[];
    const rectifiers = rectIds.length
      ? await this.db
          .select({ id: schema.users.id, name: schema.users.name })
          .from(schema.users)
          .where(inArray(schema.users.id, rectIds))
      : [];
    const rectifierMap = new Map(rectifiers.map((r) => [r.id, r.name]));
    const map = new Map<string, { id: string; name: string }[]>();
    for (const m of managers) {
      const arr = map.get(m.departmentId) || [];
      arr.push({ id: m.userId, name: m.userName });
      map.set(m.departmentId, arr);
    }
    return rows.map((r) => ({
      ...r,
      managers: map.get(r.id) || [],
      defaultRectifierName: r.defaultRectifierId ? rectifierMap.get(r.defaultRectifierId) || null : null,
    }));
  }

  async create(dto: DeptDto) {
    if (!dto.name) throw new BadRequestException('请填写部门名称');
    const ins = await this.db
      .insert(schema.departments)
      .values({
        name: dto.name,
        abbreviation: dto.abbreviation,
        responsiblePerson: dto.responsiblePerson,
        coordinator: dto.coordinator,
        defaultRectifierId: dto.defaultRectifierId,
      })
      .returning({ id: schema.departments.id });
    const id = ins[0].id;
    if (dto.managerUserIds?.length) {
      await this.setManagers(id, dto.managerUserIds);
    }
    return { id };
  }

  async update(id: string, dto: Partial<DeptDto>) {
    const exist = await this.db.select({ id: schema.departments.id }).from(schema.departments).where(eq(schema.departments.id, id)).limit(1);
    if (!exist.length) throw new NotFoundException('部门不存在');
    const patch: any = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.abbreviation !== undefined) patch.abbreviation = dto.abbreviation;
    if (dto.responsiblePerson !== undefined) patch.responsiblePerson = dto.responsiblePerson;
    if (dto.coordinator !== undefined) patch.coordinator = dto.coordinator;
    if (dto.defaultRectifierId !== undefined) patch.defaultRectifierId = dto.defaultRectifierId || null;
    await this.db.update(schema.departments).set(patch).where(eq(schema.departments.id, id));
    if (dto.managerUserIds !== undefined) {
      await this.setManagers(id, dto.managerUserIds);
    }
    return { success: true };
  }

  private async setManagers(departmentId: string, userIds: string[]) {
    await this.db.delete(schema.departmentManagers).where(eq(schema.departmentManagers.departmentId, departmentId));
    const unique = Array.from(new Set(userIds.filter(Boolean)));
    if (unique.length) {
      await this.db.insert(schema.departmentManagers).values(unique.map((userId) => ({ departmentId, userId })));
    }
  }

  async remove(id: string) {
    await this.db.delete(schema.departmentManagers).where(eq(schema.departmentManagers.departmentId, id));
    await this.db.delete(schema.departments).where(eq(schema.departments.id, id));
    return { success: true };
  }

  // 批量导入（按名称去重）
  async import(rows: any[]) {
    const created: string[] = [];
    const errors: any[] = [];
    for (const r of rows || []) {
      try {
        if (!r.name) throw new Error('缺少部门名称');
        await this.db
          .insert(schema.departments)
          .values({ name: r.name, abbreviation: r.abbreviation, responsiblePerson: r.responsiblePerson, coordinator: r.coordinator })
          .onConflictDoNothing();
        created.push(r.name);
      } catch (e: any) {
        errors.push({ row: r, error: e?.message || String(e) });
      }
    }
    return { created, errors, total: (rows || []).length };
  }

  // 取得某用户负责的所有部门名称
  async managedDepartments(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ name: schema.departments.name })
      .from(schema.departmentManagers)
      .innerJoin(schema.departments, eq(schema.departmentManagers.departmentId, schema.departments.id))
      .where(eq(schema.departmentManagers.userId, userId));
    return rows.map((r) => r.name);
  }
}
