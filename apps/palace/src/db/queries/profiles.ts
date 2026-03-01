import { db } from "@/db/drizzle";
import { profiles } from "@/db/schema/profiles";
import { eq } from "drizzle-orm";

export async function listProfiles() {
  return db.select().from(profiles);
}

export async function getProfileById(id: string) {
  return db.select().from(profiles).where(eq(profiles.id, id));
}

export async function createProfile(data: { displayName: string; avatarUrl?: string }) {
  return db.insert(profiles).values(data).returning();
}
