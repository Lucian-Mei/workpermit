import {
  Controller,
  Post,
  Body,
  Get,
  Ip,
  Req,
  Res,
  Headers,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { AuthService } from './auth.service';
// @Allow()：声明字段在白名单校验下被保留（剥离未声明字段，防批量赋值），暂不强制值规则
import { Allow } from 'class-validator';

class LoginDto {
  @Allow() username: string;
  @Allow() password: string;
}
class ChangePwdDto {
  @Allow() oldPassword: string;
  @Allow() newPassword: string;
}

// S07：刷新令牌 Cookie 配置
// - httpOnly：JS 无法读取，防 XSS 窃取长期凭证
// - path=/api：仅随后端接口请求携带，不污染静态资源
// - sameSite=lax：防 CSRF 基础防护
// - secure：仅在生产 HTTPS 下开启（沙箱为 http，置 false 否则 Cookie 不生效）
const RT_COOKIE = 'ehs_rt';
const RT_MAX_AGE_MS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 7) * 24 * 60 * 60 * 1000;

function rtCookieOptions(): Partial<import('express').CookieOptions> {
  const secure = process.env.COOKIE_SECURE === 'true';
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/api',
    maxAge: RT_MAX_AGE_MS,
  };
}

function getCookie(req: Request, name: string): string | undefined {
  const raw = req.headers?.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === name) return decodeURIComponent(v);
  }
  return undefined;
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Post('login')
  async login(
    @Body() body: LoginDto,
    @Ip() ip?: string,
    @Headers('user-agent') ua?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (!body.username || !body.password) throw new UnauthorizedException('请输入账号和密码');
    const { accessToken, refreshToken, user } = await this.auth.login(body.username, body.password, ip, ua);
    // 刷新令牌写入 HttpOnly Cookie（明文不落前端 JS 存储）
    res?.cookie(RT_COOKIE, refreshToken, rtCookieOptions());
    return { token: accessToken, user };
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Ip() ip?: string,
    @Headers('user-agent') ua?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const oldToken = getCookie(req, RT_COOKIE);
    if (!oldToken) throw new UnauthorizedException('无刷新令牌');
    const result = await this.auth.rotateRefreshToken(oldToken, ua, ip);
    // 轮换：下发新刷新令牌 Cookie，旧令牌立即失效（防重放）
    res?.cookie(RT_COOKIE, result.refreshToken, rtCookieOptions());
    return { token: result.accessToken, user: result.user };
  }

  @Public()
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const oldToken = getCookie(req, RT_COOKIE);
    if (oldToken) await this.auth.revokeRefreshToken(oldToken);
    res?.clearCookie(RT_COOKIE, { path: '/api' });
    return { success: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: any) {
    return this.auth.getMe(user.userId);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @CurrentUser() user: any,
    @Body() body: ChangePwdDto,
    @Ip() ip?: string,
    @Headers('user-agent') ua?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result = await this.auth.changePassword(user.userId, body.oldPassword, body.newPassword, ua, ip);
    res?.cookie(RT_COOKIE, result.refreshToken, rtCookieOptions());
    return { token: result.accessToken, user: result.user };
  }
}
