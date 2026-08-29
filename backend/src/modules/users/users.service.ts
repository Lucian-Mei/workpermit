import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, ilike, and, count, desc, sql } from 'drizzle-orm';
import * as schema from '@/database/schema';
import { AuthService } from '@/modules/auth/auth.service';
import { EmailService } from '@/modules/email/email.service';

export interface CreateUserDto {
  name: string;
  department?: string;
  area?: string;
  email?: string;
  phone?: string;
  status?: string;
  managerId?: string; // 直属领导（users.id）
  roleKeys: string[]; // 角色 key 数组
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    private auth: AuthService,
    private email: EmailService,
  ) {}

  async list(params: { keyword?: string; department?: string; status?: string; page?: number; pageSize?: number }) {
    const page = params.page ?? 1;
    const pageSize = Math.min(params.pageSize ?? 20, 100);
    const offset = (page - 1) * pageSize;
    const where = [];
    if (params.keyword) where.push(ilike(schema.users.name, `%${params.keyword}%`));
    if (params.department) where.push(eq(schema.users.department, params.department));
    if (params.status) where.push(eq(schema.users.status, params.status));
    const cond = where.length ? and(...where) : undefined;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          ...schema.users,
          managerName: sql`(SELECT name FROM users m WHERE m.id = users.manager_id)`,
        })
        .from(schema.users)
        .where(cond)
        .orderBy(desc(schema.users.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ c: count() }).from(schema.users).where(cond),
    ]);

    const list = await Promise.all(
      rows.map(async (u) => {
        const roles = await this.db
          .select({ key: schema.roles.key, name: schema.roles.name })
          .from(schema.userRoles)
          .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
          .where(eq(schema.userRoles.userId, u.id));
        return { ...u, passwordHash: undefined, roles };
      }),
    );
    return { items: list, total: Number(totalRows[0]?.c ?? 0) };
  }

  // 新建员工：生成拼音账号 + 随机密码（系统下发），默认强制改密
  async create(dto: CreateUserDto) {
    if (!dto.name) throw new BadRequestException('请填写姓名');
    if (!dto.roleKeys || dto.roleKeys.length === 0) throw new BadRequestException('请至少分配一个角色');

    const username = await this.auth.genUsername(dto.name);
    const plain = this.auth.genRandomPassword();
    const passwordHash = await this.auth.hash(plain);

    // 角色批量校验
    const roles = await this.db.select().from(schema.roles).where(and(...dto.roleKeys.map((k) => eq(schema.roles.key, k))));
    if (roles.length !== dto.roleKeys.length) throw new BadRequestException('存在未知角色');

    const ins = await this.db.insert(schema.users).values({
      username,
      name: dto.name,
      passwordHash,
      email: dto.email,
      phone: dto.phone,
      department: dto.department,
      area: dto.area,
      managerId: dto.managerId || null,
      mustChangePassword: true,
      status: 'active',
    }).returning({ id: schema.users.id });

    const userId = ins[0].id;
    await this.db.insert(schema.userRoles).values(roles.map((r) => ({ userId, roleId: r.id })));

    return {
      id: userId,
      username,
      name: dto.name,
      department: dto.department,
      // 明文密码仅在创建时返回一次，供管理员线下告知员工
      plainPassword: plain,
      message: '账号已创建，初始密码请线下告知员工，首次登录需修改。',
    };
  }

  async update(id: string, dto: Partial<CreateUserDto>) {
    const exist = await this.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, id)).limit(1);
    if (!exist.length) throw new NotFoundException('用户不存在');

    const patch: any = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.department !== undefined) patch.department = dto.department;
    if (dto.area !== undefined) patch.area = dto.area;
    if (dto.email !== undefined) patch.email = dto.email;
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.managerId !== undefined) {
      if (dto.managerId && dto.managerId === id) throw new BadRequestException('不能将自己设为直属领导');
      patch.managerId = dto.managerId || null;
    }

    await this.db.update(schema.users).set(patch).where(eq(schema.users.id, id));

    if (dto.roleKeys) {
      const roles = await this.db.select().from(schema.roles).where(and(...dto.roleKeys.map((k) => eq(schema.roles.key, k))));
      if (roles.length !== dto.roleKeys.length) throw new BadRequestException('存在未知角色');
      await this.db.delete(schema.userRoles).where(eq(schema.userRoles.userId, id));
      await this.db.insert(schema.userRoles).values(roles.map((r) => ({ userId: id, roleId: r.id })));
    }
    return { success: true };
  }

  // 重置密码：生成新随机密码返回（系统下发）
  async resetPassword(id: string) {
    const exist = await this.db.select({ id: schema.users.id, email: schema.users.email, name: schema.users.name }).from(schema.users).where(eq(schema.users.id, id)).limit(1);
    if (!exist.length) throw new NotFoundException('用户不存在');
    const plain = this.auth.genRandomPassword();
    await this.db.update(schema.users).set({ passwordHash: await this.auth.hash(plain), mustChangePassword: true, updatedAt: new Date() }).where(eq(schema.users.id, id));
    // 如有邮箱则发送邮件，否则线下告知
    let msg = '密码已重置。';
    if (exist[0].email) {
      try {
        await this.email.notify('password_reset', {
          to: exist[0].email,
          name: exist[0].name || '员工',
          plainPassword: plain,
        });
        msg = `密码已重置并通过邮件发送至 ${exist[0].email}。`;
      } catch {
        msg = `密码已重置，但邮件发送失败（${exist[0].email}），请线下告知。`;
      }
    } else {
      msg = '该员工未设置邮箱，请线下告知新密码。';
    }
    return { plainPassword: plain, message: msg };
  }

  async disable(id: string) {
    await this.db.update(schema.users).set({ status: 'disabled', updatedAt: new Date() }).where(eq(schema.users.id, id));
    return { success: true };
  }

  async enable(id: string) {
    await this.db.update(schema.users).set({ status: 'active', updatedAt: new Date() }).where(eq(schema.users.id, id));
    return { success: true };
  }

  // 按姓名取邮箱（部门协调人等“按姓名关联员工账号”的场景用）
  async emailByName(name?: string | null): Promise<string | null> {
    if (!name) return null;
    const [u] = await this.db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.name, name))
      .limit(1);
    return u?.email || null;
  }

  // 批量导入（前端用 xlsx 解析 Excel/CSV 后传行数组）
  async import(rows: any[]) {
    const created: any[] = [];
    const errors: any[] = [];
    for (const r of rows || []) {
      try {
        if (!r.name) throw new Error('缺少姓名');
        const username = await this.auth.genUsername(r.name);
        const plain = this.auth.genRandomPassword();
        const roles = r.roleKeys?.length
          ? await this.db.select().from(schema.roles).where(and(...(r.roleKeys as string[]).map((k: string) => eq(schema.roles.key, k))))
          : [];
        const ins = await this.db
          .insert(schema.users)
          .values({
            username,
            name: r.name,
            passwordHash: await this.auth.hash(plain),
            email: r.email,
            phone: r.phone,
            department: r.department,
            area: r.area,
            mustChangePassword: true,
            status: 'active',
          })
          .returning({ id: schema.users.id });
        if (roles.length) {
          await this.db
            .insert(schema.userRoles)
            .values(roles.map((rl: any) => ({ userId: ins[0].id, roleId: rl.id })));
        }
        created.push({ name: r.name, username, plainPassword: plain });
      } catch (e: any) {
        errors.push({ row: r, error: e?.message || String(e) });
      }
    }
    return { created, errors, total: (rows || []).length };
  }
}
