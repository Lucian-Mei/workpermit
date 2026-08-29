import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@/database/schema';

export interface HazardTypeDto {
  name: string;
  regulations?: string[];
  enabled?: boolean;
  sortOrder?: number;
}

@Injectable()
export class HazardTypesService {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  list() {
    return this.db.select().from(schema.hazardTypes).orderBy(schema.hazardTypes.sortOrder, schema.hazardTypes.name);
  }

  async create(dto: HazardTypeDto) {
    if (!dto.name) throw new BadRequestException('请填写隐患类型名称');
    const ins = await this.db
      .insert(schema.hazardTypes)
      .values({
        name: dto.name,
        regulations: dto.regulations ?? [],
        enabled: dto.enabled ?? true,
        sortOrder: dto.sortOrder ?? 0,
      })
      .returning({ id: schema.hazardTypes.id });
    return { id: ins[0].id };
  }

  async update(id: string, dto: Partial<HazardTypeDto>) {
    const exist = await this.db
      .select({ id: schema.hazardTypes.id })
      .from(schema.hazardTypes)
      .where(eq(schema.hazardTypes.id, id))
      .limit(1);
    if (!exist.length) throw new NotFoundException('隐患类型不存在');
    const patch: any = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.regulations !== undefined) patch.regulations = dto.regulations;
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
    await this.db.update(schema.hazardTypes).set(patch).where(eq(schema.hazardTypes.id, id));
    return { success: true };
  }

  async remove(id: string) {
    await this.db.delete(schema.hazardTypes).where(eq(schema.hazardTypes.id, id));
    return { success: true };
  }
}
