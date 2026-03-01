import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase/rls";
import { profiles } from "./profiles";

// Configured input: an RSS feed, API endpoint, scrape target, etc.
export const sources = pgTable(
  "sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    name: text("name").notNull(),
    type: text("type").notNull(), // rss | api | scrape | upload | extension | bookmark_import | manual
    config: jsonb("config").notNull().default({}),
    pipeline: text("pipeline"), // Elo pipeline expression (extract+filter+transform)
    schedule: jsonb("schedule"), // { interval_ms: 300000 } or { cron: "*/5 * * * *" } or null
    runState: jsonb("run_state").default({}),
    isActive: boolean("is_active").notNull().default(true),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    pgPolicy("sources_select_own", {
      for: "select",
      to: authenticatedRole,
      using: sql`(select ${authUid}) = ${table.userId}`,
    }),
    pgPolicy("sources_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select ${authUid}) = ${table.userId}`,
    }),
    pgPolicy("sources_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`(select ${authUid}) = ${table.userId}`,
    }),
    pgPolicy("sources_delete_own", {
      for: "delete",
      to: authenticatedRole,
      using: sql`(select ${authUid}) = ${table.userId}`,
    }),
  ],
).enableRLS();

// Raw payload per ingestion event — never modified.
export const sourcePayloads = pgTable(
  "source_payloads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    data: jsonb("data"), // inline for small payloads
    storageKey: text("storage_key"), // S3 key for large payloads
    storageBackend: text("storage_backend").notNull().default("inline"),
    format: text("format").notNull(), // json | xml | csv | html | pdf | media
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    pgPolicy("payloads_select_own", {
      for: "select",
      to: authenticatedRole,
      using: sql`${table.sourceId} in (select id from sources where user_id = (select ${authUid}))`,
    }),
    pgPolicy("payloads_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${table.sourceId} in (select id from sources where user_id = (select ${authUid}))`,
    }),
    pgPolicy("payloads_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`${table.sourceId} in (select id from sources where user_id = (select ${authUid}))`,
    }),
    pgPolicy("payloads_delete_own", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${table.sourceId} in (select id from sources where user_id = (select ${authUid}))`,
    }),
  ],
).enableRLS();

// Individual normalized item from a payload.
export const sourceItems = pgTable(
  "source_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    payloadId: uuid("payload_id")
      .notNull()
      .references(() => sourcePayloads.id),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    canonicalId: uuid("canonical_id"),
    url: text("url"),
    normalizedData: jsonb("normalized_data").notNull(),
    sourceType: text("source_type").notNull(), // rss_entry | bookmark | api_item | scraped_item
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.canonicalId],
      foreignColumns: [table.id],
      name: "source_items_canonical_id_source_items_id_fk",
    }),
    pgPolicy("items_select_own", {
      for: "select",
      to: authenticatedRole,
      using: sql`${table.sourceId} in (select id from sources where user_id = (select ${authUid}))`,
    }),
    pgPolicy("items_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${table.sourceId} in (select id from sources where user_id = (select ${authUid}))`,
    }),
    pgPolicy("items_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`${table.sourceId} in (select id from sources where user_id = (select ${authUid}))`,
    }),
    pgPolicy("items_delete_own", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${table.sourceId} in (select id from sources where user_id = (select ${authUid}))`,
    }),
  ],
).enableRLS();

// Audit log per source execution.
export const sourceRuns = pgTable(
  "source_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    status: text("status").notNull().default("running"), // running | completed | failed | partial
    pagesFetched: integer("pages_fetched").default(0),
    itemsCreated: integer("items_created").default(0),
    error: text("error"),
    stateBefore: jsonb("state_before"),
    stateAfter: jsonb("state_after"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    pgPolicy("runs_select_own", {
      for: "select",
      to: authenticatedRole,
      using: sql`${table.sourceId} in (select id from sources where user_id = (select ${authUid}))`,
    }),
    pgPolicy("runs_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${table.sourceId} in (select id from sources where user_id = (select ${authUid}))`,
    }),
    pgPolicy("runs_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`${table.sourceId} in (select id from sources where user_id = (select ${authUid}))`,
    }),
    pgPolicy("runs_delete_own", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${table.sourceId} in (select id from sources where user_id = (select ${authUid}))`,
    }),
  ],
).enableRLS();

// Maps secret names to Supabase Vault secret IDs.
export const sourceSecrets = pgTable(
  "source_secrets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    secretName: text("secret_name").notNull(),
    vaultSecretId: uuid("vault_secret_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    pgPolicy("secrets_select_own", {
      for: "select",
      to: authenticatedRole,
      using: sql`${table.sourceId} in (select id from sources where user_id = (select ${authUid}))`,
    }),
    pgPolicy("secrets_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${table.sourceId} in (select id from sources where user_id = (select ${authUid}))`,
    }),
    pgPolicy("secrets_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`${table.sourceId} in (select id from sources where user_id = (select ${authUid}))`,
    }),
    pgPolicy("secrets_delete_own", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${table.sourceId} in (select id from sources where user_id = (select ${authUid}))`,
    }),
  ],
).enableRLS();
