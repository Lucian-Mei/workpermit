import { Injectable, Inject } from '@nestjs/common';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { count, eq, and, or, inArray, isNull, sql, desc, avg, asc, gte } from 'drizzle-orm';
import * as schema from '@/database/schema';
import { HazardsService } from '@/modules/hazards/hazards.service';
import { WorkPermitsService } from '@/modules/work-permits/work-permits.service';
import { isSuperAdmin } from '@/common/permissions';

@Injectable()
export class DashboardService {
  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    private hazards: HazardsService,
    private permits: WorkPermitsService,
  ) {}

  // ================= 数据范围（按角色权限自动过滤） =================
  // 返回三档：
  //   all  —— 全厂（管理员/EHS，持 view_all 类权限）
  //   dept —— 本部门（部门负责人，managedDepartments 非空）
  //   self —— 仅自己（普通员工，submitter/assignee/applicant）
  private scopeWhere(user: any) {
    const uid = user?.userId;
    const perms: string[] = Array.isArray(user?.permissions) ? user.permissions : [];
    const myDepts: string[] = Array.isArray(user?.managedDepartments) ? user.managedDepartments : [];
    const canViewAll = isSuperAdmin(user) || perms.some((p) => p === 'hazard:view_all' || p === 'dashboard:view' || p === 'epermit:view_all');

    // 系统管理员（超级管理员）永远看全厂
    if (isSuperAdmin(user)) {
      return { kind: 'all' as const, haz: undefined, wp: undefined };
    }
    if (myDepts.length > 0) {
      return {
        kind: 'dept' as const,
        haz: inArray(schema.hazards.allocatedDepartment, myDepts),
        wp: inArray(schema.workPermits.department, myDepts),
      };
    }
    if (canViewAll) {
      return { kind: 'all' as const, haz: undefined, wp: undefined };
    }
    return {
      kind: 'self' as const,
      haz: or(eq(schema.hazards.submitterUserId, uid), eq(schema.hazards.assigneeId, uid)),
      wp: eq(schema.workPermits.applicantId, uid),
    };
  }

  // 隐患基础统计（带 scope 过滤）
  private async hazardStats(scope: ReturnType<DashboardService['scopeWhere']>) {
    const base = this.db.select().from(schema.hazards);
    const byStatus = await this.db
      .select({ status: schema.hazards.status, c: count() })
      .from(schema.hazards)
      .where(scope.haz)
      .groupBy(schema.hazards.status);
    const byRisk = await this.db
      .select({ riskLevel: schema.hazards.riskLevel, c: count() })
      .from(schema.hazards)
      .where(scope.haz)
      .groupBy(schema.hazards.riskLevel);
    const byDept = await this.db
      .select({ dept: schema.hazards.allocatedDepartment, c: count() })
      .from(schema.hazards)
      .where(scope.haz)
      .groupBy(schema.hazards.allocatedDepartment);
    const [total] = await this.db.select({ c: count() }).from(schema.hazards).where(scope.haz);
    const [open] = await this.db
      .select({ c: count() })
      .from(schema.hazards)
      .where(scope.haz ? and(scope.haz, sql`${schema.hazards.status} in ('pending_assign','assigned','rectified','dept_confirmed')`) : sql`${schema.hazards.status} in ('pending_assign','assigned','rectified','dept_confirmed')`);
    return {
      total: Number(total?.c ?? 0),
      open: Number(open?.c ?? 0),
      byStatus: byStatus.map((r: any) => ({ status: r.status, count: Number(r.c) })),
      byRisk: byRisk.map((r: any) => ({ riskLevel: r.riskLevel, count: Number(r.c) })),
      byDept: byDept
        .filter((r: any) => r.dept)
        .map((r: any) => ({ dept: r.dept, count: Number(r.c) })),
    };
  }

  // 作业票（work_permits）基础统计（带 scope 过滤）
  private async wpStats(scope: ReturnType<DashboardService['scopeWhere']>) {
    const byStatus = await this.db
      .select({ status: schema.workPermits.status, c: count() })
      .from(schema.workPermits)
      .where(scope.wp)
      .groupBy(schema.workPermits.status);
    const byType = await this.db
      .select({ type: schema.workPermits.type, c: count() })
      .from(schema.workPermits)
      .where(scope.wp)
      .groupBy(schema.workPermits.type);
    const [total] = await this.db.select({ c: count() }).from(schema.workPermits).where(scope.wp);
    const [pending] = await this.db
      .select({ c: count() })
      .from(schema.workPermits)
      .where(scope.wp ? and(scope.wp, sql`${schema.workPermits.status} in ('pending_review','reviewing')`) : sql`${schema.workPermits.status} in ('pending_review','reviewing')`);
    return {
      total: Number(total?.c ?? 0),
      pending: Number(pending?.c ?? 0),
      byStatus: byStatus.map((r: any) => ({ status: r.status, count: Number(r.c) })),
      byType: byType.map((r: any) => ({ type: r.type, count: Number(r.c) })),
    };
  }

  // 近 12 个月隐患上报 / 整改完成趋势
  private async hazardTrend(scope: ReturnType<DashboardService['scopeWhere']>) {
    const monthExpr = sql`to_char(${schema.hazards.createdAt}, 'YYYY-MM')`;
    const reported = await this.db
      .select({ month: monthExpr, c: count() })
      .from(schema.hazards)
      .where(scope.haz)
      .groupBy(monthExpr);
    const rectMonthExpr = sql`to_char(${schema.hazards.rectificationDate}, 'YYYY-MM')`;
    const rectified = await this.db
      .select({ month: rectMonthExpr, c: count() })
      .from(schema.hazards)
      .where(scope.haz ? and(scope.haz, sql`${schema.hazards.rectificationDate} is not null`) : sql`${schema.hazards.rectificationDate} is not null`)
      .groupBy(rectMonthExpr);
    return this.fillMonths(reported, rectified);
  }

  // 近 12 个月作业申请趋势（work_permits 按创建月）
  private async wpTrend(scope: ReturnType<DashboardService['scopeWhere']>) {
    const monthExpr = sql`to_char(${schema.workPermits.createdAt}, 'YYYY-MM')`;
    const rows = await this.db
      .select({ month: monthExpr, c: count() })
      .from(schema.workPermits)
      .where(scope.wp)
      .groupBy(monthExpr);
    return this.fillMonths(rows);
  }

  // 把数据库稀疏的月份结果补齐为连续 12 个月
  private fillMonths(reported: any[], rectified?: any[]) {
    const now = new Date();
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const repMap = new Map((reported || []).map((r: any) => [r.month, Number(r.c)]));
    const recMap = new Map((rectified || []).map((r: any) => [r.month, Number(r.c)]));
    return months.map((m) => ({
      month: m,
      reported: repMap.get(m) || 0,
      rectified: rectified ? recMap.get(m) || 0 : undefined,
    }));
  }

  // 超期预警：deadline 已过且仍处于未闭环状态（pending_assign / assigned）
  private async overdue(scope: ReturnType<DashboardService['scopeWhere']>) {
    const cond = scope.haz
      ? and(scope.haz, inArray(schema.hazards.status, ['pending_assign', 'assigned', 'rectified', 'dept_confirmed']), sql`${schema.hazards.deadline} < now()`)
      : and(inArray(schema.hazards.status, ['pending_assign', 'assigned', 'rectified', 'dept_confirmed']), sql`${schema.hazards.deadline} < now()`);
    const [cnt] = await this.db.select({ c: count() }).from(schema.hazards).where(cond);
    const list = await this.db
      .select({
        id: schema.hazards.id,
        hazardNo: schema.hazards.hazardNo,
        description: schema.hazards.description,
        department: schema.hazards.allocatedDepartment,
        riskLevel: schema.hazards.riskLevel,
        deadline: schema.hazards.deadline,
      })
      .from(schema.hazards)
      .where(cond)
      .orderBy(asc(schema.hazards.deadline))
      .limit(8);
    const now = Date.now();
    return {
      count: Number(cnt?.c ?? 0),
      list: list.map((h: any) => ({
        id: h.id,
        hazardNo: h.hazardNo,
        description: h.description ? (h.description.length > 24 ? h.description.slice(0, 24) + '…' : h.description) : '—',
        department: h.department || '—',
        riskLevel: h.riskLevel || '—',
        deadline: h.deadline,
        days: h.deadline ? Math.max(0, Math.floor((now - new Date(h.deadline).getTime()) / 86400000)) : 0,
      })),
    };
  }

  // 闭环效能：平均整改时长 + 驳回率
  private async efficiency(scope: ReturnType<DashboardService['scopeWhere']>) {
    const rectCond = scope.haz
      ? and(scope.haz, sql`${schema.hazards.rectificationDate} is not null`)
      : sql`${schema.hazards.rectificationDate} is not null`;
    const [avgRow] = await this.db
      .select({
        avg: sql`avg(extract(epoch from (${schema.hazards.rectificationDate} - ${schema.hazards.createdAt})) / 86400)`,
      })
      .from(schema.hazards)
      .where(rectCond);
    const [tot] = await this.db.select({ c: count() }).from(schema.hazards).where(scope.haz);
    const [rej] = await this.db
      .select({ c: count() })
      .from(schema.hazards)
      .where(scope.haz ? and(scope.haz, eq(schema.hazards.status, 'rejected')) : eq(schema.hazards.status, 'rejected'));
    const avgDays = avgRow?.avg != null ? Number(avgRow.avg) : 0;
    const total = Number(tot?.c ?? 0);
    const reject = Number(rej?.c ?? 0);
    return {
      avgRectifyDays: Math.round(avgDays * 10) / 10,
      rejectRate: total ? Math.round((reject / total) * 100) : 0,
    };
  }

  async overview(user: any) {
    const scope = this.scopeWhere(user);
    const haz = await this.hazardStats(scope);
    const wp = await this.wpStats(scope);
    const users = await this.db.select({ c: count() }).from(schema.users);
    const depts = await this.db.select({ c: count() }).from(schema.departments);
    const [hazardTrend, wpTrend, overdue, efficiency] = await Promise.all([
      this.hazardTrend(scope),
      this.wpTrend(scope),
      this.overdue(scope),
      this.efficiency(scope),
    ]);
    return {
      scope: scope.kind,
      hazards: haz,
      workPermits: wp,
      usersCount: Number(users[0]?.c ?? 0),
      departmentsCount: Number(depts[0]?.c ?? 0),
      hazardTrend,
      wpTrend,
      overdue,
      efficiency,
    };
  }

  // ================= 今日待我处理（聚合待办） =================
  // 三类：①待我审批 ②待确认交底 ③隐患待跟进（分配给我 / 已超期）
  async todos(user: any) {
    const uid = user?.userId;

    // ① 待我审批：处于审批中，且当前用户是复核人或审批人
    const approvals = await this.db
      .select({
        id: schema.workPermits.id,
        permitNo: schema.workPermits.permitNo,
        jobName: schema.workPermits.jobName,
        location: schema.workPermits.location,
        department: schema.workPermits.department,
        applicantName: schema.workPermits.applicantName,
        status: schema.workPermits.status,
      })
      .from(schema.workPermits)
      .where(
        and(
          inArray(schema.workPermits.status, ['pending_review', 'reviewing']),
          or(
            eq(schema.workPermits.reviewerId, uid),
            eq(schema.workPermits.approverId, uid),
          ),
        ),
      )
      .orderBy(desc(schema.workPermits.createdAt))
      .limit(20);

    // ② 待确认交底：已打印/暂停，但安全交底未完成（leftJoin safety_briefings）
    const briefingRows = await this.db
      .select({
        id: schema.workPermits.id,
        permitNo: schema.workPermits.permitNo,
        jobName: schema.workPermits.jobName,
        location: schema.workPermits.location,
        department: schema.workPermits.department,
        briefStatus: schema.safetyBriefings.status,
      })
      .from(schema.workPermits)
      .leftJoin(
        schema.safetyBriefings,
        eq(schema.safetyBriefings.workPermitId, schema.workPermits.id),
      )
      .where(
        and(
          inArray(schema.workPermits.status, ['printed', 'paused']),
          or(isNull(schema.safetyBriefings.status), sql`${schema.safetyBriefings.status} <> 'done'`),
        ),
      )
      .orderBy(desc(schema.workPermits.printedAt))
      .limit(20);

    // ③ 隐患待跟进：分配给我且未闭环，或已超过整改期限
    const hazardRows = await this.db
      .select({
        id: schema.hazards.id,
        hazardNo: schema.hazards.hazardNo,
        description: schema.hazards.description,
        location: schema.hazards.location,
        department: schema.hazards.department,
        riskLevel: schema.hazards.riskLevel,
        status: schema.hazards.status,
        deadline: schema.hazards.deadline,
        assigneeId: schema.hazards.assigneeId,
      })
      .from(schema.hazards)
      .where(
        and(
          inArray(schema.hazards.status, ['pending_assign', 'assigned']),
          or(eq(schema.hazards.assigneeId, uid), sql`${schema.hazards.deadline} < now()`),
        ),
      )
      .orderBy(desc(schema.hazards.deadline))
      .limit(20);

    // ④ 待部门确认：整改完成、待责任部门负责人确认（仅本人所管理部门）
    const canDeptReview = Array.isArray(user?.permissions) && user.permissions.includes('hazard:dept_review');
    const myDepts = Array.isArray(user?.managedDepartments) ? user.managedDepartments : [];
    const deptReviewRows = canDeptReview && myDepts.length > 0
      ? await this.db
          .select({
            id: schema.hazards.id,
            hazardNo: schema.hazards.hazardNo,
            description: schema.hazards.description,
            location: schema.hazards.location,
            department: schema.hazards.allocatedDepartment,
            riskLevel: schema.hazards.riskLevel,
            status: schema.hazards.status,
          })
          .from(schema.hazards)
          .where(
            and(
              eq(schema.hazards.status, 'rectified'),
              inArray(schema.hazards.allocatedDepartment, myDepts),
            ),
          )
          .orderBy(desc(schema.hazards.rectificationDate))
          .limit(20)
      : [];

    // ⑤ 待验收：部门已确认、待 EHS 验收
    const canAccept = Array.isArray(user?.permissions) && user.permissions.includes('hazard:accept');
    const acceptRows = canAccept
      ? await this.db
          .select({
            id: schema.hazards.id,
            hazardNo: schema.hazards.hazardNo,
            description: schema.hazards.description,
            location: schema.hazards.location,
            department: schema.hazards.allocatedDepartment,
            riskLevel: schema.hazards.riskLevel,
            status: schema.hazards.status,
          })
          .from(schema.hazards)
          .where(eq(schema.hazards.status, 'dept_confirmed'))
          .orderBy(desc(schema.hazards.updatedAt))
          .limit(20)
      : [];

    const now = Date.now();
    const truncate = (s: string | null, n = 22) =>
      s ? (s.length > n ? s.slice(0, n) + '…' : s) : '';

    const groups = [
      {
        key: 'approval',
        label: '待我审批',
        items: approvals.map((a: any) => ({
          id: a.id,
          title: `${a.permitNo} 待审批`,
          sub: `${a.department || '—'} · ${a.jobName || '作业'} · ${a.applicantName || ''}`,
          to: `/e-permits/view/${a.id}`,
        })),
      },
      {
        key: 'briefing',
        label: '待确认交底',
        items: briefingRows.map((a: any) => ({
          id: a.id,
          title: `${a.permitNo} 现场交底待确认`,
          sub: `${a.department || '—'} · ${a.jobName || '作业'}`,
          to: `/e-permits/view/${a.id}`,
        })),
      },
      {
        key: 'hazard',
        label: '隐患待跟进',
        items: hazardRows.map((h: any) => {
          const overdue = !!h.deadline && new Date(h.deadline).getTime() < now;
          return {
            id: h.id,
            title: `${h.hazardNo} ${truncate(h.description)}`,
            sub: `${h.department || '—'} · 风险 ${h.riskLevel || '—'} · ${
              overdue ? '已超期' : h.deadline ? '限期内' : '未排期'
            }`,
            to: `/hazards/${h.id}`,
            overdue,
          };
        }),
      },
      ...(deptReviewRows.length > 0
        ? [{
            key: 'dept_review',
            label: '待部门确认',
            items: deptReviewRows.map((h: any) => ({
              id: h.id,
              title: `${h.hazardNo} ${truncate(h.description)}`,
              sub: `${h.department || '—'} · 风险 ${h.riskLevel || '—'} · 待您确认`,
              to: `/hazards/${h.id}`,
            })),
          }]
        : []),
      ...(acceptRows.length > 0
        ? [{
            key: 'hazard_accept',
            label: '待验收',
            items: acceptRows.map((h: any) => ({
              id: h.id,
              title: `${h.hazardNo} ${truncate(h.description)}`,
              sub: `${h.department || '—'} · 风险 ${h.riskLevel || '—'} · 待您验收`,
              to: `/hazards/${h.id}`,
            })),
          }]
        : []),
    ];

    return {
      groups,
      total: groups.reduce((s, g) => s + g.items.length, 0),
    };
  }
}
