import { z } from "zod";

export const createFeedSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  config: z.record(z.string(), z.unknown()).optional().default({}),
  filter: z.string().optional(),
});

export const updateFeedSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  filter: z.string().nullable().optional(),
});

export const feedItemStatusEnum = z.enum(["unseen", "seen", "in_progress", "done", "archived"]);

export type CreateFeedPayload = z.infer<typeof createFeedSchema>;
export type UpdateFeedPayload = z.infer<typeof updateFeedSchema>;
