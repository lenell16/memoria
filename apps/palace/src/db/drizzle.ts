import * as embeddings from "@/db/schema/embeddings";
import * as feeds from "@/db/schema/feeds";
import * as profiles from "@/db/schema/profiles";
import * as sources from "@/db/schema/sources";
import { env } from "@/lib/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const connection = postgres(env.DATABASE_URL);

export const db = drizzle(connection, {
  schema: { ...profiles, ...embeddings, ...sources, ...feeds },
});
