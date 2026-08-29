# 后端镜像：先在 builder 阶段编译，再丢进精简运行镜像
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# 备份需要 pg_dump（退化 JSON 时也够用）
RUN apk add --no-cache postgresql-client
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
# tsconfig-paths 运行时解析 @/ 别名需要 tsconfig.json；主迁移 SQL（drizzle/0000_*.sql）需要在镜像内
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/drizzle ./drizzle
# 上传目录与备份目录用数据卷挂载，不进镜像
RUN mkdir -p /app/uploads /app/backups
EXPOSE 3000
# 迁移机制统一：应用启动时由 database.module 执行幂等 SQL（主迁移 + 补充迁移，双驱动通用），
# 不再依赖 drizzle-kit push（避免 schema.ts 与补充 SQL 漂移导致的意外 DDL）。
CMD ["node", "-r", "tsconfig-paths/register", "dist/main.js"]
