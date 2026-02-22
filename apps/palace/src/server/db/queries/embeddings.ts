import { eq } from "drizzle-orm";
import { db } from "../client";
import { embeddings } from "../schema/embeddings";

export async function listEmbeddingsByOwner(ownerId: string) {
  return db.select().from(embeddings).where(eq(embeddings.ownerId, ownerId));
}

export async function createEmbedding(data: typeof embeddings.$inferInsert) {
  return db.insert(embeddings).values(data).returning();
}
