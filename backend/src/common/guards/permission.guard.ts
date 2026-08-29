import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERMS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { isSuperAdmin } from '../permissions';

// 校验当前登录用户是否拥有接口要求的权限
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 标注 @Public() 的接口整体放行（免登录/匿名接口无需权限校验）
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    // 系统管理员（超级管理员）永远放行
    if (isSuperAdmin(user)) return true;
    if (!user || !Array.isArray(user.permissions)) {
      throw new ForbiddenException('无访问权限');
    }
    const owned = new Set(user.permissions);
    // 满足其中任意一个即可（OR 语义）：例如“查看全部”或“查看自己”
    const ok = required.some((p) => owned.has(p));
    if (!ok) throw new ForbiddenException('无访问权限：缺少 ' + required.join(' / '));
    return true;
  }
}
