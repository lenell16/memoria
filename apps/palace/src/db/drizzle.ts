import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as profiles from "@/db/schema/profiles";
import * as embeddings from "@/db/schema/embeddings";

const connection = postgres(env.DATABASE_URL);

export const db = drizzle(connection, { schema: { ...profiles, ...embeddings } });
