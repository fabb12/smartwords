import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), title: text('title').notNull(),
  content: text('content').notNull(), updated: integer('updated').notNull(), version: integer('version').notNull().default(1),
});
export const revisions = sqliteTable('revisions', {
  id: text('id').primaryKey(), document: text('document').notNull(), owner: text('owner').notNull(),
  title: text('title').notNull(), content: text('content').notNull(), created: integer('created').notNull(),
});
export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), name: text('name').notNull(), provider: text('provider').notNull(),
  model: text('model').notNull(), secret: text('secret').notNull(), hint: text('hint').notNull(),
  dailyLimit: integer('daily_limit').notNull().default(500), created: integer('created').notNull(),
});
export const usage = sqliteTable('usage', { id: text('id').primaryKey(), count: integer('count').notNull().default(0) });
export const projects = sqliteTable('projects', {
  document: text('document').primaryKey(), owner: text('owner').notNull(), data: text('data').notNull(), updated: integer('updated').notNull(),
});
