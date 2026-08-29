import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { json } from 'express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 全局前缀
  app.setGlobalPrefix('api');

  // JSON 体大小（作业票含照片 base64 时可能较大）
  app.use(json({ limit: '25mb' }));

  // 跨域白名单（S03）：生产通过 CORS_ORIGINS（逗号分隔的精确 Origin）收紧；
  // 未配置时默认放行本机 localhost/127.0.0.1 与内网私有网段（本地/局域网部署预览用）
  const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: (origin, callback) => {
      // 无 Origin 的请求（同源、curl、移动端原生等）直接放行
      if (!origin) return callback(null, true);
      // 显式白名单优先
      if (corsOrigins.length) {
        return corsOrigins.includes(origin)
          ? callback(null, true)
          : callback(new Error('Origin not allowed by CORS'));
      }
      // 默认开发放行：本机 + 内网私有网段（任意端口）
      const ok =
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
        /^https?:\/\/(10|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+(:\d+)?$/.test(origin);
      return ok ? callback(null, true) : callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
  });

  // 静态资源：上传文件、备份文件
  const express = app.getHttpAdapter().getInstance();
  express.use('/uploads', (await import('express')).static(join(process.cwd(), 'uploads')));
  express.use('/backups', (await import('express')).static('/app/backups'));
  express.get('/health', (_req: any, res: any) => res.status(200).json({ status: 'ok' }));

  // 前端静态托管（免 Docker 部署：后端单端口同时服务前端 dist + API）
  // 优先使用环境变量 FRONTEND_DIST 指定的目录；未设置时回退到 ../frontend/dist
  const feDist =
    process.env.FRONTEND_DIST || join(process.cwd(), '..', 'frontend', 'dist');
  express.use(
    (await import('express')).static(feDist, {
      // 缓存策略：index.html / sw.js 每次校验（no-cache），带 hash 的构建资源长缓存（immutable）。
      // 避免浏览器缓存旧 index.html 导致新旧 chunk 混用、出现"临时/双布局"闪变；
      // sw.js 必须 no-cache，否则浏览器永远不更新 Service Worker（旧 SW 会一直返回缓存的旧页面）。
      setHeaders: (res: any, filePath: string) => {
        if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  // SPA fallback：非 API/上传/备份/健康检查 的 GET 请求一律回 index.html
  // 注意：带文件扩展名的静态资源请求（/assets/*.js 等）不回 index.html——
  // 否则浏览器缓存了旧 index.html（引用已删除的旧 hash chunk）时，请求旧 chunk 会拿到 HTML(200)，
  // dynamic import 解析 HTML 失败，表现为"加载失败/页面渲染出错"。
  express.get('*', (req: any, res: any, next: any) => {
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/uploads') ||
      req.path.startsWith('/backups') ||
      req.path === '/health'
    ) {
      return next();
    }
    if (/\.[a-zA-Z0-9]{1,8}$/.test(req.path)) {
      // 静态资源：不存在时交给 express 默认 404（真实 404，不返回 index.html）
      return next();
    }
    res.sendFile(join(feDist, 'index.html'), (err: any) => {
      if (err) next();
    });
  });

  // S04：全局 DTO 白名单校验。
  // - whitelist:true 剥离请求中未在 DTO 声明的字段（防批量赋值/越权字段注入）。
  // - transform:true 将载荷实例化为 DTO 类。
  // - forbidNonWhitelisted 暂不开启：多数接口 Body 为 `any`/内联类型（运行期跳过白名单），
  //   待前端字段回归审计、逐步收紧 DTO 后再启用，记入安全基线待办。
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`EHS 后端已启动：http://localhost:${port}/api`);
}

bootstrap();
