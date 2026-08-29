import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@/database/schema';

export interface JwtPayload {
  sub: string;
  username: string;
  name: string;
  roles?: string[];
}

// 登录后把用户权限、部门负责人信息预先算好塞进 req.user，鉴权时直接比对
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    cfg: ConfigService,
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.get<string>('JWT_SECRET') || 'dev-secret',
    });
  }

  async validate(payload: JwtPayload) {
    const userId = payload.sub;
    if (!userId) throw new UnauthorizedException('无效令牌');

    // 取用户角色 -> 权限
    const rows = await this.db
      .select({ perm: schema.permissions })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
      .innerJoin(schema.rolePermissions, eq(schema.roles.id, schema.rolePermissions.roleId))
      .innerJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
      .where(eq(schema.userRoles.userId, userId));

    const perms = Array.from(new Set(rows.map((r) => `${r.perm.subject}:${r.perm.action}`)));

    // 取用户资料 + 负责部门
    const [user] = await this.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (!user) throw new UnauthorizedException('用户不存在或令牌已失效');
    // 停用账号即使持有有效 JWT 也拒绝（登录入口已校验，这里补上 token 复用拦截）
    if (user.status && user.status !== 'active') {
      throw new UnauthorizedException('账号已被停用');
    }
    const managed = await this.db
      .select({ name: schema.departments.name })
      .from(schema.departmentManagers)
      .innerJoin(schema.departments, eq(schema.departmentManagers.departmentId, schema.departments.id))
      .where(eq(schema.departmentManagers.userId, userId));
    // 角色键（用于系统管理员超级放行判定）
    const roleRows = await this.db
      .select({ key: schema.roles.key })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
      .where(eq(schema.userRoles.userId, userId));
    const roles = Array.from(new Set(roleRows.map((r) => r.key)));

    // 系统管理员（admin 角色）即超级管理员：注入 `*` 通配符，
    // 与后端 isSuperAdmin、前端 hasPerm 的超级管理员判定完全对齐，
    // 确保管理员“拥有全部权限、可执行任何操作（含代区域负责人审核/代经理批准）”。
    const permissions = roles.includes('admin') ? ['*', ...perms] : perms;

    return {
      userId,
      username: payload.username,
      name: payload.name,
      department: user?.department,
      email: user?.email,
      phone: user?.phone,
      roles,
      permissions,
      managedDepartments: managed.map((m) => m.name),
    };
  }
}
