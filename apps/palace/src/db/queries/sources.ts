import { db } from "@/db/drizzle";
import { feedItems } from "@/db/schema/feeds";
import { sourceItems, sourcePayloads, sourceRuns, sourceSecrets, sources } from "@/db/schema/sources";
import { desc, eq, sql } from "drizzle-orm";

type SourceInsert = typeof sources.$inferInsert;
type SourceSelect = typeof sources.$inferSelect;
type SourcePayloadInsert = typeof sourcePayloads.$inferInsert;
type SourcePayloadSelect = typeof sourcePayloads.$inferSelect;
type SourceItemInsert = typeof sourceItems.$inferInsert;
type SourceItemSelect = typeof sourceItems.$inferSelect;
type SourceRunInsert = typeof sourceRuns.$inferInsert;
type SourceRunSelect = typeof sourceRuns.$inferSelect;

// -- Sources --

export async function listSourcesByUser(userId: SourceSelect["userId"]) {
  return db.select().from(sources).where(eq(sources.userId, userId)).orderBy(desc(sources.updatedAt));
}

export async function getSourceById(id: SourceSelect["id"]) {
  const rows = await db.select().from(sources).where(eq(sources.id, id));
  return rows[0] ?? null;
}

export type CreateSourceInput = Pick<
  SourceInsert,
  "userId" | "name" | "type" | "config" | "pipeline" | "schedule"
>;

export async function createSource(data: CreateSourceInput) {
  const rows = await db.insert(sources).values(data).returning();
  return rows[0]!;
}

export type UpdateSourceInput = Partial<
  Pick<SourceInsert, "name" | "type" | "config" | "pipeline" | "schedule" | "isActive" | "runState" | "lastFetchedAt">
>;

export async function updateSource(id: SourceSelect["id"], data: UpdateSourceInput) {
  const rows = await db
    .update(sources)
    .set({ ...data, updatedAt: sql`now()` })
    .where(eq(sources.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteSource(id: SourceSelect["id"]) {
  return db.delete(sources).where(eq(sources.id, id)).returning();
}

export async function deleteSourceCascade(id: SourceSelect["id"]) {
  return db.transaction(async (tx) => {
    // Order matters: children before parents.
    await tx
      .delete(feedItems)
      .where(sql`${feedItems.sourceItemId} in (select id from source_items where source_id = ${id})`);
    await tx.delete(sourceItems).where(eq(sourceItems.sourceId, id));
    await tx.delete(sourcePayloads).where(eq(sourcePayloads.sourceId, id));
    await tx.delete(sourceRuns).where(eq(sourceRuns.sourceId, id));
    await tx.delete(sourceSecrets).where(eq(sourceSecrets.sourceId, id));
    return tx.delete(sources).where(eq(sources.id, id)).returning();
  });
}

// -- Source Payloads --

export type CreatePayloadInput = Pick<
  SourcePayloadInsert,
  "sourceId" | "data" | "storageKey" | "storageBackend" | "format" | "mimeType" | "sizeBytes"
>;

export async function createSourcePayload(data: CreatePayloadInput) {
  const rows = await db.insert(sourcePayloads).values(data).returning();
  return rows[0]!;
}

export async function listPayloadsBySource(sourceId: SourcePayloadSelect["sourceId"]) {
  return db
    .select()
    .from(sourcePayloads)
    .where(eq(sourcePayloads.sourceId, sourceId))
    .orderBy(desc(sourcePayloads.ingestedAt));
}

export async function getPayloadById(id: SourcePayloadSelect["id"]) {
  const rows = await db.select().from(sourcePayloads).where(eq(sourcePayloads.id, id));
  return rows[0] ?? null;
}

// -- Source Items --

export type CreateSourceItemInput = Pick<
  SourceItemInsert,
  "payloadId" | "sourceId" | "url" | "normalizedData" | "sourceType"
>;
export type ListSourceItemsOptions = {
  limit?: number;
  offset?: number;
};

export async function createSourceItems(items: CreateSourceItemInput[]) {
  if (items.length === 0) return [];
  return db.insert(sourceItems).values(items).returning();
}

export async function listSourceItemsBySource(
  sourceId: SourceItemSelect["sourceId"],
  options?: ListSourceItemsOptions,
) {
  const query = db
    .select()
    .from(sourceItems)
    .where(eq(sourceItems.sourceId, sourceId))
    .orderBy(desc(sourceItems.createdAt));
  if (options?.limit !== undefined) query.limit(options.limit);
  if (options?.offset !== undefined) query.offset(options.offset);
  return query;
}

export async function listSourceItemsByPayload(payloadId: SourceItemSelect["payloadId"]) {
  return db
    .select()
    .from(sourceItems)
    .where(eq(sourceItems.payloadId, payloadId))
    .orderBy(desc(sourceItems.createdAt));
}

export async function getSourceItemById(id: SourceItemSelect["id"]) {
  const rows = await db.select().from(sourceItems).where(eq(sourceItems.id, id));
  return rows[0] ?? null;
}

export async function countSourceItemsBySource(sourceId: SourceItemSelect["sourceId"]) {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(sourceItems)
    .where(eq(sourceItems.sourceId, sourceId));
  return Number(result[0]?.count ?? 0);
}

// -- Source Runs (used heavily in phase 4) --

export type CreateRunInput = Pick<SourceRunInsert, "sourceId" | "stateBefore">;
export type FinalizeSourceRunInput = {
  status: NonNullable<SourceRunInsert["status"]>;
} & Partial<Pick<SourceRunInsert, "pagesFetched" | "itemsCreated" | "error" | "stateAfter">>;

export async function createSourceRun(data: CreateRunInput) {
  const rows = await db
    .insert(sourceRuns)
    .values({ ...data, status: "running" })
    .returning();
  return rows[0]!;
}

export async function finalizeSourceRun(
  id: SourceRunSelect["id"],
  data: FinalizeSourceRunInput,
) {
  const rows = await db
    .update(sourceRuns)
    .set({ ...data, finishedAt: sql`now()` })
    .where(eq(sourceRuns.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function listRunsBySource(sourceId: SourceRunSelect["sourceId"], options?: { limit?: number }) {
  const query = db
    .select()
    .from(sourceRuns)
    .where(eq(sourceRuns.sourceId, sourceId))
    .orderBy(desc(sourceRuns.startedAt));
  if (options?.limit !== undefined) query.limit(options.limit);
  return query;
}
