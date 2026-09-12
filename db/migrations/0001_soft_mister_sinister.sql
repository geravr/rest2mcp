CREATE TABLE "mcp_agent_token" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"server_id" text,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tool" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"method" text NOT NULL,
	"path_template" text NOT NULL,
	"param_map" jsonb NOT NULL,
	"allow_mutation" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_tool_server_name_unique" UNIQUE("server_id","name")
);
--> statement-breakpoint
CREATE TABLE "mcp_server" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"base_url" text NOT NULL,
	"allowed_hosts" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_server_user_slug_unique" UNIQUE("user_id","slug")
);
--> statement-breakpoint
CREATE TABLE "mcp_call_log" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text,
	"tool_id" text,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"http_status" integer,
	"duration_ms" integer,
	"app_code" text,
	"request_summary" text,
	"response_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"scheme" text NOT NULL,
	"header_name" text,
	"value_location" text NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_credential_serverId_unique" UNIQUE("server_id")
);
--> statement-breakpoint
ALTER TABLE "mcp_agent_token" ADD CONSTRAINT "mcp_agent_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_agent_token" ADD CONSTRAINT "mcp_agent_token_server_id_mcp_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool" ADD CONSTRAINT "mcp_tool_server_id_mcp_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server" ADD CONSTRAINT "mcp_server_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_call_log" ADD CONSTRAINT "mcp_call_log_server_id_mcp_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_server"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_call_log" ADD CONSTRAINT "mcp_call_log_tool_id_mcp_tool_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."mcp_tool"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_credential" ADD CONSTRAINT "mcp_credential_server_id_mcp_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_agent_token_user_id_idx" ON "mcp_agent_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_agent_token_server_id_idx" ON "mcp_agent_token" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "mcp_agent_token_token_hash_idx" ON "mcp_agent_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "mcp_tool_server_id_idx" ON "mcp_tool" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "mcp_server_user_id_idx" ON "mcp_server" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_server_status_idx" ON "mcp_server" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mcp_call_log_server_id_idx" ON "mcp_call_log" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "mcp_call_log_tool_id_idx" ON "mcp_call_log" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "mcp_call_log_created_at_idx" ON "mcp_call_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mcp_credential_server_id_idx" ON "mcp_credential" USING btree ("server_id");