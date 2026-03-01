import { db } from "@/db/drizzle";
import { feedItems } from "@/db/schema/feeds";
import { sourceItems, sourcePayloads, sourceRuns, sourceSecrets, sources } from "@/db/schema/sources";
import { desc, eq, sql } from "drizzle-orm";

// -- Sources --

export async function listSourcesByUser(userId: string) {
  return db.select().from(sources).where(eq(sources.userId, userId)).orderBy(desc(sources.updatedAt));
}

export async function getSourceById(id: string) {
  const rows = await db.select().from(sources).where(eq(sources.id, id));
  return rows[0] ?? null;
}

export type CreateSourceInput = {
  userId: string;
  name: string;
  type: string;
  config?: Record<string, unknown>;
  pipeline?: string;
  schedule?: Record<string, unknown>;
};

export async function createSource(data: CreateSourceInput) {
  const rows = await db.insert(sources).values(data).returning();
  return rows[0]!;
}

export type UpdateSourceInput = Partial<
  Pick<
    typeof sources.$inferInsert,
    "name" | "type" | "config" | "pipeline" | "schedule" | "isActive" | "runState" | "lastFetchedAt"
  >
>;

export async function updateSource(id: string, data: UpdateSourceInput) {
  const rows = await db
    .update(sources)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(sources.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteSource(id: string) {
  return db.delete(sources).where(eq(sources.id, id)).returning();
}

export async function deleteSourceCascade(id: string) {
  // Order matters: children before parents.
  await db
    .delete(feedItems)
    .where(sql`${feedItems.sourceItemId} in (select id from source_items where source_id = ${id})`);
  await db.delete(sourceItems).where(eq(sourceItems.sourceId, id));
  await db.delete(sourcePayloads).where(eq(sourcePayloads.sourceId, id));
  await db.delete(sourceRuns).where(eq(sourceRuns.sourceId, id));
  await db.delete(sourceSecrets).where(eq(sourceSecrets.sourceId, id));
  return db.delete(sources).where(eq(sources.id, id)).returning();
}

// -- Source Payloads --

export type CreatePayloadInput = {
  sourceId: string;
  data?: unknown;
  storageKey?: string;
  storageBackend?: string;
  format: string;
  mimeType?: string;
  sizeBytes?: number;
};

export async function createSourcePayload(data: CreatePayloadInput) {
  const rows = await db.insert(sourcePayloads).values(data).returning();
  return rows[0]!;
}

export async function listPayloadsBySource(sourceId: string) {
  return db
    .select()
    .from(sourcePayloads)
    .where(eq(sourcePayloads.sourceId, sourceId))
    .orderBy(desc(sourcePayloads.ingestedAt));
}

export async function getPayloadById(id: string) {
  const rows = await db.select().from(sourcePayloads).where(eq(sourcePayloads.id, id));
  return rows[0] ?? null;
}

// -- Source Items --

export type CreateSourceItemInput = {
  payloadId: string;
  sourceId: string;
  url?: string;
  normalizedData: Record<string, unknown>;
  sourceType: string;
};

export async function createSourceItems(items: CreateSourceItemInput[]) {
  if (items.length === 0) return [];
  return db.insert(sourceItems).values(items).returning();
}

export async function listSourceItemsBySource(
  sourceId: string,
  options?: { limit?: number; offset?: number },
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

export async function listSourceItemsByPayload(payloadId: string) {
  return db
    .select()
    .from(sourceItems)
    .where(eq(sourceItems.payloadId, payloadId))
    .orderBy(desc(sourceItems.createdAt));
}

export async function getSourceItemById(id: string) {
  const rows = await db.select().from(sourceItems).where(eq(sourceItems.id, id));
  return rows[0] ?? null;
}

export async function countSourceItemsBySource(sourceId: string) {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(sourceItems)
    .where(eq(sourceItems.sourceId, sourceId));
  return Number(result[0]?.count ?? 0);
}

// -- Source Runs (used heavily in phase 4) --

export type CreateRunInput = {
  sourceId: string;
  stateBefore?: Record<string, unknown>;
};

export async function createSourceRun(data: CreateRunInput) {
  const rows = await db
    .insert(sourceRuns)
    .values({ ...data, status: "running" })
    .returning();
  return rows[0]!;
}

export async function finalizeSourceRun(
  id: string,
  data: {
    status: string;
    pagesFetched?: number;
    itemsCreated?: number;
    error?: string;
    stateAfter?: Record<string, unknown>;
  },
) {
  const rows = await db
    .update(sourceRuns)
    .set({ ...data, finishedAt: new Date() })
    .where(eq(sourceRuns.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function listRunsBySource(sourceId: string, options?: { limit?: number }) {
  const query = db
    .select()
    .from(sourceRuns)
    .where(eq(sourceRuns.sourceId, sourceId))
    .orderBy(desc(sourceRuns.startedAt));
  if (options?.limit !== undefined) query.limit(options.limit);
  return query;
}
