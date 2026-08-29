import { pgTable, uuid, varchar, integer, boolean, timestamp, jsonb, text } from 'drizzle-orm/pg-core';

/**
 * 系统配置表（一级安全培训）
 */
export const trainingConfig = pgTable('training_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: varchar('key', { length: 50 }).notNull().unique(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * 一级安全培训试题
 */
export const trainingQuestions = pgTable('training_questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  question: text('question').notNull(),
  options: jsonb('options').$type<string[]>().notNull(), // ["A. xxx", "B. xxx", ...]
  answer: varchar('answer', { length: 10 }).notNull(),   // "A", "B", "C", "D"
  sort: integer('sort').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * 一级安全培训记录（作业人员）
 */
export const trainingRecords = pgTable('training_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),        // 受训人姓名
  idCard: varchar('id_card', { length: 50 }),              // 身份证号（S12：培训合格身份唯一键）
  phone: varchar('phone', { length: 50 }),                 // 联系电话
  score: integer('score'),                                  // 考试成绩
  total: integer('total'),                                  // 总分
  passed: boolean('passed').notNull().default(false),       // 是否通过
  passedAt: timestamp('passed_at', { withTimezone: true }), // 通过时间
  validUntil: timestamp('valid_until', { withTimezone: true }), // 有效期截止
  answers: jsonb('answers').$type<{ questionId: string; question: string; userAnswer: string; correctAnswer: string; isCorrect: boolean }[]>(), // 单题答案详情
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
