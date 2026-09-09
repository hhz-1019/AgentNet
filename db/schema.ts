import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const characters = sqliteTable('campus_characters', {
  ownerId: text('owner_id').primaryKey(),
  id: text('id').notNull().unique(),
  state: text('state').notNull(),
  revision: integer('revision').notNull().default(0),
  lastOp: text('last_op').notNull(),
  tokenHash: text('token_hash').unique(),
});
export const events = sqliteTable('campus_events', {
  id: text('id').primaryKey(),
  actorId: text('actor_id').notNull().references(() => characters.id),
  seq: integer('seq').notNull(),
  at: integer('at').notNull(),
  kind: text('kind').notNull(),
  text: text('text').notNull(),
  sources: text('sources').notNull().default('[]'),
}, table => [index('campus_events_actor_seq').on(table.actorId, table.seq)]);
export const pairs = sqliteTable('campus_pairs', {
  code: text('code').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: integer('expires_at').notNull(),
  claimedBy: text('claimed_by'),
});
