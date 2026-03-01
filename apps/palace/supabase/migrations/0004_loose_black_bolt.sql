CREATE TABLE "feed_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"status" text DEFAULT 'unseen' NOT NULL,
	"user_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feed_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"filter" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feeds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payload_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"canonical_id" uuid,
	"url" text,
	"normalized_data" jsonb NOT NULL,
	"source_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_payloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"data" jsonb,
	"storage_key" text,
	"storage_backend" text DEFAULT 'inline' NOT NULL,
	"format" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_payloads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"pages_fetched" integer DEFAULT 0,
	"items_created" integer DEFAULT 0,
	"error" text,
	"state_before" jsonb,
	"state_after" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "source_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"secret_name" text NOT NULL,
	"vault_secret_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_secrets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pipeline" text,
	"schedule" jsonb,
	"run_state" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feed_items" ADD CONSTRAINT "feed_items_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_items" ADD CONSTRAINT "feed_items_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feeds" ADD CONSTRAINT "feeds_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_payload_id_source_payloads_id_fk" FOREIGN KEY ("payload_id") REFERENCES "public"."source_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_canonical_id_source_items_id_fk" FOREIGN KEY ("canonical_id") REFERENCES "public"."source_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_payloads" ADD CONSTRAINT "source_payloads_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_runs" ADD CONSTRAINT "source_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_secrets" ADD CONSTRAINT "source_secrets_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "feed_items_select_own" ON "feed_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("feed_items"."feed_id" in (select id from feeds where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "feed_items_insert_own" ON "feed_items" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("feed_items"."feed_id" in (select id from feeds where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "feed_items_update_own" ON "feed_items" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("feed_items"."feed_id" in (select id from feeds where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "feed_items_delete_own" ON "feed_items" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("feed_items"."feed_id" in (select id from feeds where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "feeds_select_own" ON "feeds" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select (select auth.uid())) = "feeds"."user_id");--> statement-breakpoint
CREATE POLICY "feeds_insert_own" ON "feeds" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select (select auth.uid())) = "feeds"."user_id");--> statement-breakpoint
CREATE POLICY "feeds_update_own" ON "feeds" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select (select auth.uid())) = "feeds"."user_id");--> statement-breakpoint
CREATE POLICY "feeds_delete_own" ON "feeds" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select (select auth.uid())) = "feeds"."user_id");--> statement-breakpoint
CREATE POLICY "items_select_own" ON "source_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("source_items"."source_id" in (select id from sources where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "items_insert_own" ON "source_items" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("source_items"."source_id" in (select id from sources where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "items_update_own" ON "source_items" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("source_items"."source_id" in (select id from sources where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "items_delete_own" ON "source_items" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("source_items"."source_id" in (select id from sources where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "payloads_select_own" ON "source_payloads" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("source_payloads"."source_id" in (select id from sources where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "payloads_insert_own" ON "source_payloads" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("source_payloads"."source_id" in (select id from sources where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "payloads_update_own" ON "source_payloads" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("source_payloads"."source_id" in (select id from sources where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "payloads_delete_own" ON "source_payloads" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("source_payloads"."source_id" in (select id from sources where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "runs_select_own" ON "source_runs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("source_runs"."source_id" in (select id from sources where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "runs_insert_own" ON "source_runs" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("source_runs"."source_id" in (select id from sources where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "runs_update_own" ON "source_runs" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("source_runs"."source_id" in (select id from sources where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "runs_delete_own" ON "source_runs" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("source_runs"."source_id" in (select id from sources where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "secrets_select_own" ON "source_secrets" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("source_secrets"."source_id" in (select id from sources where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "secrets_insert_own" ON "source_secrets" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("source_secrets"."source_id" in (select id from sources where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "secrets_update_own" ON "source_secrets" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("source_secrets"."source_id" in (select id from sources where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "secrets_delete_own" ON "source_secrets" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("source_secrets"."source_id" in (select id from sources where user_id = (select (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "sources_select_own" ON "sources" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select (select auth.uid())) = "sources"."user_id");--> statement-breakpoint
CREATE POLICY "sources_insert_own" ON "sources" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select (select auth.uid())) = "sources"."user_id");--> statement-breakpoint
CREATE POLICY "sources_update_own" ON "sources" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select (select auth.uid())) = "sources"."user_id");--> statement-breakpoint
CREATE POLICY "sources_delete_own" ON "sources" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select (select auth.uid())) = "sources"."user_id");