import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as dotenv from 'dotenv';

dotenv.config();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // 生产环境用容器注入的环境变量；本地开发可放 .env
      envFilePath: process.env.NODE_ENV === 'production' ? undefined : ['.env', '.env.local'],
    }),
  ],
  exports: [ConfigModule],
})
export class AppConfigModule {}
