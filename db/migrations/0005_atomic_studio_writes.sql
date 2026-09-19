CREATE TABLE "mcp_storage_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"object_key" text NOT NULL,
	"purpose" text DEFAULT 'server_icon' NOT NULL,
	"state" text DEFAULT 'staging' NOT NULL,
	"content_type" text,
	"byte_size" integer,
	"metadata" jsonb,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_storage_asset_state_check" CHECK ("mcp_storage_asset"."state" in ('staging', 'ready', 'attached', 'delete_pending', 'deleted'))
);
--> statement-breakpoint
ALTER TABLE "mcp_agent_token" ADD COLUMN "replaced_by_token_id" text;--> statement-breakpoint
ALTER TABLE "mcp_agent_token" ADD COLUMN "rotation_meta" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_server" ADD COLUMN "icon_asset_id" text;--> statement-breakpoint
ALTER TABLE "mcp_server" ADD COLUMN "config_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_storage_asset" ADD CONSTRAINT "mcp_storage_asset_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_storage_asset_object_key_unique" ON "mcp_storage_asset" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "mcp_storage_asset_user_id_idx" ON "mcp_storage_asset" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_storage_asset_state_idx" ON "mcp_storage_asset" USING btree ("state");--> statement-breakpoint
CREATE INDEX "mcp_storage_asset_expires_at_idx" ON "mcp_storage_asset" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "mcp_agent_token" ADD CONSTRAINT "mcp_agent_token_replaced_by_token_id_mcp_agent_token_id_fk" FOREIGN KEY ("replaced_by_token_id") REFERENCES "public"."mcp_agent_token"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server" ADD CONSTRAINT "mcp_server_icon_asset_id_mcp_storage_asset_id_fk" FOREIGN KEY ("icon_asset_id") REFERENCES "public"."mcp_storage_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_agent_token_active_name_unique" ON "mcp_agent_token" USING btree ("user_id","kind","name") WHERE "mcp_agent_token"."kind" = 'platform' and "mcp_agent_token"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "mcp_server" DROP COLUMN "icon_image";--> statement-breakpoint
ALTER TABLE "mcp_agent_token" ADD CONSTRAINT "mcp_agent_token_hash_unique" UNIQUE("token_hash");