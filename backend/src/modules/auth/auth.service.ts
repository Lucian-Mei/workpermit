import { Injectable, UnauthorizedException, BadRequestException, HttpException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, or, isNull, isNotNull, lt } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import * as schema from '@/database/schema';
import { pinyin } from 'pinyin-pro';

// S07：令牌时效
// - Access Token：短期（默认 30 分钟），泄露窗口小，前端 Bearer 携带。
// - Refresh Token：长期（默认 7 天），仅存 SHA-256 哈希于库，置于 HttpOnly Cookie，支持轮换/吊销。
const ACCESS_TOKEN_TTL = process.env.JWT_EXPIRES_IN || '30m';
const REFRESH_TOKEN_TTL_MS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 7) * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_LEN = 48; // randomBytes 字节数 -> base64url 约 64 字符

// S08：登录防爆破（内存计数，窗口 10 分钟；当前为单实例部署，多实例需换共享存储）
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS_PER_IP_ACCOUNT = 8; // 同一 IP + 同一账号
const MAX_FAILS_PER_IP = 30; // 同一 IP 整体
const MAX_FAILS_PER_ACCOUNT = 20; // 同一账号（防换 IP 爆破）
const loginFailMap = new Map<string, { n: number; first: number }>();

// 登录与密码管理。账号用户名 = 姓名拼音，密码由系统下发。
@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    private jwt: JwtService,
  ) {}

  // 由姓名生成拼音账号（重名自动加序号）
  async genUsername(name: string): Promise<string> {
    const base = pinyin(name, { toneType: 'none', type: 'array' }).join('').toLowerCase();
    let candidate = base;
    let i = 1;
    while (true) {
      const exist = await this.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, candidate)).limit(1);
      if (exist.length === 0) return candidate;
      candidate = `${base}${i++}`;
    }
  }

  // 生成随机初始密码（系统下发）
  genRandomPassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let pwd = '';
    for (let i = 0; i < 10; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
    return pwd;
  }

  async hash(pwd: string): Promise<string> {
    return bcrypt.hash(pwd, 10);
  }

  // 支持用 账号 / 邮箱 / 电话 任一方式登录，密码一致
  async login(loginKey: string, password: string, ip?: string, ua?: string) {
    const key = String(loginKey || '').trim().toLowerCase();
    const clientIp = ip || '';
    this.assertNotBlocked(clientIp, key);

    const rows = await this.db
      .select()
      .from(schema.users)
      .where(
        or(
          eq(schema.users.username, key),
          eq(schema.users.email, key),
          eq(schema.users.phone, key),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      this.recordFail(clientIp, key);
      throw new UnauthorizedException('账号/邮箱/电话或密码错误');
    }
    const u = rows[0];
    if (u.status !== 'active') throw new UnauthorizedException('账号已停用');
    const ok = await bcrypt.compare(password, u.passwordHash);
    if (!ok) {
      this.recordFail(clientIp, key);
      throw new UnauthorizedException('账号或密码错误');
    }
    this.clearFail(clientIp, key);

    const user = await this.buildUserPayload(u);
    const accessToken = await this.jwt.sign({
      sub: u.id,
      username: u.username,
      name: u.name,
      roles: user.roles,
      mustChange: u.mustChangePassword,
      type: 'access',
    });
    // 签发刷新令牌（明文仅回写 HttpOnly Cookie，库内仅存哈希）
    const refreshToken = await this.issueRefreshToken(u.id, ua, clientIp);
    return { accessToken, refreshToken, user };
  }

  // 组装返回给前端的用户载荷（登录 / 刷新 复用，避免重复拼装）
  private async buildUserPayload(u: any) {
    const perms = await this.loadPerms(u.id);
    const managed = await this.loadManagedDepartments(u.id);
    const roles = await this.loadRoles(u.id);
    return {
      id: u.id,
      username: u.username,
      name: u.name,
      department: u.department,
      roles,
      mustChangePassword: u.mustChangePassword,
      permissions: perms,
      managedDepartments: managed,
    };
  }

  // —— S07 刷新令牌：生成 / 轮换 / 吊销 ——
  private genRefreshToken(): string {
    return crypto.randomBytes(REFRESH_TOKEN_LEN).toString('base64url');
  }

  private hashToken(t: string): string {
    return crypto.createHash('sha256').update(t).digest('hex');
  }

  // 签发一条刷新令牌，仅返回明文；库内仅存 sha256 哈希
  private async issueRefreshToken(userId: string, ua?: string, ip?: string): Promise<string> {
    const plain = this.genRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await this.db.insert(schema.refreshTokens).values({
      userId,
      tokenHash: this.hashToken(plain),
      expiresAt,
      ua: ua ?? null,
      ip: ip ?? null,
    });
    // R8：惰性清理已过期/已吊销的刷新令牌，防止表长期膨胀（fire-and-forget，不影响本次登录）
    this.purgeExpiredRefreshTokens().catch(() => {});
    return plain;
  }

  // R8：删除已过期或已吊销的刷新令牌（登录/签发新令牌时惰性调用）
  private async purgeExpiredRefreshTokens(): Promise<void> {
    await this.db
      .delete(schema.refreshTokens)
      .where(or(lt(schema.refreshTokens.expiresAt, new Date()), isNotNull(schema.refreshTokens.revokedAt)));
  }

  /**
   * 用旧刷新令牌换取新的 Access Token + 新刷新令牌（轮换）。
   * 安全：旧令牌一旦使用立即标记 revoked_at + replaced_by，重放同一令牌将失败（一次性）。
   * 返回 { accessToken, refreshToken, user }，其中 user 为最新用户载荷（含权限）。
   */
  async rotateRefreshToken(oldPlain: string, ua?: string, ip?: string) {
    if (!oldPlain) throw new UnauthorizedException('缺少刷新令牌');
    const hash = this.hashToken(oldPlain);
    const recs = await this.db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, hash))
      .limit(1);
    const rec = recs[0];
    if (!rec) throw new UnauthorizedException('刷新令牌无效');
    if (rec.revokedAt) throw new UnauthorizedException('刷新令牌已吊销');
    if (rec.expiresAt.getTime() < Date.now()) throw new UnauthorizedException('刷新令牌已过期');

    const u = await this.loadRawUser(rec.userId);
    if (!u || u.status !== 'active') {
      // 账号不存在/已停用：吊销该令牌，拒绝续期
      await this.db.update(schema.refreshTokens).set({ revokedAt: new Date() }).where(eq(schema.refreshTokens.id, rec.id));
      throw new UnauthorizedException('账号已失效');
    }

    // 先签发新令牌（拿到新 id 回填 replaced_by）
    const newPlain = this.genRefreshToken();
    const newHash = this.hashToken(newPlain);
    const newExpires = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    const ins = await this.db
      .insert(schema.refreshTokens)
      .values({ userId: u.id, tokenHash: newHash, expiresAt: newExpires, ua: ua ?? null, ip: ip ?? null })
      .returning({ id: schema.refreshTokens.id });
    const newId = ins[0]?.id;
    // 旧令牌标记已轮换/吊销（即时失效，防重放）
    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date(), replacedBy: newId })
      .where(eq(schema.refreshTokens.id, rec.id));

    const user = await this.buildUserPayload(u);
    const accessToken = await this.jwt.sign({
      sub: u.id,
      username: u.username,
      name: u.name,
      roles: user.roles,
      mustChange: u.mustChangePassword,
      type: 'access',
    });
    return { accessToken, refreshToken: newPlain, user };
  }

  // 吊销指定刷新令牌（登出 / 单点登出）
  async revokeRefreshToken(oldPlain: string) {
    if (!oldPlain) return;
    const hash = this.hashToken(oldPlain);
    await this.db.update(schema.refreshTokens).set({ revokedAt: new Date() }).where(eq(schema.refreshTokens.tokenHash, hash));
  }

  // 吊销某用户全部刷新令牌（离职/改密后强制所有设备下线）
  async revokeAllForUser(userId: string) {
    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.refreshTokens.userId, userId), isNull(schema.refreshTokens.revokedAt)));
  }

  private async loadRawUser(userId: string) {
    const rows = await this.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    return rows[0];
  }

  // —— S08 登录限流辅助 ——
  private assertNotBlocked(ip: string, account: string) {
    const now = Date.now();
    const check = (k: string, max: number) => {
      const rec = loginFailMap.get(k);
      if (rec && now - rec.first >= FAIL_WINDOW_MS) loginFailMap.delete(k);
      if (rec && rec.n >= max) {
        const remain = Math.ceil((FAIL_WINDOW_MS - (now - rec.first)) / 60000);
        throw new HttpException(`尝试次数过多，请 ${Math.max(remain, 1)} 分钟后再试`, 429);
      }
    };
    if (ip) check(`${ip}:${account}`, MAX_FAILS_PER_IP_ACCOUNT);
    if (ip) check(ip, MAX_FAILS_PER_IP);
    check(`account:${account}`, MAX_FAILS_PER_ACCOUNT);
  }

  private recordFail(ip: string, account: string) {
    const now = Date.now();
    const bump = (k: string) => {
      const rec = loginFailMap.get(k);
      if (!rec || now - rec.first >= FAIL_WINDOW_MS) loginFailMap.set(k, { n: 1, first: now });
      else loginFailMap.set(k, { n: rec.n + 1, first: rec.first });
    };
    if (ip) bump(`${ip}:${account}`);
    if (ip) bump(ip);
    bump(`account:${account}`);
  }

  private clearFail(ip: string, account: string) {
    if (ip) loginFailMap.delete(`${ip}:${account}`);
    loginFailMap.delete(`account:${account}`);
  }

  async changePassword(userId: string, oldPwd: string, newPwd: string, ua?: string, ip?: string) {
    const rows = await this.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (rows.length === 0) throw new BadRequestException('用户不存在');
    const ok = await bcrypt.compare(oldPwd, rows[0].passwordHash);
    if (!ok) throw new BadRequestException('原密码错误');
    if (newPwd.length < 6) throw new BadRequestException('新密码至少 6 位');
    await this.db.update(schema.users).set({ passwordHash: await this.hash(newPwd), mustChangePassword: false, updatedAt: new Date() }).where(eq(schema.users.id, userId));
    // 改密后吊销该用户全部刷新令牌，强制所有其他设备重新登录（防旧令牌续期）
    await this.revokeAllForUser(userId);
    // 为当前会话重新签发令牌，避免改密后立即掉线
    const u = await this.loadRawUser(userId);
    const user = await this.buildUserPayload(u);
    const accessToken = await this.jwt.sign({
      sub: u.id,
      username: u.username,
      name: u.name,
      roles: user.roles,
      mustChange: false,
      type: 'access',
    });
    const refreshToken = await this.issueRefreshToken(userId, ua, ip);
    return { success: true, accessToken, refreshToken, user };
  }

  private async loadPerms(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ perm: schema.permissions })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
      .innerJoin(schema.rolePermissions, eq(schema.roles.id, schema.rolePermissions.roleId))
      .innerJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
      .where(eq(schema.userRoles.userId, userId));
    return Array.from(new Set(rows.map((r) => `${r.perm.subject}:${r.perm.action}`)));
  }

  async getMe(userId: string) {
    const rows = await this.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (rows.length === 0) throw new BadRequestException('用户不存在');
    const u = rows[0];
    return {
      id: u.id,
      username: u.username,
      name: u.name,
      department: u.department,
      email: u.email,
      phone: u.phone,
      roles: await this.loadRoles(u.id),
      mustChangePassword: u.mustChangePassword,
      permissions: await this.loadPerms(u.id),
      managedDepartments: await this.loadManagedDepartments(u.id),
    };
  }

  private async loadManagedDepartments(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ name: schema.departments.name })
      .from(schema.departmentManagers)
      .innerJoin(schema.departments, eq(schema.departmentManagers.departmentId, schema.departments.id))
      .where(eq(schema.departmentManagers.userId, userId));
    return rows.map((r) => r.name);
  }

  private async loadRoles(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ key: schema.roles.key })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
      .where(eq(schema.userRoles.userId, userId));
    return Array.from(new Set(rows.map((r) => r.key)));
  }
}
