# 前端镜像：编译后由 nginx 提供静态文件
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/conf.d/default.conf.bak 2>/dev/null || true
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
