import { z } from "zod";

const envSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;
export const env = envSchema.parse(process.env);
