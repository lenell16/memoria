import { db } from "@/db/drizzle";
import { feedItems, feeds } from "@/db/schema/feeds";
import { sourceItems } from "@/db/schema/sources";
import { and, desc, eq, sql } from "drizzle-orm";

type FeedInsert = typeof feeds.$inferInsert;
type FeedSelect = typeof feeds.$inferSelect;
type FeedItemInsert = typeof feedItems.$inferInsert;
type FeedItemSelect = typeof feedItems.$inferSelect;
type SourceItemSelect = typeof sourceItems.$inferSelect;

// -- Feeds --

export async function listFeedsByUser(userId: FeedSelect["userId"]) {
  return db.select().from(feeds).where(eq(feeds.userId, userId)).orderBy(desc(feeds.updatedAt));
}

export async function getFeedById(id: FeedSelect["id"]) {
  const rows = await db.select().from(feeds).where(eq(feeds.id, id));
  return rows[0] ?? null;
}

export type CreateFeedInput = Pick<FeedInsert, "userId" | "name" | "description" | "config" | "filter">;

export async function createFeed(data: CreateFeedInput) {
  const rows = await db.insert(feeds).values(data).returning();
  return rows[0]!;
}

export type UpdateFeedInput = Partial<Pick<FeedInsert, "name" | "description" | "config" | "filter">>;

export async function updateFeed(id: FeedSelect["id"], data: UpdateFeedInput) {
  const rows = await db
    .update(feeds)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(feeds.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteFeed(id: FeedSelect["id"]) {
  return db.delete(feeds).where(eq(feeds.id, id)).returning();
}

export async function deleteFeedCascade(id: FeedSelect["id"]) {
  await db.delete(feedItems).where(eq(feedItems.feedId, id));
  return db.delete(feeds).where(eq(feeds.id, id)).returning();
}

// -- Feed Items --

export type FeedItemStatus = NonNullable<FeedItemSelect["status"]>;
export type CreateFeedItemInput = Pick<FeedItemInsert, "feedId" | "sourceItemId" | "status" | "userData">;
export type ListFeedItemsOptions = {
  limit?: number;
  offset?: number;
  status?: FeedItemStatus;
};
export type FeedItemWithSourceItem = {
  feedItem: FeedItemSelect;
  sourceItem: SourceItemSelect;
};

export async function createFeedItems(items: CreateFeedItemInput[]) {
  if (items.length === 0) return [];
  return db.insert(feedItems).values(items).returning();
}

export async function listFeedItems(
  feedId: FeedItemSelect["feedId"],
  options?: ListFeedItemsOptions,
): Promise<FeedItemWithSourceItem[]> {
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

export async function updateFeedItemStatus(id: FeedItemSelect["id"], status: FeedItemStatus) {
  const rows = await db
    .update(feedItems)
    .set({ status, updatedAt: new Date() })
    .where(eq(feedItems.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function updateFeedItemUserData(id: FeedItemSelect["id"], userData: FeedItemInsert["userData"]) {
  const rows = await db
    .update(feedItems)
    .set({ userData, updatedAt: new Date() })
    .where(eq(feedItems.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function countFeedItems(feedId: FeedItemSelect["feedId"], status?: FeedItemStatus) {
  const conditions = [eq(feedItems.feedId, feedId)];
  if (status) conditions.push(eq(feedItems.status, status));

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(feedItems)
    .where(and(...conditions));
  return Number(result[0]?.count ?? 0);
}
