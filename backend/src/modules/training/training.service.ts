import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, desc, sql, gte } from 'drizzle-orm';
import * as schema from '@/database/schema';

@Injectable()
export class TrainingService {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  // =========== 系统配置 ===========
  async getConfig(key: string): Promise<string | null> {
    const rows = await this.db.select({ value: schema.trainingConfig.value }).from(schema.trainingConfig).where(eq(schema.trainingConfig.key, key)).limit(1);
    return rows[0]?.value ?? null;
  }
  async getAllConfig() {
    const rows = await this.db.select().from(schema.trainingConfig);
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    return map;
  }
  async setConfig(key: string, value: string) {
    await this.db.insert(schema.trainingConfig).values({ key, value }).onConflictDoUpdate({ target: schema.trainingConfig.key, set: { value, updatedAt: new Date() } });
    return { success: true };
  }

  // =========== 试题管理 ===========
  async listQuestions() {
    return this.db.select().from(schema.trainingQuestions).orderBy(schema.trainingQuestions.sort);
  }
  async createQuestion(dto: { question: string; options: string[]; answer: string; sort?: number }) {
    if (!dto.question) throw new BadRequestException('请填写题目');
    if (!dto.options || dto.options.length < 2) throw new BadRequestException('至少需要 2 个选项');
    if (!dto.answer) throw new BadRequestException('请填写正确答案');
    const ins = await this.db.insert(schema.trainingQuestions).values({ question: dto.question, options: dto.options, answer: dto.answer.toUpperCase(), sort: dto.sort ?? 0 }).returning({ id: schema.trainingQuestions.id });
    return { id: ins[0].id };
  }
  async updateQuestion(id: string, dto: Partial<{ question: string; options: string[]; answer: string; sort: number; enabled: boolean }>) {
    const exist = await this.db.select({ id: schema.trainingQuestions.id }).from(schema.trainingQuestions).where(eq(schema.trainingQuestions.id, id)).limit(1);
    if (!exist.length) throw new NotFoundException('试题不存在');
    const patch: any = { updatedAt: new Date() };
    if (dto.question !== undefined) patch.question = dto.question;
    if (dto.options !== undefined) patch.options = dto.options;
    if (dto.answer !== undefined) patch.answer = dto.answer.toUpperCase();
    if (dto.sort !== undefined) patch.sort = dto.sort;
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    await this.db.update(schema.trainingQuestions).set(patch).where(eq(schema.trainingQuestions.id, id));
    return { success: true };
  }
  async deleteQuestion(id: string) {
    await this.db.delete(schema.trainingQuestions).where(eq(schema.trainingQuestions.id, id));
    return { success: true };
  }

  // =========== 考试与记录 ===========
  /** 获取考试试卷：随机抽取 N 道启用中的试题 */
  async getExam(count?: number) {
    const n = count || Number(await this.getConfig('question_count')) || 5;
    const all = await this.db.select().from(schema.trainingQuestions).where(eq(schema.trainingQuestions.enabled, true)).orderBy(sql`random()`).limit(Math.min(n, 30));
    if (all.length < 1) throw new BadRequestException('暂无可用的考试试题，请先联系管理员配置');
    return all.map((q) => ({ id: q.id, question: q.question, options: q.options }));
  }

