import { z } from "zod";

export const sourceTypeEnum = z.enum([
  "rss",
  "api",
  "scrape",
  "upload",
  "extension",
  "bookmark_import",
  "manual",
]);

const scheduleSchema = z.object({
  interval_ms: z.number().int().positive().optional(),
  cron: z.string().optional(),
});

export const createSourceSchema = z.object({
  name: z.string().min(1).max(255),
  type: sourceTypeEnum,
  config: z.record(z.string(), z.unknown()).optional().default({}),
  pipeline: z.string().optional(),
  schedule: scheduleSchema.optional(),
});

export const updateSourceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: sourceTypeEnum.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  pipeline: z.string().nullable().optional(),
  schedule: scheduleSchema.nullable().optional(),
  isActive: z.boolean().optional(),
});

export type CreateSourcePayload = z.infer<typeof createSourceSchema>;
export type UpdateSourcePayload = z.infer<typeof updateSourceSchema>;
