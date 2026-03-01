import { db } from "@/db/drizzle";
import {
  createFeed,
  createFeedItems,
  deleteFeedCascade,
  listFeedItems,
  updateFeedItemStatus,
} from "@/db/queries/feeds";
import {
  createSource,
  createSourceItems,
  createSourcePayload,
  deleteSourceCascade,
} from "@/db/queries/sources";
import { profiles } from "@/db/schema/profiles";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

async function ensureProfile(id: string, displayName: string) {
  await db
    .insert(profiles)
    .values({ id, displayName, avatarUrl: null })
    .onConflictDoNothing({ target: profiles.id });
}

async function createSourceItemsFixture(userId: string, count = 1) {
  const source = await createSource({
    userId,
    name: `Feed Source ${randomUUID().slice(0, 8)}`,
    type: "rss",
  });
  const payload = await createSourcePayload({
    sourceId: source.id,
    format: "json",
  });
  const items = await createSourceItems(
    Array.from({ length: count }, (_, i) => ({
      payloadId: payload.id,
      sourceId: source.id,
      sourceType: "rss_entry",
      normalizedData: { title: `Item ${i}` },
      url: `https://example.com/feed-${i}`,
    })),
  );

  return { source, items };
}

describe("db/queries/feeds", () => {
  it("createFeed returns row", async () => {
    const userId = randomUUID();
    await ensureProfile(userId, "Feeds Create");

    const feed = await createFeed({
      userId,
      name: "My Feed",
      description: "A feed for testing",
      filter: "item.status == 'new'",
    });

    expect(feed.id).toBeTruthy();
    expect(feed.userId).toBe(userId);
    expect(feed.name).toBe("My Feed");
    expect(feed.description).toBe("A feed for testing");
    expect(feed.config).toEqual({});
    expect(feed.createdAt).toBeInstanceOf(Date);
    expect(feed.updatedAt).toBeInstanceOf(Date);

    await deleteFeedCascade(feed.id);
  });

  it("createFeedItems links feed to source items", async () => {
    const userId = randomUUID();
    await ensureProfile(userId, "Feeds Link");

    const { source, items } = await createSourceItemsFixture(userId, 2);
    const feed = await createFeed({
      userId,
      name: "Link Feed",
    });

    const created = await createFeedItems([
      { feedId: feed.id, sourceItemId: items[0]!.id },
      { feedId: feed.id, sourceItemId: items[1]!.id, status: "seen" },
    ]);

    expect(created).toHaveLength(2);
    expect(created.every((row) => row.feedId === feed.id)).toBe(true);
    expect(created.map((row) => row.sourceItemId).sort()).toEqual(
      [items[0]!.id, items[1]!.id].sort(),
    );

    await deleteSourceCascade(source.id);
    await deleteFeedCascade(feed.id);
  });

  it("listFeedItems joins source items and filters by status", async () => {
    const userId = randomUUID();
    await ensureProfile(userId, "Feeds List");

    const { source, items } = await createSourceItemsFixture(userId, 2);
    const feed = await createFeed({
      userId,
      name: "Filter Feed",
    });

    await createFeedItems([
      { feedId: feed.id, sourceItemId: items[0]!.id, status: "unseen" },
      { feedId: feed.id, sourceItemId: items[1]!.id, status: "done" },
    ]);

    const doneItems = await listFeedItems(feed.id, { status: "done" });
    const allItems = await listFeedItems(feed.id);

    expect(allItems).toHaveLength(2);
    expect(doneItems).toHaveLength(1);
    expect(doneItems[0]?.feedItem.status).toBe("done");
    expect(doneItems[0]?.sourceItem.id).toBe(items[1]!.id);

    await deleteSourceCascade(source.id);
    await deleteFeedCascade(feed.id);
  });

  it("updateFeedItemStatus changes status and bumps updatedAt", async () => {
    const userId = randomUUID();
    await ensureProfile(userId, "Feeds Status");

    const { source, items } = await createSourceItemsFixture(userId, 1);
    const feed = await createFeed({
      userId,
      name: "Status Feed",
    });
    const [created] = await createFeedItems([{ feedId: feed.id, sourceItemId: items[0]!.id }]);

    await new Promise((resolve) => setTimeout(resolve, 10));
    const updated = await updateFeedItemStatus(created!.id, "done");

    expect(updated).not.toBeNull();
    expect(updated?.status).toBe("done");
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(created!.updatedAt.getTime());

    await deleteSourceCascade(source.id);
    await deleteFeedCascade(feed.id);
  });
});
