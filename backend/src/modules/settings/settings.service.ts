import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@/database/schema';

@Injectable()
export class SettingsService {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  async list() {
    return this.db.select().from(schema.systemConfig).orderBy(schema.systemConfig.key);
  }

  async get(key: string) {
    const [row] = await this.db.select().from(schema.systemConfig).where(eq(schema.systemConfig.key, key)).limit(1);
    if (!row) throw new NotFoundException('配置不存在');
    return row;
  }

  async save(key: string, value: string) {
    const exist = await this.db.select({ id: schema.systemConfig.id }).from(schema.systemConfig).where(eq(schema.systemConfig.key, key)).limit(1);
    if (exist.length) {
      await this.db.update(schema.systemConfig).set({ value, updatedAt: new Date() }).where(eq(schema.systemConfig.key, key));
    } else {
      await this.db.insert(schema.systemConfig).values({ key, value });
    }
    return { success: true };
  }
}
