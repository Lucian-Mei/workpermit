import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, inArray } from 'drizzle-orm';
import * as schema from '@/database/schema';
import { PERMISSIONS } from '@/common/constants/domain';

@Injectable()
export class RolesService {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  listPermissions() {
    return PERMISSIONS;
  }

  async listRoles() {
    const roles = await this.db.select().from(schema.roles).orderBy(schema.roles.key);
    return Promise.all(
      roles.map(async (r) => {
        const perms = await this.db
          .select({ p: schema.permissions })
          .from(schema.rolePermissions)
          .innerJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
          .where(eq(schema.rolePermissions.roleId, r.id));
        return { ...r, permissions: perms.map((x) => `${x.p.subject}:${x.p.action}`) };
      }),
    );
  }

  async createRole(dto: { key: string; name: string; description?: string; permissions: string[] }) {
    if (!/^[a-z0-9_]+$/.test(dto.key)) throw new BadRequestException('角色 key 只能小写字母数字下划线');
    const exist = await this.db.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.key, dto.key)).limit(1);
    if (exist.length) throw new BadRequestException('角色 key 已存在');

    const ins = await this.db.insert(schema.roles).values({ key: dto.key, name: dto.name, description: dto.description }).returning({ id: schema.roles.id });
    await this.assignPerms(ins[0].id, dto.permissions);
    return { success: true, id: ins[0].id };
  }

  async updateRolePerms(roleKey: string, permissions: string[]) {
    const role = await this.db.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.key, roleKey)).limit(1);
    if (!role.length) throw new NotFoundException('角色不存在');
    await this.assignPerms(role[0].id, permissions);
    return { success: true };
  }

  private async assignPerms(roleId: string, perms: string[]) {
    // 校验权限点合法
    const valid = new Set(PERMISSIONS.map((p) => `${p.subject}:${p.action}`));
    for (const p of perms) if (!valid.has(p)) throw new BadRequestException('未知权限点：' + p);

    await this.db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
    if (perms.length === 0) return;
    const permRows = await this.db.select().from(schema.permissions).where(inArray(schema.permissions.subject, perms.map((p) => p.split(':')[0])));
    // 精确匹配 subject:action
    const byKey = new Map(permRows.map((r) => [`${r.subject}:${r.action}`, r.id]));
    const rows = perms.map((p) => ({ roleId, permissionId: byKey.get(p)! })).filter((r) => r.permissionId);
    if (rows.length) await this.db.insert(schema.rolePermissions).values(rows);
  }

  async deleteRole(roleKey: string) {
    if (['admin', 'safety', 'approver', 'employee'].includes(roleKey)) {
      throw new BadRequestException('内置角色不可删除');
    }
    const role = await this.db.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.key, roleKey)).limit(1);
    if (!role.length) throw new NotFoundException('角色不存在');
    await this.db.delete(schema.roles).where(eq(schema.roles.id, role[0].id));
    return { success: true };
  }
}
