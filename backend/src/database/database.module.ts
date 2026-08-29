import { Global, Module, OnModuleInit, OnApplicationBootstrap, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite, PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle as drizzleNode, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE_DB');
export const PGLITE = Symbol('PGLITE_INSTANCE');

import SAFETY_MEASURES from './safety-measures.data';
import { dedupeChain } from '../modules/work-permits/approval-routing';
import { permitNoPrefix } from '../common/constants/domain';

/**
 * 数据库模块（双驱动）：
 * - 生产/Docker 环境：DB_DRIVER 不设置（或 =pg），使用外部 PostgreSQL（node-postgres 连接池）。
 * - 本地沙箱预览环境：DB_DRIVER=pglite，使用进程内 PGlite（PostgreSQL 编译为 WASM），
 *   无独立 server、无 fork 后端进程，规避 WorkBuddy 沙箱对 PostgreSQL 后端进程的随机杀进程问题。
 *   PGlite 在本地持久化到 PGLITE_DATA_DIR 目录，重启后端数据不丢失；
 *   首次启动自动执行 drizzle 迁移（全部 IF NOT EXISTS，幂等），已建表则跳过。
 */
@Global()
@Module({
  providers: [
    {
      provide: PGLITE,
      inject: [ConfigService],
      useFactory: async (cfg: ConfigService) => {
        const driver = (cfg.get<string>('DB_DRIVER') || 'pg').toLowerCase();
        const raw = (cfg.get<string>('PGLITE_DATA_DIR') || '').trim();
        if (driver === 'pglite') {
          // eslint-disable-next-line no-console
          console.log(`[db] DB_DRIVER=pglite PGLITE_DATA_DIR="${raw}"`);
          // memory / 空 → 进程内内存库（不落盘，规避沙箱 safe-delete 守卫对磁盘 unlink 的拦截）
          if (!raw || raw.toLowerCase() === 'memory') {
            // eslint-disable-next-line no-console
            console.log('[db] 使用内存库（无持久化）');
            return PGlite.create();
          }
          const dataDir = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
          // eslint-disable-next-line no-console
          console.log(`[db] 使用持久化目录: ${dataDir}`);
          return PGlite.create({ dataDir });
        }
        // 外部 PostgreSQL：返回兼容 exec/query 的包装，使迁移/一次性清理代码对双驱动通用（单一迁移机制）
        const url = cfg.get<string>('DATABASE_URL');
        if (!url) throw new Error('缺少 DATABASE_URL 配置');
        const pool = new Pool({
          connectionString: url,
          max: Number(process.env.PG_POOL_MAX || cfg.get('PG_POOL_MAX') || 1),
          idleTimeoutMillis: 0,
        });
        const compat = {
          pool,
          exec: async (sql: string) => { await pool.query(sql); },
          query: (text: string, params?: any[]) => pool.query(text, params),
          end: () => pool.end(),
        };
        // eslint-disable-next-line no-console
        console.log('[db] 使用外部 PostgreSQL（连接池，exec/query 兼容模式）');
        return compat;
      },
    },
    {
      provide: DRIZZLE,
      inject: [ConfigService, PGLITE],
      useFactory: async (cfg: ConfigService, pg: any) => {
        if (pg) {
          // 外部 PG 兼容包装带 pool → node-postgres drizzle；真实 PGlite 实例 → pglite drizzle
          if (pg.pool) return drizzleNode(pg.pool, { schema }) as NodePgDatabase<typeof schema>;
          return drizzlePglite(pg, { schema }) as PgliteDatabase<typeof schema>;
        }
        // 兼容兜底：外部 PostgreSQL 路径（未走 PGLITE 提供者时）
        const url = cfg.get<string>('DATABASE_URL');
        if (!url) throw new Error('缺少 DATABASE_URL 配置');
        const pool = new Pool({
          connectionString: url,
          max: Number(process.env.PG_POOL_MAX || cfg.get('PG_POOL_MAX') || 1),
          idleTimeoutMillis: 0,
        });
        return drizzleNode(pool, { schema }) as NodePgDatabase<typeof schema>;
      },
    },
  ],
  exports: [DRIZZLE, PGLITE],
})
export class DatabaseModule implements OnModuleInit, OnApplicationBootstrap {
  constructor(@Inject(PGLITE) private readonly pg: any) {}

  async onModuleInit() {
    // 迁移机制统一：PGlite 与外部 PostgreSQL 都走“应用内幂等 SQL”（主迁移 + 补充迁移）。
    // 已完整迁移过（核心表都存在）则跳过主迁移 SQL，仅执行补充迁移。
    const hasAll = await this.hasCoreTables();
    // eslint-disable-next-line no-console
    console.log(`[migrate] hasCoreTables=${hasAll}`);
    if (!hasAll) {
      const sqlPath = path.join(__dirname, '..', '..', 'drizzle', '0000_cynical_hammerhead.sql');
      // eslint-disable-next-line no-console
      console.log(`[migrate] 主迁移 SQL: ${sqlPath} 存在=${fs.existsSync(sqlPath)}`);
      if (fs.existsSync(sqlPath)) {
        const sql = fs.readFileSync(sqlPath, 'utf-8');
        await this.pg.exec(sql);
        // eslint-disable-next-line no-console
        console.log('[migrate] 主迁移执行完成');
      }
    }
    // ===== 补充迁移：新增列 / 新表（对已有库也生效，全部幂等）=====
    await this.pg.exec(`
      ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS channel varchar(16) NOT NULL DEFAULT 'paper';
      ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS measure_selections jsonb;
      -- 员工账号：直属领导（自关联，删除领导时置空）
      ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS channel varchar(16) NOT NULL DEFAULT 'paper';
      CREATE TABLE IF NOT EXISTS measure_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type varchar(30) NOT NULL,
        category varchar(20) NOT NULL,
        content text NOT NULL,
        note varchar(100),
        sort integer NOT NULL DEFAULT 0
      );
      -- 危险作业票三方顺序会签（部门主管 -> EHS工程师 -> 工程部经理）
      ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
      ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS ehs_approver_id uuid;
      ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS ehs_approver_name varchar(100);
      ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS ehs_approval_opinion text;
      ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS ehs_approved_at timestamptz;
      ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS approved_at timestamptz;
      -- 工作安全分析（JSA）独立小节
      ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS jsas jsonb;
      -- 动作令牌（邮件内审批按钮 / 二维码手机签字）
      CREATE TABLE IF NOT EXISTS action_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        token varchar(64) NOT NULL UNIQUE,
        purpose varchar(30) NOT NULL,
        target_type varchar(30) NOT NULL,
        target_id uuid NOT NULL,
        step varchar(30),
        role varchar(30),
        signer_name varchar(100),
        multi boolean NOT NULL DEFAULT false,
        meta jsonb DEFAULT '{}',
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        used_by varchar(100),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_atoken_token ON action_tokens (token);
      CREATE INDEX IF NOT EXISTS idx_atoken_target ON action_tokens (target_type, target_id);
      -- 安全培训签字完成标记（培训人点击“完成培训签到”）
      ALTER TABLE work_permit_trainings ADD COLUMN IF NOT EXISTS sign_completed_at timestamptz;
      -- 看板展示扩展字段（承包商 / 项目 / 管理部门 / 危险作业类型）
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS project_name varchar(255);
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS contractor_unit varchar(255);
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS contractor_head varchar(100);
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS contractor_phone varchar(50);
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS management_dept varchar(100);
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS management_person varchar(100);
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS hazard_type_list jsonb;
      -- 申请单改版新字段（作业人数/材料/设备清单）
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS operator_count integer;
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS materials_list text;
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS equipment_list text;
      -- 默认通道改为 electronic（纸质已关闭）
      ALTER TABLE work_permit_applications ALTER COLUMN channel SET DEFAULT 'electronic';
      ALTER TABLE work_permits ALTER COLUMN channel SET DEFAULT 'electronic';
      -- 并行会签字段（区域负责人 + 承包商管理部门）
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS area_approver_id uuid REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS area_approver_name varchar(100);
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS area_approval_opinion text;
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS area_approved_at timestamptz;
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS dept_approver_id uuid REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS dept_approver_name varchar(100);
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS dept_approval_opinion text;
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS dept_approved_at timestamptz;
      -- 入厂核验二维码
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS entry_qr_token varchar(64);
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS entry_qr_url text;
      -- 隐患模块增强字段
      ALTER TABLE departments ADD COLUMN IF NOT EXISTS default_rectifier_id uuid REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE hazards ALTER COLUMN risk_level SET DEFAULT 'low';
      -- 隐患：部门派单 + 归档字段（旧库补列，幂等）
      ALTER TABLE hazards ADD COLUMN IF NOT EXISTS assigned_dept_id uuid REFERENCES departments(id) ON DELETE SET NULL;
      ALTER TABLE hazards ADD COLUMN IF NOT EXISTS archived_reason text;
      ALTER TABLE hazards ADD COLUMN IF NOT EXISTS archived_at timestamptz;
      ALTER TABLE hazards ADD COLUMN IF NOT EXISTS archived_by_name varchar(100);
      -- 隐患处理记录表
      CREATE TABLE IF NOT EXISTS hazard_activities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        hazard_id uuid NOT NULL REFERENCES hazards(id) ON DELETE CASCADE,
        operator_id uuid REFERENCES users(id) ON DELETE SET NULL,
        operator_name varchar(100) NOT NULL,
        action varchar(30) NOT NULL,
        from_status varchar(30),
        to_status varchar(30),
        comment text,
        payload jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      -- 承包商库（自动录入 + 下拉）
      CREATE TABLE IF NOT EXISTS contractors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(200) NOT NULL,
        head varchar(100),
        phone varchar(50),
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_contractors_name ON contractors(name);
      CREATE INDEX IF NOT EXISTS idx_contractors_head ON contractors(head);
      -- 一级安全培训
      CREATE TABLE IF NOT EXISTS training_config (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key varchar(50) NOT NULL UNIQUE,
        value text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS training_questions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        question text NOT NULL,
        options jsonb NOT NULL DEFAULT '[]'::jsonb,
        answer varchar(10) NOT NULL,
        sort integer NOT NULL DEFAULT 0,
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS training_records (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(100) NOT NULL,
        phone varchar(50),
        score integer,
        total integer,
        passed boolean NOT NULL DEFAULT false,
        passed_at timestamptz,
        valid_until timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE training_records ADD COLUMN IF NOT EXISTS answers jsonb DEFAULT '[]'::jsonb;
      -- S12：培训合格身份以身份证号为唯一键（避免同名错认/冒领）
      ALTER TABLE training_records ADD COLUMN IF NOT EXISTS id_card varchar(50);
      CREATE INDEX IF NOT EXISTS idx_training_records_id_card ON training_records(id_card);
      -- 工人入厂登记
      CREATE TABLE IF NOT EXISTS entry_registrations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        application_id uuid NOT NULL,
        contractor_unit varchar(200) NOT NULL,
        worker_name varchar(100) NOT NULL,
        worker_phone varchar(50),
        training_passed boolean NOT NULL DEFAULT false,
        training_record_id uuid,
        sign_img text,
        registered_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_entry_registrations_app_id ON entry_registrations(application_id);
      CREATE INDEX IF NOT EXISTS idx_entry_registrations_phone ON entry_registrations(worker_phone);
      -- 默认有效期 3 个月(90天)
      INSERT INTO training_config (key, value) SELECT 'validity_days', '90' WHERE NOT EXISTS (SELECT 1 FROM training_config WHERE key = 'validity_days');
      INSERT INTO training_config (key, value) SELECT 'pass_score', '60' WHERE NOT EXISTS (SELECT 1 FROM training_config WHERE key = 'pass_score');
      INSERT INTO training_config (key, value) SELECT 'question_count', '5' WHERE NOT EXISTS (SELECT 1 FROM training_config WHERE key = 'question_count');
      -- ===== 重构（承包商作业票完整流程）=====
      -- 1. 作业代码 SG-NNNN-NNNN（6 位数字，月内唯一，作业结束后清除）
      ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS work_code varchar(20);
      CREATE INDEX IF NOT EXISTS idx_work_permits_work_code ON work_permits(work_code);
      -- 2. 培训二维码（每天生成，多人扫码共享，3 天有效）
      ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS training_qr_token varchar(64);
      ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS training_qr_expires_at timestamptz;
      -- 3. 入厂登记链接到作业票（与申请单同时挂）
      ALTER TABLE entry_registrations ADD COLUMN IF NOT EXISTS work_permit_id uuid REFERENCES work_permits(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_entry_registrations_wp ON entry_registrations(work_permit_id);
      -- 4. 签出时间
      ALTER TABLE entry_registrations ADD COLUMN IF NOT EXISTS sign_out_at timestamptz;
      -- 4.1 入场登记增强：身份证号（考勤匹配唯一键）、闸口、申请单可空（独立危险票无申请单）
      ALTER TABLE entry_registrations ADD COLUMN IF NOT EXISTS worker_id_card varchar(50);
      ALTER TABLE entry_registrations ADD COLUMN IF NOT EXISTS gate varchar(50);
      ALTER TABLE entry_registrations ALTER COLUMN application_id DROP NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_entry_reg_wp ON entry_registrations(work_permit_id);
      CREATE INDEX IF NOT EXISTS idx_entry_reg_idcard ON entry_registrations(worker_id_card);
      -- 一次性迁移标记表（避免破坏性清理在每次启动时重复执行）
      CREATE TABLE IF NOT EXISTS system_flags (
        key varchar(80) PRIMARY KEY,
        value text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      -- 5. 培训结果日志（扫码-学习-考试-通过/重考记录）
      CREATE TABLE IF NOT EXISTS training_attempts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        work_permit_id uuid REFERENCES work_permits(id) ON DELETE CASCADE,
        worker_name varchar(100) NOT NULL,
        worker_id_card varchar(50) NOT NULL,
        step varchar(20) NOT NULL,           -- 'studied' / 'exam_started' / 'exam_passed' / 'exam_failed'
        score integer,
        training_record_id uuid,
        attempted_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_training_attempts_wp ON training_attempts(work_permit_id);
      -- 数据迁移：危险作业类型回填 is_hazardous=true（含动土、受限空间等）
      UPDATE work_permits SET is_hazardous = true
        WHERE type IN ('fire','high','confined','lifting','electric','excavation','blind_plate','other')
          AND is_hazardous = false;
      -- 审批路由：风险等级 + 审批链快照
      ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS risk_level varchar(20) NOT NULL DEFAULT 'low';
      ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS approval_chain jsonb;
      -- 动火定时检查：槽位（0h/1h/3h）+ 解锁时间（1h 槽=0h 完成后+1h，3h 槽=+3h）
      ALTER TABLE work_permit_checks ADD COLUMN IF NOT EXISTS check_slot varchar(10);
      ALTER TABLE work_permit_checks ADD COLUMN IF NOT EXISTS unlock_at timestamptz;
      -- P0-8：危险作业票手动关联的常规作业票（GWP）
      ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS linked_routine_id uuid;
      ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS linked_routine_no varchar(50);
      CREATE INDEX IF NOT EXISTS idx_wp_linked_routine ON work_permits(linked_routine_id);
      -- P0-9：常规票申请仅填预计作业人数（不要求一级安全培训已完成）
      ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS expected_operator_count integer;
      -- 超期自动归档/缺资料标记：归档后资料不全置 true，补交后置 false
      ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS material_missing boolean NOT NULL DEFAULT false;
      ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS auto_archived_at timestamptz;
      -- ===== 统一申请入口（P0 重构）：申请单携带 JSA / 安全措施 / 类型 / 关联常规票 =====
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS permit_type varchar(30) NOT NULL DEFAULT 'routine';
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS jsas jsonb;
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS safety_measures jsonb;
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS expected_operator_count integer;
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS linked_routine_id uuid;
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS linked_routine_no varchar(50);
      ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS type varchar(30);
      CREATE INDEX IF NOT EXISTS idx_wpa_linked_routine ON work_permit_applications(linked_routine_id);
      -- 历史回填 type：有危险票的申请单按首张危险票类型推断
      UPDATE work_permit_applications wpa SET type = (
        SELECT wp.type FROM work_permits wp WHERE wp.application_id = wpa.id AND wp.is_hazardous = true AND wp.type IS NOT NULL LIMIT 1
      ) WHERE wpa.type IS NULL AND wpa.involves_hazardous = true;
      -- 历史数据回填 permit_type（含危险作业的申请单按首张关联危险票类型推断，否则 routine）
      UPDATE work_permit_applications SET permit_type = 'routine' WHERE permit_type IS NULL OR permit_type = '';
      -- 历史数据回填 jsas（从关联作业票搬回第一份，避免丢失既有 JSA）
      UPDATE work_permit_applications wpa
        SET jsas = (
          SELECT wp.jsas
          FROM work_permits wp
          WHERE wp.application_id = wpa.id AND wp.jsas IS NOT NULL AND jsonb_array_length(wp.jsas) > 0
          LIMIT 1
        )
        WHERE wpa.jsas IS NULL;
      -- 历史数据回填 linked_routine（从关联特殊票反推常规申请单的关联常规票）
      UPDATE work_permit_applications wpa
        SET linked_routine_id = wp.linked_routine_id,
            linked_routine_no = wp.linked_routine_no
        FROM work_permits wp
        WHERE wp.application_id = wpa.id AND wp.linked_routine_id IS NOT NULL AND wpa.linked_routine_id IS NULL;
      -- 历史数据回填风险等级（高危三类=重大风险，其余危险作业=中等风险，常规=一般风险）
      UPDATE work_permits SET risk_level = 'high'
        WHERE is_hazardous = true AND type IN ('hot_work','confined_space','blind') AND risk_level = 'low';
      UPDATE work_permits SET risk_level = 'medium'
        WHERE is_hazardous = true AND type NOT IN ('hot_work','confined_space','blind') AND risk_level = 'low';
      -- 数据修复（幂等）：执行态（已打印/暂停/已完工）作业票必须有 6 位作业代码，
      -- 否则门卫扫码入场登记无法按作业代码定位到票。历史/种子数据可能缺失，这里统一回填。
      WITH t AS (
        SELECT id, 400000 + (row_number() OVER (ORDER BY created_at)) AS n
          FROM work_permits
         WHERE status IN ('printed','paused','finished') AND work_code IS NULL
      )
      UPDATE work_permits w
         SET work_code = t.n::text,
             training_qr_token = COALESCE(w.training_qr_token, md5(random()::text || w.id::text)),
             training_qr_expires_at = COALESCE(w.training_qr_expires_at, now() + interval '3 days')
        FROM t
       WHERE w.id = t.id
         AND NOT EXISTS (SELECT 1 FROM work_permits w2 WHERE w2.work_code = t.n::text);
    `);
    // 孤儿作业票对账（仅统计、绝不删除）。
    // 历史背景：系统早期把 work_permits 设计为 work_permit_applications 的“派生/同步镜像”（双模型兼容层），
    // 并配套了“孤儿清理”——某申请单被删除时自动删掉其作业票，这正是作业票曾无故消失的根因。
    // 现改为与隐患同等：作业票为独立业务实体，系统【绝不自动清理】。即便关联申请单已删除，作业票也保留。
    await this.runOnce('audit_orphan_synced_permits_v1', async () => {
      const { rows } = await this.pg.query(
        `SELECT count(*)::int AS n FROM work_permits
           WHERE channel = 'electronic'
             AND application_id IS NOT NULL
             AND application_id NOT IN (SELECT id FROM work_permit_applications);`,
      );
      const n = rows?.[0]?.n ?? 0;
      if (n > 0) {
        console.warn(`[migrate] 检测到 ${n} 张作业票的关联申请单已不存在（保留不删除，仅记录）`);
      }
    });
    // 数据修复（幂等、一次性）：审批链级去重。
    // 小组织常见「一人兼多职」（如安全主管与安全部门负责人同为刘洋），若链上出现同一审批人多次，
    // 合并为单一节点（被合并角色记入 mergedRoles），避免同一人对同一张票重复签两次。
    // 存量数据可能由早期未去重版本的代码生成，这里统一回填修正；新提交作业票已在 buildRouting 中实时去重。
    await this.runOnce('dedupe_approval_chain_v1', async () => {
      const pg: any = this.pg;
      if (!pg) return;
      const { rows } = await pg.query(
        `SELECT id, approval_chain FROM work_permits WHERE approval_chain IS NOT NULL AND jsonb_array_length(approval_chain) > 0`,
      );
      let fixed = 0;
      for (const r of rows) {
        const chain = r.approval_chain;
        if (!Array.isArray(chain) || chain.length === 0) continue;
        const deduped = dedupeChain(chain as any);
        if (deduped.length !== chain.length) {
          await pg.query(`UPDATE work_permits SET approval_chain = $1 WHERE id = $2`, [
            JSON.stringify(deduped),
            r.id,
          ]);
          fixed += 1;
        }
      }
      console.log(`[migrate] 审批链去重完成：检查 ${rows.length} 条，修正 ${fixed} 条`);
    });
    // 隐患编号规则迁移：YH-* / YH-DM-* → HZ-{YYYY}{NNNN}（按年度累计 4 位流水），与业务 genHazardNo 一致
    await this.runOnce('renumber_hazards_to_hz_v1', async () => {
      await this.renumberHazards();
    });
    // 危险作业票提交前置：work_permit_applications 增加 guardian_signatures（幂等 ALTER，兼容旧库）
    if (this.pg) {
      try {
        await (this.pg as any).query(
          `ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS guardian_signatures jsonb DEFAULT '[]'::jsonb`,
        );
      } catch (e) {
        console.warn(`[migrate] guardian_signatures 列创建失败（忽略）: ${(e as Error).message}`);
      }
      // 楼栋/楼层列（申请单 4 字段位置：楼栋/楼层/区域/具体位置，与隐患填报对齐）
      try {
        await (this.pg as any).query(`ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS building varchar(100)`);
        await (this.pg as any).query(`ALTER TABLE work_permit_applications ADD COLUMN IF NOT EXISTS floor varchar(100)`);
        await (this.pg as any).query(`ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS building varchar(100)`);
        await (this.pg as any).query(`ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS floor varchar(100)`);
      } catch (e) {
        console.warn(`[migrate] building/floor 列创建失败（忽略）: ${(e as Error).message}`);
      }
      // 编号规则：申请单 SQ- 前缀；作业票 GWP- 前缀。历史脏数据纠正：
      //  1) 用 GWP-* 写入了申请单的 → 改 SQ-*
      //  2) 用 SQ{YYYYMM}NNNN（无横线）老的 → 改 SQ-{YYYYMM}-NNNN（与新规一致）
      try {
        const upd1 = await (this.pg as any).query(
          `UPDATE work_permit_applications
             SET permit_no = REPLACE(permit_no, 'GWP-', 'SQ-')
             WHERE permit_no LIKE 'GWP-%'`,
        );
        // 老无横线格式 SQ2026080016（12 字符）→ SQ-202608-0016
        // LIKE 模式 SQ + 10 个下划线 = 12 字符匹配
        const upd2 = await (this.pg as any).query(
          `UPDATE work_permit_applications
             SET permit_no = 'SQ-' || SUBSTR(permit_no, 3, 6) || '-' || SUBSTR(permit_no, 9)
             WHERE permit_no LIKE 'SQ__________'`,
        );
        const total = (upd1?.rowCount || 0) + (upd2?.rowCount || 0);
        if (total > 0) {
          console.log(`[migrate] 申请单编号统一 SQ-*：GWP→SQ ${upd1?.rowCount || 0} 条 + 无横线→带横线 ${upd2?.rowCount || 0} 条`);
        }
      } catch (e) {
        console.warn(`[migrate] 申请单编号修正失败（忽略）: ${(e as Error).message}`);
      }
    }
    // 数据同步与双读校验已移至 onApplicationBootstrap：
    // 必须等 SeedService 把演示申请单灌入之后再来同步/校验，否则迁移阶段申请单还是 0，
    // 同步会写出 0 张作业票（即“重置后隐患在、作业票为 0”的根因）。
    await this.seedMeasureTemplates();
    // S07：refresh_tokens 表（刷新令牌轮换/吊销，支持单点登出与离职即时失效）
    // 明文令牌不落库，仅存 SHA-256 哈希；轮换时旧令牌置 revoked_at + replaced_by。
    await this.pg.exec(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash varchar(64) NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        replaced_by uuid,
        ua varchar(255),
        ip varchar(64),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_rt_user ON refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_rt_expires ON refresh_tokens(expires_at);
    `);
    // 抽奖记录表（纳入统一迁移，替代 service 内临时 CREATE TABLE，消除游离表）
    await this.pg.exec(`
      CREATE TABLE IF NOT EXISTS lottery_records (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid,
        user_name varchar(100),
        prize varchar(100) NOT NULL,
        source varchar(40),
        ref_id varchar(100),
        ref_no varchar(100),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_lottery_user ON lottery_records(user_id);
    `);
    // S13：关键表状态字段 CHECK 约束（仅当存量值全部合法时才添加，绝不破坏历史数据）
    await this.ensureStatusCheck(
      'work_permits', 'status',
      ['draft', 'pending_review', 'reviewing', 'ehs_reviewing', 'approved', 'rejected', 'printed', 'paused', 'finished', 'completed', 'voided'],
      'ck_work_permits_status',
    );
    await this.ensureStatusCheck(
      'work_permit_applications', 'status',
      ['draft', 'pending_review', 'reviewing', 'ehs_reviewing', 'approved', 'rejected', 'printed', 'paused', 'finished', 'completed', 'voided', 'converted'],
      'ck_work_permit_applications_status',
    );
    await this.ensureStatusCheck(
      'hazards', 'status',
      ['pending_assign', 'assigned', 'rectifying', 'rectified', 'dept_confirmed', 'rejected', 'accepted', 'archived', 'cancelled'],
      'ck_hazards_status',
    );
  }

  /**
   * 应用启动完成阶段（所有模块 onModuleInit 之后，含 SeedService 灌入演示数据）：
   * 在此做“申请单 → 作业票”同步与双模型双读校验，确保任何申请单（演示种子或运行时提交）
   * 都已对应作业票，解决“重置后隐患在、作业票为 0”的时序问题。
   */
  async onApplicationBootstrap() {
    if (!this.pg) return;
    try {
      // 为所有作业票申请创建对应的 work_permit 记录（两页共享数据）
      await this.syncWorkPermitsFromApplications();
      // S15：双模型一致性“双读校验”（仅安全清理真正的孤儿票，不破坏合法数据）
      await this.verifyDualModelConsistency();
      console.log('[migrate] onApplicationBootstrap：申请单↔作业票同步与双读校验完成');
    } catch (e) {
      console.warn(`[migrate] onApplicationBootstrap 同步/校验失败（忽略）: ${(e as Error).message}`);
    }
  }

  /**
   * S13：为状态列添加 CHECK 约束。
   * 安全策略：先读取存量 DISTINCT 值，仅当全部在合法集合内才加约束；
   * 存在未知值时跳过并告警，绝不因约束失败导致启动崩溃。
   */
  private async ensureStatusCheck(table: string, column: string, allowed: string[], name: string) {
    if (!this.pg) return;
    const pg: any = this.pg;
    try {
      const { rows } = await pg.query(`SELECT DISTINCT ${column} AS v FROM ${table}`);
      const existing = (rows || []).map((r: any) => String(r.v)).filter(Boolean);
      // 非空表：仅当全部存量值都在合法集合内才加约束，避免误伤历史数据
      if (existing.length > 0) {
        const bad = existing.filter((v) => !allowed.includes(v));
        if (bad.length > 0) {
          console.warn(`[migrate] ${table}.${column} 存在未知状态值 ${bad.join(', ')}，跳过 CHECK 约束（S13）`);
          return;
        }
      }
      const values = allowed.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');
      await pg.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`);
      await pg.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${column} IN (${values}))`);
      console.log(`[migrate] 已为 ${table}.${column} 添加状态 CHECK 约束（S13）`);
    } catch (e) {
      console.warn(`[migrate] ${table}.${column} CHECK 约束添加失败（忽略）: ${(e as Error).message}`);
    }
  }

  /**
   * 一次性迁移守卫：同一 key 只会执行一次，执行成功后写入 system_flags。
   * 用于承载“破坏性”数据清理，避免其在每次启动时重复执行造成数据丢失。
   */
  private async runOnce(key: string, fn: () => Promise<void>) {
    if (!this.pg) return;
    const pg: any = this.pg;
    try {
      const done = await pg.query(`SELECT 1 FROM system_flags WHERE key = $1 LIMIT 1`, [key]);
      if (done.rows?.length) return;
      await fn();
      await pg.query(`INSERT INTO system_flags (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [
        key,
        new Date().toISOString(),
      ]);
      console.log(`[migrate] 一次性迁移已执行：${key}`);
    } catch (e) {
      console.warn(`[migrate] 一次性迁移 ${key} 失败：${(e as Error).message}`);
    }
  }

  /**
   * 隐患编号规则统一：YH-* / YH-DM-* → HZ-{YYYY}{NNNN}（按年度累计 4 位流水），与业务 genHazardNo 一致
   * 幂等：已为 HZ-* 跳过
   */
  private async renumberHazards() {
    if (!this.pg) return;
    const pg: any = this.pg;
    const rows = await pg.query(
      `SELECT id, hazard_no, created_at FROM hazards WHERE hazard_no LIKE 'YH%' ORDER BY created_at, id`,
    );
    if (!rows.rows?.length) return;
    const yearCache = new Map<string, number>(); // year → 当前最大流水
    let renamed = 0;
    for (const r of rows.rows) {
      const year = String(new Date(r.created_at).getFullYear());
      const prefix = `HZ-${year}`;
      let maxSeq = yearCache.get(year) ?? 0;
      if (maxSeq === 0) {
        const max = await pg.query(
          `SELECT hazard_no FROM hazards WHERE hazard_no LIKE $1 ORDER BY hazard_no DESC LIMIT 1`,
          [`${prefix}%`],
        );
        if (max.rows?.length) {
          const tail = max.rows[0].hazard_no.slice(prefix.length);
          const m = tail.match(/^\d+$/);
          if (m) maxSeq = parseInt(m[0], 10);
        }
      }
      const seq = maxSeq + 1;
      yearCache.set(year, seq);
      const newNo = `${prefix}${String(seq).padStart(4, '0')}`;
      await pg.query(`UPDATE hazards SET hazard_no = $1 WHERE id = $2`, [`__tmp_${r.id}`, r.id]);
      try {
        await pg.query(`UPDATE hazards SET hazard_no = $1 WHERE id = $2`, [newNo, r.id]);
        renamed++;
      } catch (e: any) {
        await pg.query(`UPDATE hazards SET hazard_no = $1 WHERE id = $2`, [r.hazard_no, r.id]);
      }
    }
    if (renamed > 0) console.log(`[migrate] 已将 ${renamed} 条隐患编号由 YH-* 重命名为 HZ-{YYYY}{NNNN}`);
  }

  /**
   * S15 双读校验：申请单(work_permit_applications) 与作业票(work_permits) 双模型一致性检查。
   * 仅读取 + 安全清理“真正的孤儿票”，绝不破坏任何合法数据，也不改写双模型结构；
   * 符合文档“兼容层 + 双读校验、逐步合并”的路线（破坏性合并留待后续立项回归）。
   * - 危险申请单缺对应作业票：仅告警（sync 已尽力补齐，残留说明需业务回归）。
   * - 孤儿作业票（application_id 指向已删除的申请单）：安全删除（此类为垃圾残留，非业务数据）。
   */
  private async verifyDualModelConsistency() {
    if (!this.pg) return;
    const pg: any = this.pg;
    try {
      const hasHaz = await pg.query(
        `SELECT count(*)::int AS n FROM work_permit_applications a
          WHERE a.involves_hazardous = true
            AND NOT EXISTS (SELECT 1 FROM work_permits w WHERE w.application_id = a.id)`,
      );
      const orphan = await pg.query(
        `SELECT count(*)::int AS n FROM work_permits w
          WHERE w.channel = 'electronic'
            AND w.application_id IS NOT NULL
            AND w.application_id NOT IN (SELECT id FROM work_permit_applications)`,
      );
      const nHaz = hasHaz.rows?.[0]?.n ?? 0;
      const nOrphan = orphan.rows?.[0]?.n ?? 0;
      if (nOrphan > 0) {
        // 与隐患同等：作业票绝不自动清理。仅记录孤儿情况，不删除任何数据。
        console.warn(`[migrate][S15] 检测到 ${nOrphan} 张孤儿作业票（关联申请单已删除），按策略保留不删除，仅记录`);
      }
      if (nHaz > 0) {
        console.warn(`[migrate][S15] 双读校验告警：${nHaz} 条危险申请单缺少对应作业票（建议业务回归核查）`);
      } else if (nOrphan === 0) {
        console.log(`[migrate][S15] 双读校验通过：危险申请单均有对应作业票，无孤儿票`);
      }
    } catch (e) {
      console.warn(`[migrate][S15] 双读校验执行失败（忽略）: ${(e as Error).message}`);
    }
  }

  /**
   * 为所有作业票申请创建对应的 work_permits 记录
   * 实现作业票申请与作业票管理共享同一批数据
   * 幂等：已有关联的跳过
   */
  private async syncWorkPermitsFromApplications() {
    if (!this.pg) return;
    const pg: any = this.pg;
    // 找没有 work_permit 的作业票申请
    const orphan = await pg.query(`
      SELECT a.id, a.permit_no, a.job_name, a.content, a.area, a.location,
             a.department, a.plan_start, a.plan_end, a.status,
             a.involves_hazardous, a.hazard_type_list, a.operator_names, a.applicant_id, a.applicant_name
      FROM work_permit_applications a
      WHERE a.channel = 'electronic'
        AND a.involves_hazardous = true
        AND NOT EXISTS (SELECT 1 FROM work_permits w WHERE w.application_id = a.id)
      ORDER BY a.created_at
    `);
    if (!orphan.rows?.length) return;

    let synced = 0;
    for (const app of orphan.rows) {
      let type = 'other';
      const jobName = app.job_name || '';
      try {
        const htl = app.hazard_type_list ? JSON.parse(app.hazard_type_list) : [];
        if (htl.length > 0) {
          const label = htl[0];
          if (label.includes('动火')) type = 'hot_work';
          else if (label.includes('高处')) type = 'high_altitude';
          else if (label.includes('受限')) type = 'confined_space';
          else if (label.includes('起重')) type = 'lifting';
          else if (label.includes('临时')) type = 'temporary_electricity';
          else if (label.includes('动土')) type = 'excavation';
          else if (label.includes('盲板')) type = 'blind';
        } else {
          // 没有 hazardTypeList，根据 job_name 推测类型
          if (jobName.includes('动火')) type = 'hot_work';
          else if (jobName.includes('高处')) type = 'high_altitude';
          else if (jobName.includes('受限')) type = 'confined_space';
          else if (jobName.includes('起重') || jobName.includes('吊装')) type = 'lifting';
          else if (jobName.includes('用电') || jobName.includes('配电')) type = 'temporary_electricity';
          else if (jobName.includes('动土') || jobName.includes('挖掘') || jobName.includes('开挖')) type = 'excavation';
          else if (jobName.includes('盲板')) type = 'blind';
        }
      } catch {}
      const isHazardous = true; // 上面已过滤，只同步危险作业

      // 生成唯一编号（正式规则：{类型前缀}-{YYYYMM}-{4位流水}，与业务 genPermitNo 一致，杜绝 ZY 旧格式）
      const ym = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      const prefix = `${permitNoPrefix(type)}-${ym}-`;
      const [aRes, wRes] = await Promise.all([
        pg.query(`SELECT permit_no FROM work_permit_applications WHERE permit_no LIKE $1 ORDER BY permit_no DESC LIMIT 1`, [`${prefix}%`]),
        pg.query(`SELECT permit_no FROM work_permits WHERE permit_no LIKE $1 ORDER BY permit_no DESC LIMIT 1`, [`${prefix}%`]),
      ]);
      let seq = 1;
      for (const res of [aRes, wRes]) {
        if (res.rows?.length) {
          const m = res.rows[0].permit_no.slice(prefix.length).match(/^\d+$/);
          if (m) seq = Math.max(seq, parseInt(m[0], 10) + 1);
        }
      }
      const wpNo = `${prefix}${String(seq).padStart(4, '0')}`;

      const opNames = app.operator_names ? (() => { try { return JSON.parse(app.operator_names); } catch { return []; } })() : [];
      await pg.query(`
        INSERT INTO work_permits (permit_no, type, is_hazardous, channel, application_id,
          area, location, content, department, start_time, end_time, status,
          operator_names, applicant_id, applicant_name)
        VALUES ($1,$2,$3,'electronic',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      `, [wpNo, type, isHazardous, app.id,
        app.area || '', app.location || '',
        app.content || app.job_name || '', app.department || '',
        app.plan_start || new Date(), app.plan_end || new Date(),
        app.status || 'draft',
        JSON.stringify(opNames), app.applicant_id, app.applicant_name || '',
      ]);
      synced++;
    }
    console.log(`[migrate] 已同步 ${synced} 条危险作业作业票申请到 work_permits`);
  }

  private async hasCoreTables(): Promise<boolean> {
    try {
      const res = await this.pg.query(
        "SELECT (SELECT to_regclass('public.users') IS NOT NULL) AS u, (SELECT to_regclass('public.work_permit_applications') IS NOT NULL) AS a, (SELECT to_regclass('public.safety_briefings') IS NOT NULL) AS b, (SELECT to_regclass('public.inspection_records') IS NOT NULL) AS i;",
      );
      const r = res.rows?.[0];
      return !!(r?.u && r?.a && r?.b && r?.i);
    } catch {
      return false;
    }
  }

  // 作业票措施模板：内容按原纸质模板整理，仅空表时首次灌入。
  // 已存在内容（含管理员自定义措施）绝不整表重灌，避免每次启动清空定制数据。
  private async seedMeasureTemplates() {
    try {
      const c = await this.pg.query('SELECT count(*)::int AS n FROM measure_templates');
      if ((c.rows?.[0]?.n ?? 0) > 0) {
        return; // 已有内容，保留现状
      }
      const rows: { type: string; category: string; content: string; note: string | null; sort: number }[] = [];
      for (const [type, measures] of Object.entries(SAFETY_MEASURES)) {
        for (const m of measures as Array<{ category: string; content: string; note?: string; sort: number }>) {
          rows.push({ type, category: m.category, content: m.content, note: m.note ?? null, sort: m.sort });
        }
      }
      if (rows.length === 0) return;
      // 分批插入，规避参数过多
      const BATCH = 200;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const vals = batch.map((r) => `('${r.type.replace(/'/g, "''")}', '${r.category}', '${r.content.replace(/'/g, "''")}', ${r.note ? `'${r.note.replace(/'/g, "''")}'` : 'NULL'}, ${r.sort})`).join(', ');
        await this.pg.exec(`INSERT INTO measure_templates (type, category, content, note, sort) VALUES ${vals};`);
      }
      // eslint-disable-next-line no-console
      console.log(`[seed] measure_templates 首次灌入 ${rows.length} 条`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[seed] measure_templates 灌入失败（可忽略，不影响主流程）:', (e as Error).message);
    }
  }
}
