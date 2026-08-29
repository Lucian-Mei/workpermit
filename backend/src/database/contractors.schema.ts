import { pgTable, uuid, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';

/**
 * 承包商库：每次申请单填写承包商信息时自动录入（按单位+负责人去重），
 * 下次下拉快速调用；支持停用，停用后下拉不显示（但历史申请单仍保留记录）。
 */
export const contractors = pgTable('contractors', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 200 }).notNull(),         // 承包商单位
  head: varchar('head', { length: 100 }),                    // 现场负责人姓名
  phone: varchar('phone', { length: 50 }),                   // 联系电话
  enabled: boolean('enabled').notNull().default(true),       // 停用开关
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
