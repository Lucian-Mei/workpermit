import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '@/database/schema';
import { appBaseUrl } from '@/common/base-url';

export interface AreaDto {
  name: string;
  code?: string;
  description?: string;
  building?: string;
  floor?: string;
  responsibleDept?: string;
  enabled?: boolean;
  sortOrder?: number;
}

@Injectable()
export class AreasService {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  list() {
    return this.db.select().from(schema.areas).orderBy(schema.areas.sortOrder, schema.areas.name);
  }

  // 自动为指定区域生成上报二维码（如已存在则跳过）
  private async ensureQrCode(areaId: string, areaName: string) {
    const baseUrl = appBaseUrl();
    const targetUrl = `${baseUrl}/anonymous?area=${encodeURIComponent(areaName)}`;
    const [exist] = await this.db
      .select({ id: schema.qrCodes.id })
      .from(schema.qrCodes)
      .where(and(eq(schema.qrCodes.area, areaName), eq(schema.qrCodes.targetUrl, targetUrl)))
      .limit(1);
    if (exist) return;
    await this.db.insert(schema.qrCodes).values({
      name: `${areaName}-微信上报`,
      scene: 'auto',
      area: areaName,
      targetUrl,
      enabled: true,
    });
  }

  async create(dto: AreaDto) {
    if (!dto.name) throw new BadRequestException('请填写区域名称');
    const ins = await this.db
      .insert(schema.areas)
      .values({
        name: dto.name,
        code: dto.code,
        description: dto.description,
        building: dto.building,
        floor: dto.floor,
        responsibleDept: dto.responsibleDept,
        enabled: dto.enabled ?? true,
        sortOrder: dto.sortOrder ?? 0,
      })
      .returning({ id: schema.areas.id });
    // 新增区域自动生成上报二维码
    await this.ensureQrCode(ins[0].id, dto.name);
    return { id: ins[0].id };
  }

  async update(id: string, dto: Partial<AreaDto>) {
    const exist = await this.db
      .select({ id: schema.areas.id, name: schema.areas.name })
      .from(schema.areas)
      .where(eq(schema.areas.id, id))
      .limit(1);
    if (!exist.length) throw new NotFoundException('区域不存在');
    const patch: any = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.code !== undefined) patch.code = dto.code;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.building !== undefined) patch.building = dto.building;
    if (dto.floor !== undefined) patch.floor = dto.floor;
    if (dto.responsibleDept !== undefined) patch.responsibleDept = dto.responsibleDept;
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
    await this.db.update(schema.areas).set(patch).where(eq(schema.areas.id, id));
    // 区域改名时同步更新二维码标题
    if (dto.name) await this.ensureQrCode(id, dto.name);
    return { success: true };
  }

  async remove(id: string) {
    await this.db.delete(schema.areas).where(eq(schema.areas.id, id));
    return { success: true };
  }

  // 批量导入（按名称去重）
  async import(rows: any[]) {
    const created: string[] = [];
    const errors: any[] = [];
    for (const r of rows || []) {
      try {
        if (!r.name) throw new Error('缺少区域名称');
        const ins = await this.db
          .insert(schema.areas)
          .values({ name: r.name, code: r.code, description: r.description, building: r.building, floor: r.floor, responsibleDept: r.responsibleDept, enabled: r.enabled ?? true, sortOrder: r.sortOrder ?? 0 })
          .onConflictDoNothing()
          .returning({ id: schema.areas.id });
        if (ins.length) await this.ensureQrCode(ins[0].id, r.name);
        created.push(r.name);
      } catch (e: any) {
        errors.push({ row: r, error: e?.message || String(e) });
      }
    }
    return { created, errors, total: (rows || []).length };
  }

  // 给已存在的所有启用区域补充生成二维码（系统设置/迁移时用）
  async ensureAllQrCodes() {
    const rows = await this.db.select().from(schema.areas).where(eq(schema.areas.enabled, true));
    let added = 0;
    for (const r of rows) {
      const beforeRows = await this.db.select({ id: schema.qrCodes.id }).from(schema.qrCodes).where(eq(schema.qrCodes.area, r.name));
      const before = beforeRows.length;
      await this.ensureQrCode(r.id, r.name);
      const afterRows = await this.db.select({ id: schema.qrCodes.id }).from(schema.qrCodes).where(eq(schema.qrCodes.area, r.name));
      if (afterRows.length > before) added++;
    }
    return { totalAreas: rows.length, added };
  }
}
