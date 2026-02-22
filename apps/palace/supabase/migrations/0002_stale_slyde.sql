CREATE TABLE "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "embeddings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "profiles_select_own" ON "profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select (select auth.uid())) = "profiles"."id");--> statement-breakpoint
CREATE POLICY "profiles_update_own" ON "profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select (select auth.uid())) = "profiles"."id");--> statement-breakpoint
CREATE POLICY "embeddings_select_own" ON "embeddings" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select (select auth.uid())) = "embeddings"."owner_id");--> statement-breakpoint
CREATE POLICY "embeddings_insert_own" ON "embeddings" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select (select auth.uid())) = "embeddings"."owner_id");--> statement-breakpoint
CREATE POLICY "embeddings_update_own" ON "embeddings" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select (select auth.uid())) = "embeddings"."owner_id");--> statement-breakpoint
CREATE POLICY "embeddings_delete_own" ON "embeddings" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select (select auth.uid())) = "embeddings"."owner_id");