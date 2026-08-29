import { SetMetadata } from '@nestjs/common';

// 用法：@RequirePerms('hazard:view_all', 'hazard:view_own')
// 满足任意一个权限即可（OR 语义）：例如“查看全部”或“查看自己”都能进列表页。
// 权限串格式为 "subject:action"
export const REQUIRE_PERMS_KEY = 'require_perms';
export const RequirePerms = (...perms: string[]) =>
  SetMetadata(REQUIRE_PERMS_KEY, perms);
