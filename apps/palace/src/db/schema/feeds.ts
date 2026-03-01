import { sql } from "drizzle-orm";
import { jsonb, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase/rls";
import { profiles } from "./profiles";
import { sourceItems } from "./sources";

// User-defined feed: curated view over sources.
export const feeds = pgTable(
  "feeds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    name: text("name").notNull(),
    description: text("description"),
    config: jsonb("config").notNull().default({}), // which sources, filter rules (Elo), display prefs
    filter: text("filter"), // Elo expression (SQL-compilable subset)
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    pgPolicy("feeds_select_own", {
      for: "select",
      to: authenticatedRole,
      using: sql`(select ${authUid}) = ${table.userId}`,
    }),
    pgPolicy("feeds_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select ${authUid}) = ${table.userId}`,
    }),
    pgPolicy("feeds_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`(select ${authUid}) = ${table.userId}`,
    }),
    pgPolicy("feeds_delete_own", {
      for: "delete",
      to: authenticatedRole,
      using: sql`(select ${authUid}) = ${table.userId}`,
    }),
  ],
).enableRLS();

// App-level item in a feed.
export const feedItems = pgTable(
  "feed_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    feedId: uuid("feed_id")
      .notNull()
      .references(() => feeds.id),
    sourceItemId: uuid("source_item_id")
      .notNull()
      .references(() => sourceItems.id),
    status: text("status").notNull().default("unseen"), // unseen | seen | in_progress | done | archived
    userData: jsonb("user_data"), // notes, tags, highlights, etc.
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    pgPolicy("feed_items_select_own", {
      for: "select",
      to: authenticatedRole,
      using: sql`${table.feedId} in (select id from feeds where user_id = (select ${authUid}))`,
    }),
    pgPolicy("feed_items_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${table.feedId} in (select id from feeds where user_id = (select ${authUid}))`,
    }),
    pgPolicy("feed_items_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`${table.feedId} in (select id from feeds where user_id = (select ${authUid}))`,
    }),
    pgPolicy("feed_items_delete_own", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${table.feedId} in (select id from feeds where user_id = (select ${authUid}))`,
    }),
  ],
).enableRLS();
