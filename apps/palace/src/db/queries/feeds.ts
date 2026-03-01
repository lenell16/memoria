import { db } from "@/db/drizzle";
import { feedItems, feeds } from "@/db/schema/feeds";
import { sourceItems } from "@/db/schema/sources";
import { and, desc, eq, sql } from "drizzle-orm";

// -- Feeds --

export async function listFeedsByUser(userId: string) {
  return db.select().from(feeds).where(eq(feeds.userId, userId)).orderBy(desc(feeds.updatedAt));
}

export async function getFeedById(id: string) {
  const rows = await db.select().from(feeds).where(eq(feeds.id, id));
  return rows[0] ?? null;
}

export type CreateFeedInput = {
  userId: string;
  name: string;
  description?: string;
  config?: Record<string, unknown>;
  filter?: string;
};

export async function createFeed(data: CreateFeedInput) {
  const rows = await db.insert(feeds).values(data).returning();
  return rows[0]!;
}

export type UpdateFeedInput = Partial<
  Pick<typeof feeds.$inferInsert, "name" | "description" | "config" | "filter">
>;

export async function updateFeed(id: string, data: UpdateFeedInput) {
  const rows = await db
    .update(feeds)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(feeds.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteFeed(id: string) {
  return db.delete(feeds).where(eq(feeds.id, id)).returning();
}

export async function deleteFeedCascade(id: string) {
  await db.delete(feedItems).where(eq(feedItems.feedId, id));
  return db.delete(feeds).where(eq(feeds.id, id)).returning();
}

// -- Feed Items --

export type CreateFeedItemInput = {
  feedId: string;
  sourceItemId: string;
  status?: string;
  userData?: Record<string, unknown>;
};

export async function createFeedItems(items: CreateFeedItemInput[]) {
  if (items.length === 0) return [];
  return db.insert(feedItems).values(items).returning();
}

export async function listFeedItems(
  feedId: string,
  options?: { limit?: number; offset?: number; status?: string },
) {
  const conditions = [eq(feedItems.feedId, feedId)];
  if (options?.status) conditions.push(eq(feedItems.status, options.status));

  const query = db
    .select({
      feedItem: feedItems,
      sourceItem: sourceItems,
    })
    .from(feedItems)
    .innerJoin(sourceItems, eq(feedItems.sourceItemId, sourceItems.id))
    .where(and(...conditions))
    .orderBy(desc(feedItems.createdAt));

  if (options?.limit !== undefined) query.limit(options.limit);
  if (options?.offset !== undefined) query.offset(options.offset);
  return query;
}

export async function updateFeedItemStatus(id: string, status: string) {
  const rows = await db
    .update(feedItems)
    .set({ status, updatedAt: new Date() })
    .where(eq(feedItems.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function updateFeedItemUserData(id: string, userData: Record<string, unknown>) {
  const rows = await db
    .update(feedItems)
    .set({ userData, updatedAt: new Date() })
    .where(eq(feedItems.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function countFeedItems(feedId: string, status?: string) {
  const conditions = [eq(feedItems.feedId, feedId)];
  if (status) conditions.push(eq(feedItems.status, status));

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(feedItems)
    .where(and(...conditions));
  return Number(result[0]?.count ?? 0);
}
