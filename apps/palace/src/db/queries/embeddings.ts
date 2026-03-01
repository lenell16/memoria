import { db } from "@/db/drizzle";
import { embeddings } from "@/db/schema/embeddings";
import { eq } from "drizzle-orm";

export async function listEmbeddingsByOwner(ownerId: string) {
  return db.select().from(embeddings).where(eq(embeddings.ownerId, ownerId));
}

export async function createEmbedding(data: typeof embeddings.$inferInsert) {
  return db.insert(embeddings).values(data).returning();
}
