import { Controller, Get, Query } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { DRIZZLE } from '@/database/database.module';
import { inspectionRecords, workPermits, workPermitApplications } from '@/database/schema';
import { and, desc, eq, gte, lte, like } from 'drizzle-orm';

/** 电子现场台 · 巡检记录列表（全量） */
@Controller('e-onsite')
export class EOnsiteController {
  constructor(@Inject(DRIZZLE) private db: any) {}

  @Get('inspections')
  async listInspections(@Query() q: any) {
    const conds: any[] = [];
    if (q.from) conds.push(gte(inspectionRecords.inspectedAt, new Date(q.from)));
    if (q.to) conds.push(lte(inspectionRecords.inspectedAt, new Date(q.to)));
    if (q.inspector) conds.push(like(inspectionRecords.inspector, `%${q.inspector}%`));
    const limit = Math.min(Number(q.limit) || 100, 500);
    const rows = await this.db
      .select({
        id: inspectionRecords.id,
        applicationId: inspectionRecords.applicationId,
        workPermitId: inspectionRecords.workPermitId,
        inspector: inspectionRecords.inspector,
        result: inspectionRecords.result,
        note: inspectionRecords.note,
        photo: inspectionRecords.photo,
        source: inspectionRecords.source,
        inspectedAt: inspectionRecords.inspectedAt,
        permitNo: workPermits.permitNo,
        jobName: workPermits.content,
        location: workPermits.location,
        area: workPermits.area,
        department: workPermits.department,
        contractorUnit: workPermitApplications.contractorUnit,
        supervisorName: workPermits.supervisorName,
        applicantName: workPermits.applicantName,
      })
      .from(inspectionRecords)
      .leftJoin(workPermits, eq(inspectionRecords.workPermitId, workPermits.id))
      .leftJoin(workPermitApplications, eq(inspectionRecords.applicationId, workPermitApplications.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(inspectionRecords.inspectedAt))
      .limit(limit);
    return { items: rows, total: rows.length };
  }
}
