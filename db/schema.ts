import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// Accounts exist before a character is named. Migrating keeps its original owner ID.
export const accounts = sqliteTable('campus_accounts', {
  ownerId: text('owner_id').primaryKey(),
  email: text('email').notNull().unique(),
  createdAt: integer('created_at').notNull(),
});
export const sessions = sqliteTable('campus_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => accounts.ownerId),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('campus_sessions_expiry').on(table.expiresAt)]);
export const emailChallenges = sqliteTable('campus_email_challenges', {
  ticketHash: text('ticket_hash').primaryKey(),
  email: text('email').notNull(),
  codeHash: text('code_hash').notNull(),
  bindOwner: text('bind_owner'),
  bindKeyHash: text('bind_key_hash'),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: integer('expires_at').notNull(),
  consumedBy: text('consumed_by'),
}, table => [index('campus_email_challenges_expiry').on(table.expiresAt)]);

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
  kind: text('kind').notNull().default('message'),
  place: text('place').notNull(),
  at: integer('at').notNull(),
  text: text('text').notNull(),
}, table => [index('campus_conversations_speaker_seq').on(table.speakerId, table.seq), index('campus_conversations_recipient_seq').on(table.recipientId, table.seq),index('campus_conversations_pair').on(table.speakerId,table.recipientId,table.seq)]);