  /** 提交考试答案 */
  async submitExam(dto: { name: string; idCard?: string; phone?: string; answers: { questionId: string; answer: string }[] }) {
    if (!dto.name?.trim()) throw new BadRequestException('请填写姓名');
    if (!dto.answers || dto.answers.length === 0) throw new BadRequestException('请作答后再提交');
    const ids = dto.answers.map((a) => a.questionId);
    const questions = await Promise.all(ids.map((qid) => this.db.select().from(schema.trainingQuestions).where(eq(schema.trainingQuestions.id, qid)).limit(1).then((r) => r[0])));
    const qMap: Record<string, { answer: string; question: string }> = {};
    for (const q of questions) { if (q) qMap[q.id] = { answer: q.answer, question: q.question }; }
    let score = 0;
    const answerDetails: any[] = [];
    for (const a of dto.answers) {
      const correct = a.answer.toUpperCase() === qMap[a.questionId]?.answer;
      if (correct) score++;
      answerDetails.push({
        questionId: a.questionId,
        question: qMap[a.questionId]?.question || a.questionId,
        userAnswer: a.answer.toUpperCase(),
        correctAnswer: qMap[a.questionId]?.answer || '',
        isCorrect: correct,
      });
    }
    const total = dto.answers.length;
    const passScore = Number(await this.getConfig('pass_score')) || 60;
    const percent = Math.round((score / total) * 100);
    const passed = percent >= passScore;
    const validityDays = Number(await this.getConfig('validity_days')) || 90;
    const passedAt = new Date();
    const validUntil = new Date(passedAt.getTime() + validityDays * 86400000);
    // S12：身份证号作为培训合格身份唯一键（大写归一，防止大小写/全半角差异）
    const idCard = (dto.idCard || '').trim().toUpperCase() || null;
    const rec = await this.db.insert(schema.trainingRecords).values({ name: dto.name.trim(), idCard, phone: dto.phone || null, score, total, passed, passedAt: passed ? passedAt : undefined, validUntil: passed ? validUntil : undefined, answers: answerDetails }).returning({ id: schema.trainingRecords.id });
    return { id: rec[0].id, name: dto.name, idCard, score, total, percent, passed, passedAt, validUntil, answers: answerDetails };
  }

  /**
   * 查询某人是否有效期内的培训记录（S12：身份证号为唯一键）
   * - 提供了身份证号 → 严格按身份证匹配，绝不按姓名兜底（同名人员不会互相顶替/冒领）。
   * - 未提供身份证号 → 手机号+姓名 → 仅姓名（旧数据兜底）。
   */
  async findValidRecord(query: { name?: string; idCard?: string; phone?: string }): Promise<{ passed: boolean; validUntil?: Date; message?: string } | null> {
    const idCard = (query.idCard || '').trim().toUpperCase() || null;
    const phone = (query.phone || '').trim() || null;
    const name = (query.name || '').trim() || null;

    // 身份证号优先且唯一：提供即严格匹配，不回落姓名
    if (idCard) {
      return this.findLatestPassed([eq(schema.trainingRecords.idCard, idCard)]);
    }
    // 次选：手机号（需同时姓名一致，避免手机号换人后误认）
    if (phone && name) {
      const byPhone = await this.findLatestPassed([eq(schema.trainingRecords.phone, phone), eq(schema.trainingRecords.name, name)]);
      if (byPhone) return byPhone;
    }
    // 兜底：仅姓名（未提供任何身份标识的旧数据场景）
    if (name) {
      return this.findLatestPassed([eq(schema.trainingRecords.name, name)]);
    }
    return null;
  }

  private async findLatestPassed(conds: any[]): Promise<{ passed: boolean; validUntil?: Date; message?: string } | null> {
    const rows = await this.db
      .select()
      .from(schema.trainingRecords)
      .where(and(eq(schema.trainingRecords.passed, true), ...conds))
      .orderBy(desc(schema.trainingRecords.createdAt))
      .limit(1);
    if (!rows.length) return null;
    const r = rows[0];
    if (r.validUntil && r.validUntil > new Date()) {
      return { passed: true, validUntil: r.validUntil, message: `该人员一级安全培训有效（${r.validUntil.toLocaleDateString('zh-CN')} 前无需重训）` };
    }
    return { passed: false, message: '培训已过期，需重新参加一级安全培训考试' };
  }

  /** 培训记录列表 */
  async listRecords(name?: string, idCard?: string) {
    const where: any[] = [];
    if (name) where.push(eq(schema.trainingRecords.name, name));
    if (idCard) where.push(eq(schema.trainingRecords.idCard, idCard.trim().toUpperCase()));
    return this.db.select().from(schema.trainingRecords).where(where.length ? and(...where) : undefined).orderBy(desc(schema.trainingRecords.createdAt));
  }
}
