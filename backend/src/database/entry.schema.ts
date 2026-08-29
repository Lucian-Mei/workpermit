import { pgTable, uuid, varchar, boolean, timestamp, text, integer, index } from 'drizzle-orm/pg-core';

/**
 * 工人入厂登记记录
 */
export const entryRegistrations = pgTable('entry_registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  // 独立危险作业票可不挂申请单，故允许为空
  applicationId: uuid('application_id'),
  workPermitId: uuid('work_permit_id'),
  contractorUnit: varchar('contractor_unit', { length: 200 }).notNull(),
  workerName: varchar('worker_name', { length: 100 }).notNull(),
  workerIdCard: varchar('worker_id_card', { length: 50 }),
  workerPhone: varchar('worker_phone', { length: 50 }),
  trainingPassed: boolean('training_passed').notNull().default(false),
  trainingRecordId: uuid('training_record_id'),
  signImg: text('sign_img'),
  /** 入场闸口标识（门卫岗位/闸机编号），便于统计各门人流 */
  gate: varchar('gate', { length: 50 }),
  signOutAt: timestamp('sign_out_at', { withTimezone: true }),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxWp: index('idx_entry_reg_wp').on(t.workPermitId),
  idxIdCard: index('idx_entry_reg_idcard').on(t.workerIdCard),
}));

/**
 * 在线培训尝试记录
 */
export const trainingAttempts = pgTable('training_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  workPermitId: uuid('work_permit_id'),
  workerName: varchar('worker_name', { length: 100 }).notNull(),
  workerIdCard: varchar('worker_id_card', { length: 50 }).notNull(),
  step: varchar('step', { length: 20 }).notNull(),
  score: integer('score'),
  trainingRecordId: uuid('training_record_id'),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxWp: index('idx_training_attempts_wp').on(t.workPermitId),
}));
