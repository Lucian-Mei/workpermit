import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// 用法：handle(@CurrentUser() user: AuthUser) {}
// AuthUser = { userId, username, name, permissions: string[] }
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);
