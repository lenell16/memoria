import { db } from "@/db/drizzle";
import {
  countSourceItemsBySource,
  createSource,
  createSourceItems,
  createSourcePayload,
  createSourceRun,
  deleteSourceCascade,
  getSourceById,
  listPayloadsBySource,
  listRunsBySource,
  listSourceItemsBySource,
  listSourcesByUser,
  updateSource,
} from "@/db/queries/sources";
import { createFeed, createFeedItems, deleteFeedCascade, listFeedItems } from "@/db/queries/feeds";
import { profiles } from "@/db/schema/profiles";
import { sourceSecrets } from "@/db/schema/sources";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

async function ensureProfile(id: string, displayName: string) {
  await db
    .insert(profiles)
    .values({ id, displayName, avatarUrl: null })
    .onConflictDoNothing({ target: profiles.id });
}

describe("db/queries/sources", () => {
  it("createSource returns defaults", async () => {
    const userId = randomUUID();
    await ensureProfile(userId, "Sources Defaults");

    const source = await createSource({
      userId,
      name: "My RSS Source",
      type: "rss",
    });

    expect(source.id).toBeTruthy();
    expect(source.userId).toBe(userId);
    expect(source.name).toBe("My RSS Source");
    expect(source.type).toBe("rss");
    expect(source.isActive).toBe(true);
    expect(source.config).toEqual({});
    expect(source.runState).toEqual({});
    expect(source.createdAt).toBeInstanceOf(Date);
    expect(source.updatedAt).toBeInstanceOf(Date);

    await deleteSourceCascade(source.id);
  });

  it("listSourcesByUser filters by user", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await ensureProfile(userA, "Sources Filter A");
    await ensureProfile(userB, "Sources Filter B");

    const sourceA = await createSource({
      userId: userA,
      name: "User A Source",
      type: "api",
    });
    const sourceB = await createSource({
      userId: userB,
      name: "User B Source",
      type: "api",
    });

    const listed = await listSourcesByUser(userA);
    const listedIds = listed.map((row) => row.id);

    expect(listedIds).toContain(sourceA.id);
    expect(listedIds).not.toContain(sourceB.id);

    await deleteSourceCascade(sourceA.id);
    await deleteSourceCascade(sourceB.id);
  });

  it("getSourceById returns null for missing source", async () => {
    const missing = await getSourceById(randomUUID());
    expect(missing).toBeNull();
  });

  it("updateSource updates fields and bumps updatedAt", async () => {
    const userId = randomUUID();
    await ensureProfile(userId, "Sources Update");

    const created = await createSource({
      userId,
      name: "Before Update",
      type: "manual",
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    const updated = await updateSource(created.id, {
      name: "After Update",
      isActive: false,
      pipeline: "item",
    });

    expect(updated).not.toBeNull();
    expect(updated?.name).toBe("After Update");
    expect(updated?.isActive).toBe(false);
    expect(updated?.pipeline).toBe("item");
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());

    await deleteSourceCascade(created.id);
  });

  it("deleteSourceCascade removes full child tree", async () => {
    const userId = randomUUID();
    await ensureProfile(userId, "Sources Cascade");

    const source = await createSource({
      userId,
      name: "Cascade Source",
      type: "upload",
    });
    const payload = await createSourcePayload({
      sourceId: source.id,
      format: "json",
      data: { raw: true },
    });
    const [item] = await createSourceItems([
      {
        payloadId: payload.id,
        sourceId: source.id,
        sourceType: "upload",
        normalizedData: { title: "Item 1" },
      },
    ]);
    await createSourceRun({
      sourceId: source.id,
      stateBefore: { cursor: null },
    });
    await db.insert(sourceSecrets).values({
      sourceId: source.id,
      secretName: "api_key",
      vaultSecretId: randomUUID(),
    });

    const feed = await createFeed({
      userId,
      name: "Cascade Feed",
    });
    await createFeedItems([{ feedId: feed.id, sourceItemId: item!.id, status: "unseen" }]);

    const deleted = await deleteSourceCascade(source.id);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.id).toBe(source.id);

    expect(await getSourceById(source.id)).toBeNull();
    expect(await listPayloadsBySource(source.id)).toHaveLength(0);
    expect(await listSourceItemsBySource(source.id)).toHaveLength(0);
    expect(await listRunsBySource(source.id)).toHaveLength(0);
    const secretRows = await db.select().from(sourceSecrets).where(eq(sourceSecrets.sourceId, source.id));
    expect(secretRows).toHaveLength(0);
    expect(await listFeedItems(feed.id)).toHaveLength(0);

    await deleteFeedCascade(feed.id);
  });

  it("createSourceItems batch insert works", async () => {
    const userId = randomUUID();
    await ensureProfile(userId, "Sources Batch");

    const source = await createSource({
      userId,
      name: "Batch Source",
      type: "bookmark_import",
    });
    const payload = await createSourcePayload({
      sourceId: source.id,
      format: "json",
    });

    const items = await createSourceItems([
      {
        payloadId: payload.id,
        sourceId: source.id,
        sourceType: "bookmark",
        normalizedData: { title: "First" },
        url: "https://example.com/first",
      },
      {
        payloadId: payload.id,
        sourceId: source.id,
        sourceType: "bookmark",
        normalizedData: { title: "Second" },
        url: "https://example.com/second",
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items.every((row) => row.sourceId === source.id)).toBe(true);

    await deleteSourceCascade(source.id);
  });

  it("listSourceItemsBySource respects limit and offset", async () => {
    const userId = randomUUID();
    await ensureProfile(userId, "Sources Pagination");

    const source = await createSource({
      userId,
      name: "Pagination Source",
      type: "rss",
    });
    const payload = await createSourcePayload({
      sourceId: source.id,
      format: "json",
    });

    await createSourceItems(
      Array.from({ length: 5 }, (_, i) => ({
        payloadId: payload.id,
        sourceId: source.id,
        sourceType: "rss_entry",
        normalizedData: { index: i },
        url: `https://example.com/${i}`,
      })),
    );

    const paged = await listSourceItemsBySource(source.id, { limit: 2, offset: 1 });
    const total = await countSourceItemsBySource(source.id);

    expect(paged).toHaveLength(2);
    expect(total).toBe(5);
    expect(paged.every((row) => row.sourceId === source.id)).toBe(true);

    await deleteSourceCascade(source.id);
  });
});
