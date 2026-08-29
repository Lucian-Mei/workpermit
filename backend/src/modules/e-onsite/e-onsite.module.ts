import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { EOnsiteController } from './e-onsite.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [EOnsiteController],
})
export class EOnsiteModule {}
