import * as embeddings from "@/db/schema/embeddings";
import * as profiles from "@/db/schema/profiles";
import { env } from "@/lib/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const connection = postgres(env.DATABASE_URL);

export const db = drizzle(connection, { schema: { ...profiles, ...embeddings } });
