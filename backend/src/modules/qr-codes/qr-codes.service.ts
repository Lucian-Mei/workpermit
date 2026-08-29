import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@/database/schema';
import { appBaseUrl } from '@/common/base-url';

export interface QrCodeDto {
  name: string;
  scene?: string;
  area?: string;
  targetUrl?: string;
  enabled?: boolean;
}

@Injectable()
export class QrCodesService {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  list() {
    return this.db.select().from(schema.qrCodes).orderBy(schema.qrCodes.createdAt);
  }

  async create(dto: QrCodeDto) {
    if (!dto.name) throw new BadRequestException('请填写二维码名称');
    // 未填写跳转链接时，默认指向本站“微信免登录上报”页（可带场景/区域参数）
    const base = appBaseUrl();
    const params = new URLSearchParams();
    if (dto.scene) params.set('scene', dto.scene);
    if (dto.area) params.set('area', dto.area);
    const targetUrl = dto.targetUrl || `${base}/anonymous?${params.toString()}`;
    const ins = await this.db
      .insert(schema.qrCodes)
      .values({
        name: dto.name,
        scene: dto.scene,
        area: dto.area,
        targetUrl,
        enabled: dto.enabled ?? true,
      })
      .returning({ id: schema.qrCodes.id });
    return { id: ins[0].id };
  }

  async update(id: string, dto: Partial<QrCodeDto>) {
    const exist = await this.db.select({ id: schema.qrCodes.id }).from(schema.qrCodes).where(eq(schema.qrCodes.id, id)).limit(1);
    if (!exist.length) throw new NotFoundException('二维码不存在');
    const patch: any = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.scene !== undefined) patch.scene = dto.scene;
    if (dto.area !== undefined) patch.area = dto.area;
    if (dto.targetUrl !== undefined) patch.targetUrl = dto.targetUrl;
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    await this.db.update(schema.qrCodes).set(patch).where(eq(schema.qrCodes.id, id));
    return { success: true };
  }

  async remove(id: string) {
    await this.db.delete(schema.qrCodes).where(eq(schema.qrCodes.id, id));
    return { success: true };
  }
}
