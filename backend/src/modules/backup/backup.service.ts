import { Injectable, Logger, Inject, BadRequestException, NotFoundException, OnModuleInit } from '@nestjs/common';
import { CronJob } from 'cron';
import { execSync } from 'child_process';
import { createWriteStream } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import archiver from 'archiver';
const createArchive = (archiver as any) || require('archiver');
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, desc, count } from 'drizzle-orm';
import * as schema from '@/database/schema';
import { ConfigService } from '@nestjs/config';

export interface BackupConfig {
  enabled: boolean;
  cycle: 'weekly' | '15days' | 'monthly' | '2months' | 'quarterly';
  includePhotos: boolean;
  keepCount: number; // 默认 5
  hour: number; // 默认 2
  minute: number; // 默认 0
}

const DEFAULT_CONFIG: BackupConfig = {
  enabled: true,
  cycle: 'weekly',
  includePhotos: true,
  keepCount: 5,
  hour: 2,
  minute: 0,
};

// 备份：优先用 pg_dump 生成可恢复 SQL；同时可选打包 uploads 照片目录。
// 自动备份：每天北京时间凌晨 2 点检查一次，按周期执行，保留最近 N 份。
@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);
  private dir = process.env.BACKUP_DIR || '/app/backups';
  private cronJob: CronJob | null = null;

  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    private cfg: ConfigService,
  ) {}

  async onModuleInit() {
    try {
      await this.startAutoJob();
    } catch (e: any) {
      this.logger.error(`启动自动备份任务失败：${e?.message}`);
    }
  }

  private ts(d = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  async getConfig(): Promise<BackupConfig> {
    const [row] = await this.db.select().from(schema.systemConfig).where(eq(schema.systemConfig.key, 'backup_config')).limit(1);
    if (!row || !row.value) return DEFAULT_CONFIG;
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(row.value) };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  async saveConfig(cfg: Partial<BackupConfig>) {
    const cur = await this.getConfig();
    const next = { ...cur, ...cfg };
    await this.db
      .insert(schema.systemConfig)
      .values({ key: 'backup_config', value: JSON.stringify(next) })
      .onConflictDoUpdate({ target: schema.systemConfig.key, set: { value: JSON.stringify(next), updatedAt: new Date() } });
    this.restartAutoJob();
    return { success: true };
  }

  // 启动自动备份任务（北京时间每天凌晨 2 点检查一次）
  private async startAutoJob() {
    if (this.cronJob) return;
    const cfg = await this.getConfig();
    const cronExpr = `${cfg.minute} ${cfg.hour} * * *`;
    this.cronJob = new CronJob(
      cronExpr,
      async () => {
        try {
          await this.autoRunIfNeeded();
        } catch (e: any) {
          this.logger.error(`自动备份失败：${e?.message}`);
        }
      },
      null,
      true,
      'Asia/Shanghai',
    );
    this.logger.log(`自动备份已启动：${cronExpr}（北京时间），周期：${cfg.cycle}，保留 ${cfg.keepCount} 份`);
  }

  private restartAutoJob() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    this.startAutoJob();
  }

  // 根据周期和上次备份时间判断是否需要执行
  private async autoRunIfNeeded() {
    const cfg = await this.getConfig();
    if (!cfg.enabled) {
      this.logger.log('自动备份已禁用，跳过');
      return;
    }
    const files = await this.listFiles();
    const latest = files[0]?.mtime;
    const now = new Date();
    if (latest && !this.shouldBackupToday(latest, cfg.cycle, now)) {
      this.logger.log('未到备份周期，跳过');
      return;
    }
    this.logger.log('触发自动备份...');
    const { file, backupKind } = await this.run('download');
    await this.log('download', file);
    await this.enforceRetention(cfg.keepCount);
  }

  private shouldBackupToday(lastBackupTime: Date, cycle: string, now: Date): boolean {
    const last = new Date(lastBackupTime);
    const diffDays = Math.floor((now.getTime() - last.getTime()) / (24 * 60 * 60 * 1000));
    switch (cycle) {
      case 'weekly':
        return diffDays >= 7;
      case '15days':
        return diffDays >= 15;
      case 'monthly':
        return now.getMonth() !== last.getMonth() || now.getFullYear() !== last.getFullYear();
      case '2months':
        const diffMonths = (now.getFullYear() - last.getFullYear()) * 12 + (now.getMonth() - last.getMonth());
        return diffMonths >= 2;
      case 'quarterly':
        const diffQuarters = (now.getFullYear() - last.getFullYear()) * 4 + Math.floor((now.getMonth() - last.getMonth()) / 3);
        return diffQuarters >= 1 || diffMonths >= 3;
      default:
        return diffDays >= 7;
    }
  }

  // 触发一次备份，返回 zip 文件路径
  async run(kind: 'download' | 'feishu' = 'download'): Promise<{ file: string; backupKind: string }> {
    await fs.mkdir(this.dir, { recursive: true });
    const cfg = await this.getConfig();
    const dateStr = this.ts();
    const zipFile = path.join(this.dir, `ehs-${dateStr}.zip`);
    const sqlFile = path.join(this.dir, `ehs-${dateStr}.sql`);
    const jsonFile = sqlFile.replace(/\.sql$/, '.json');
    const url = this.cfg.get<string>('DATABASE_URL') || '';

    let dataFile: string = sqlFile;
    let isSql = false;
    try {
      if (url) {
        execSync(`pg_dump "${url}" -f "${sqlFile}"`, { stdio: 'ignore', timeout: 120000 });
        isSql = true;
      } else {
        throw new Error('DATABASE_URL 未配置');
      }
    } catch (e: any) {
      this.logger.warn('pg_dump 不可用，退化为 JSON 导出：' + (e?.message || String(e)));
      await this.dumpJson(jsonFile);
      dataFile = jsonFile;
      isSql = false;
    }

    // 打包 数据库文件 + 照片
    await this.createZip(zipFile, dataFile, isSql, cfg.includePhotos);
    // 删除中间 SQL/JSON 文件
    try { await fs.unlink(sqlFile); } catch {}
    try { await fs.unlink(jsonFile); } catch {}

    return { file: zipFile, backupKind: 'zip' };
  }

  private async dumpJson(outFile: string) {
    const tables: Record<string, any> = {
      users: schema.users,
      roles: schema.roles,
      departments: schema.departments,
      departmentManagers: schema.departmentManagers,
      hazardTypes: schema.hazardTypes,
      hazards: schema.hazards,
      workPermits: schema.workPermits,
      certificateOcr: schema.certificateOcr,
      workPermitChecks: schema.workPermitChecks,
      systemConfig: schema.systemConfig,
      backupLog: schema.backupLog,
    };
    const out: Record<string, any[]> = {};
    for (const [k, t] of Object.entries(tables)) {
      out[k] = await this.db.select().from(t as any);
    }
    await fs.writeFile(outFile, JSON.stringify(out, null, 2));
  }

  private async createZip(zipFile: string, dataFile: string, isSql: boolean, includePhotos: boolean) {
    const output = createWriteStream(zipFile);
    const archive = (createArchive as any)('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => { throw err; });
    archive.pipe(output);

    // 数据库文件
    const basename = path.basename(dataFile);
    try {
      await fs.access(dataFile);
      archive.file(dataFile, { name: `database/${basename}` });
    } catch {
      this.logger.warn('数据库导出文件不存在，跳过打包：' + dataFile);
    }

    // 照片目录
    if (includePhotos) {
      const uploadDir = this.cfg.get<string>('UPLOAD_DIR') || './uploads';
      try {
        await fs.access(uploadDir);
        archive.directory(uploadDir, 'uploads');
      } catch {
        this.logger.warn('照片目录不存在，跳过打包：' + uploadDir);
      }
    }

    await archive.finalize();
    return new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve());
      output.on('error', reject);
    });
  }

  // 列出历史备份文件（按时间倒序，最新的在最前）
  async list(): Promise<{ name: string; size: number; time: string; mtime: Date }[]> {
    const files = await this.listFiles();
    return files.map((f) => ({ name: f.name, size: f.size, time: f.mtime.toISOString(), mtime: f.mtime }));
  }

  private async listFiles(): Promise<{ name: string; size: number; mtime: Date }[]> {
    try {
      const files = await fs.readdir(this.dir);
      const infos = await Promise.all(
        files
          .filter((f) => f.endsWith('.zip') || f.endsWith('.sql') || f.endsWith('.json'))
          .map(async (f) => {
            const st = await fs.stat(path.join(this.dir, f));
            return { name: f, size: st.size, mtime: st.mtime };
          }),
      );
      return infos.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    } catch {
      return [];
    }
  }

  async pathOf(name: string): Promise<string> {
    const fp = path.join(this.dir, path.basename(name));
    await fs.access(fp);
    return fp;
  }

  async deleteBackup(name: string) {
    const files = await this.listFiles();
    if (files.length === 0) throw new NotFoundException('备份文件不存在');
    const target = files.find((f) => f.name === name);
    if (!target) throw new NotFoundException('备份文件不存在');
    if (target.mtime.getTime() === files[0].mtime.getTime()) {
      throw new BadRequestException('最新的备份不能删除');
    }
    await fs.unlink(path.join(this.dir, target.name));
    return { success: true };
  }

  // 执行保留策略，只保留最近 N 份
  async enforceRetention(keepCount?: number) {
    const cfg = await this.getConfig();
    const keep = keepCount ?? cfg.keepCount ?? 5;
    const files = await this.listFiles();
    const toDelete = files.slice(keep);
    for (const f of toDelete) {
      try {
        await fs.unlink(path.join(this.dir, f.name));
        this.logger.log(`已清理旧备份：${f.name}`);
      } catch (e: any) {
        this.logger.error(`清理旧备份失败：${f.name} ${e?.message}`);
      }
    }
    return { deleted: toDelete.length };
  }

  // 同步到飞书多维表格
  async syncFeishu(): Promise<{ ok: boolean; message: string }> {
    const appId = this.cfg.get('FEISHU_APP_ID');
    const appSecret = this.cfg.get('FEISHU_APP_SECRET');
    const appToken = this.cfg.get('FEISHU_BITABLE_APP_TOKEN');
    const tableId = this.cfg.get('FEISHU_BITABLE_TABLE_ID');
    if (!appId || !appSecret || !appToken || !tableId) {
      return { ok: false, message: '未配置飞书多维表格凭证，请使用“下载备份”功能，或参考部署文档配置 FEISHU_* 环境变量。' };
    }
    try {
      const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      });
      const tokenJson: any = await tokenRes.json();
      const tenantToken = tokenJson.tenant_access_token;
      if (!tenantToken) return { ok: false, message: '获取飞书令牌失败：' + JSON.stringify(tokenJson) };

      const [haz] = await this.db.select({ c: count() } as any).from(schema.hazards);
      const [wp] = await this.db.select({ c: count() } as any).from(schema.workPermits);
      const records = [
        {
          fields: {
            备份时间: new Date().toLocaleString('zh-CN'),
            隐患总数: Number((haz as any)?.c ?? 0),
            作业票总数: Number((wp as any)?.c ?? 0),
            类型: '自动同步',
          },
        },
      ];
      const r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tenantToken}` },
        body: JSON.stringify({ records }),
      });
      const j: any = await r.json();
      if (j.code !== 0) return { ok: false, message: '飞书写入失败：' + JSON.stringify(j) };
      await this.log('feishu', 'ok');
      return { ok: true, message: '已同步到飞书多维表格。' };
    } catch (e: any) {
      return { ok: false, message: '飞书同步异常：' + e?.message };
    }
  }

  async log(kind: string, target: string) {
    await this.db.insert(schema.backupLog).values({ kind, target, status: 'success' });
  }

  async lastLogs() {
    return this.db.select().from(schema.backupLog).orderBy(desc(schema.backupLog.createdAt)).limit(20);
  }
}
