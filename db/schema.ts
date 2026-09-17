import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const characters = sqliteTable('campus_characters', {
  ownerId: text('owner_id').primaryKey(),
  id: text('id').notNull().unique(),
  state: text('state').notNull(),
  revision: integer('revision').notNull().default(0),
  lastOp: text('last_op').notNull(),
  tokenHash: text('token_hash').unique(),
  tokenExpiresAt: integer('token_expires_at'),
  ownerKeyHash: text('owner_key_hash').unique(),
});
export const registrationLimits = sqliteTable('campus_registration_limits', {
  bucket: text('bucket').primaryKey(),
  count: integer('count').notNull(),
  expiresAt: integer('expires_at').notNull(),
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

export const oauthClients = sqliteTable('campus_oauth_clients', {
  clientId: text('client_id').primaryKey(),
  clientName: text('client_name').notNull(),
  redirectUris: text('redirect_uris').notNull(),
  createdAt: integer('created_at').notNull(),
});
export const oauthCodes = sqliteTable('campus_oauth_codes', {
  codeHash: text('code_hash').primaryKey(),
  clientId: text('client_id').notNull().references(() => oauthClients.clientId),
  ownerId: text('owner_id').notNull().references(() => characters.ownerId),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  resource: text('resource').notNull(),
  scope: text('scope').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('campus_oauth_codes_expires').on(table.expiresAt)]);

// Only the two participants can read a conversation. Names are event-time snapshots.
export const conversations = sqliteTable('campus_conversations', {
  seq: integer('seq').primaryKey({autoIncrement:true}),
  id: text('id').notNull().unique(),
  decisionId: text('decision_id').notNull().unique(),
  speakerId: text('speaker_id').notNull().references(() => characters.id),
  speakerName: text('speaker_name').notNull(),
  recipientId: text('recipient_id').notNull().references(() => characters.id),
  recipientName: text('recipient_name').notNull(),
  place: text('place').notNull(),
  at: integer('at').notNull(),
  text: text('text').notNull(),
}, table => [index('campus_conversations_speaker_seq').on(table.speakerId, table.seq), index('campus_conversations_recipient_seq').on(table.recipientId, table.seq)]);
