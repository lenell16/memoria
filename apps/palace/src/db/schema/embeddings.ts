import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, jsonb, vector, pgPolicy } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase/rls";

export const embeddings = pgTable(
  "embeddings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    pgPolicy("embeddings_select_own", {
      for: "select",
      to: authenticatedRole,
      using: sql`(select ${authUid}) = ${table.ownerId}`,
    }),
    pgPolicy("embeddings_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select ${authUid}) = ${table.ownerId}`,
    }),
    pgPolicy("embeddings_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`(select ${authUid}) = ${table.ownerId}`,
    }),
    pgPolicy("embeddings_delete_own", {
      for: "delete",
      to: authenticatedRole,
      using: sql`(select ${authUid}) = ${table.ownerId}`,
    }),
  ],
).enableRLS();
