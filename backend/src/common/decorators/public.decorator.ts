import { SetMetadata } from '@nestjs/common';

// 用法：@Public() 标记后，该接口不做 JWT 校验（如微信免登录上报）
export const IS_PUBLIC_KEY = 'is_public';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
