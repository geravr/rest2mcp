CREATE TABLE "mcp_server_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"revision_number" integer NOT NULL,
	"source_draft_revision" integer NOT NULL,
	"candidate_fingerprint" text NOT NULL,
	"contract_fingerprint" text NOT NULL,
	"schema_version" integer NOT NULL,
	"compiler_version" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_url" text NOT NULL,
	"allowed_hosts" jsonb NOT NULL,
	"common_entries" jsonb,
	"auth_configuration" jsonb,
	"diff_summary" jsonb,
	"publish_request_id" text NOT NULL,
	"actor_source" text NOT NULL,
	"actor_user_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_server_revision_number_unique" UNIQUE("server_id","revision_number"),
	CONSTRAINT "mcp_server_revision_request_unique" UNIQUE("server_id","publish_request_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_server_revision_config" (
	"id" text PRIMARY KEY NOT NULL,
	"revision_id" text NOT NULL,
	"server_id" text NOT NULL,
	"source_value_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"owner" text,
	"description" text,
	"is_secret" boolean NOT NULL,
	"value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_server_revision_config_source_unique" UNIQUE("revision_id","source_value_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_server_revision_tool" (
	"id" text PRIMARY KEY NOT NULL,
	"revision_id" text NOT NULL,
	"server_id" text NOT NULL,
	"source_tool_id" text NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"description" text,
	"method" text NOT NULL,
	"path_template" text NOT NULL,
	"request_definition" jsonb,
	"compiled_plan" jsonb,
	"compile_status" text,
	"compile_issues" jsonb,
	"annotations" jsonb,
	"allow_mutation" boolean NOT NULL,
	"enabled" boolean NOT NULL,
	"source" text NOT NULL,
	"contract_fingerprint" text,
	"definition_hash" text,
	"tool_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_server_revision_tool_source_unique" UNIQUE("revision_id","source_tool_id"),
	CONSTRAINT "mcp_server_revision_tool_name_unique" UNIQUE("revision_id","name")
);
--> statement-breakpoint
ALTER TABLE "mcp_call_log" DROP CONSTRAINT "mcp_call_log_tool_id_mcp_tool_id_fk";
--> statement-breakpoint
ALTER TABLE "mcp_server" ADD COLUMN "draft_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_server" ADD COLUMN "published_revision_id" text;--> statement-breakpoint
ALTER TABLE "mcp_call_log" ADD COLUMN "published_revision_id" text;--> statement-breakpoint
ALTER TABLE "mcp_call_log" ADD COLUMN "revision_number" integer;--> statement-breakpoint
ALTER TABLE "mcp_call_log" ADD COLUMN "aggregate_fingerprint" text;--> statement-breakpoint
ALTER TABLE "mcp_call_log" ADD COLUMN "tool_fingerprint" text;--> statement-breakpoint
ALTER TABLE "mcp_call_log" ADD COLUMN "revision_mode" text;--> statement-breakpoint
ALTER TABLE "mcp_call_log" ADD COLUMN "draft_revision" integer;--> statement-breakpoint
ALTER TABLE "mcp_server_revision" ADD CONSTRAINT "mcp_server_revision_server_id_mcp_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_revision_config" ADD CONSTRAINT "mcp_server_revision_config_revision_id_mcp_server_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."mcp_server_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_revision_config" ADD CONSTRAINT "mcp_server_revision_config_server_id_mcp_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_revision_tool" ADD CONSTRAINT "mcp_server_revision_tool_revision_id_mcp_server_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."mcp_server_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_revision_tool" ADD CONSTRAINT "mcp_server_revision_tool_server_id_mcp_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_server_revision_server_number_idx" ON "mcp_server_revision" USING btree ("server_id","revision_number");--> statement-breakpoint
CREATE INDEX "mcp_server_revision_server_created_idx" ON "mcp_server_revision" USING btree ("server_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_server_revision_server_fingerprint_idx" ON "mcp_server_revision" USING btree ("server_id","candidate_fingerprint");--> statement-breakpoint
CREATE INDEX "mcp_server_revision_config_revision_idx" ON "mcp_server_revision_config" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "mcp_server_revision_config_server_idx" ON "mcp_server_revision_config" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "mcp_server_revision_tool_revision_idx" ON "mcp_server_revision_tool" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "mcp_server_revision_tool_server_name_idx" ON "mcp_server_revision_tool" USING btree ("server_id","name");--> statement-breakpoint
CREATE INDEX "mcp_server_published_revision_idx" ON "mcp_server" USING btree ("published_revision_id");--> statement-breakpoint
CREATE INDEX "mcp_call_log_revision_idx" ON "mcp_call_log" USING btree ("server_id","revision_number");--> statement-breakpoint
CREATE INDEX "mcp_call_log_published_revision_idx" ON "mcp_call_log" USING btree ("published_revision_id");