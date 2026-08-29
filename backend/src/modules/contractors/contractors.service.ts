import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, ilike, desc, or, sql } from 'drizzle-orm';
import * as schema from '@/database/schema';

export interface ContractorDto {
  name: string;
  head?: string;
  phone?: string;
  enabled?: boolean;
}

@Injectable()
export class ContractorsService {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  /** 列表：默认仅启用 + 关键字搜索 */
  async list(q?: string, includeDisabled = false) {
    const where: any[] = [];
    if (!includeDisabled) where.push(eq(schema.contractors.enabled, true));
    if (q) {
      const kw = `%${q.trim()}%`;
      where.push(or(ilike(schema.contractors.name, kw), ilike(schema.contractors.head, kw)));
    }
    const rows = await this.db
      .select()
      .from(schema.contractors)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(schema.contractors.updatedAt));
    return rows;
  }

  /** 智能 upsert：相同单位+负责人时更新电话/启用；否则新增 */
  async upsert(dto: ContractorDto) {
    if (!dto.name && !dto.head) throw new BadRequestException('请至少填写承包商单位或负责人');
    const name = (dto.name || '').trim();
    const head = (dto.head || '').trim();
    const phone = (dto.phone || '').trim();
    // 先尝试按 (name, head) 查找
    const exist = await this.db
      .select()
      .from(schema.contractors)
      .where(and(
        name ? eq(schema.contractors.name, name) : sql`${schema.contractors.name} = ''`,
        head ? eq(schema.contractors.head, head) : sql`${schema.contractors.head} IS NULL`,
      ))
      .limit(1);
    if (exist.length) {
      const patch: any = { updatedAt: new Date() };
      if (name && !exist[0].name) patch.name = name;
      if (head && !exist[0].head) patch.head = head;
      if (phone && phone !== exist[0].phone) patch.phone = phone;
      await this.db.update(schema.contractors).set(patch).where(eq(schema.contractors.id, exist[0].id));
      return { id: exist[0].id, updated: true };
    }
    const ins = await this.db
      .insert(schema.contractors)
      .values({ name, head: head || null, phone: phone || null, enabled: dto.enabled ?? true })
      .returning({ id: schema.contractors.id });
    return { id: ins[0].id, updated: false };
  }

  async setEnabled(id: string, enabled: boolean) {
    const exist = await this.db.select({ id: schema.contractors.id }).from(schema.contractors).where(eq(schema.contractors.id, id)).limit(1);
    if (!exist.length) throw new NotFoundException('承包商不存在');
    await this.db.update(schema.contractors).set({ enabled, updatedAt: new Date() }).where(eq(schema.contractors.id, id));
    return { success: true };
  }

  async update(id: string, dto: Partial<ContractorDto>) {
    const exist = await this.db.select({ id: schema.contractors.id }).from(schema.contractors).where(eq(schema.contractors.id, id)).limit(1);
    if (!exist.length) throw new NotFoundException('承包商不存在');
    const patch: any = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.head !== undefined) patch.head = dto.head;
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    await this.db.update(schema.contractors).set(patch).where(eq(schema.contractors.id, id));
    return { success: true };
  }

  async remove(id: string) {
    await this.db.delete(schema.contractors).where(eq(schema.contractors.id, id));
    return { success: true };
  }
}
