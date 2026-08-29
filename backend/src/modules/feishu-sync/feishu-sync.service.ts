import { Injectable, Logger } from '@nestjs/common';

/**
 * 飞书多维表格同步服务（预留接口）
 * ------------------------------------------------------------------
 * 设计目标：在作业票/申请单归档时，把结构化数据「预留」一条同步通道，
 * 便于后续真正对接飞书开放平台（bitable）多维表格。
 *
 * 当前为【桩实现】：仅当环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET /
 * FEISHU_BITABLE_URL 全部配置时才会尝试发起请求；否则直接 no-op 返回，
 * 绝不阻断主流程（归档/打印照常完成）。
 *
 * 后续对接时只需在本文件实现 doSync()，把 payload 映射到飞书 bitable 记录即可。
 */
@Injectable()
export class FeishuSyncService {
  private readonly logger = new Logger(FeishuSyncService.name);
  private readonly enabled =
    !!process.env.FEISHU_APP_ID &&
    !!process.env.FEISHU_APP_SECRET &&
    !!process.env.FEISHU_BITABLE_URL;

  /** 是否已配置飞书（供其它模块判断是否可调用） */
  get isConfigured(): boolean {
    return this.enabled;
  }

  /**
   * 同步一条作业票/申请单到飞书多维表格（预留接口）。
   * @param kind 'work_permit' | 'application'
   * @param payload 已序列化的结构化数据
   * @returns 是否实际发起（未配置则返回 false，调用方忽略即可）
   */
  async sync(kind: 'work_permit' | 'application', payload: Record<string, any>): Promise<boolean> {
    if (!this.enabled) {
      // 未配置：纯预留，不报错、不联网。
      return false;
    }
    try {
      // TODO(对接时实现)：用 FEISHU_APP_ID/SECRET 换取 tenant_access_token，
      // 再 POST FEISHU_BITABLE_URL 写入记录。当前仅记录意图。
      this.logger.log(
        `[feishu-stub] 将同步 ${kind} permitNo=${payload.permitNo ?? '?'}（接口已预留，未实际推送）`,
      );
      await this.doSync(kind, payload);
      return true;
    } catch (e: any) {
      // 同步失败绝不影响主业务
      this.logger.warn(`[feishu-stub] 同步失败（已忽略）：${e?.message ?? e}`);
      return false;
    }
  }

  /** 真正发起飞书请求的位置（预留，默认空实现）。 */
  private async doSync(_kind: 'work_permit' | 'application', _payload: Record<string, any>): Promise<void> {
    /* 接口预留：后续在此调用飞书 OpenAPI */
  }
}
