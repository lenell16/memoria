import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as profiles from "./schema/profiles";

const connection = postgres(env.DATABASE_URL);

export const db = drizzle(connection, { schema: { ...profiles } });
