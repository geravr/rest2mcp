CREATE TABLE "mcp_tool_group" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_tool_group_server_normalized_name_unique" UNIQUE("server_id","normalized_name"),
	CONSTRAINT "mcp_tool_group_id_server_unique" UNIQUE("id","server_id")
);
--> statement-breakpoint
ALTER TABLE "mcp_tool" ADD COLUMN "source_provenance" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_tool" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "mcp_server_revision_tool" ADD COLUMN "source_provenance" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_tool_group" ADD CONSTRAINT "mcp_tool_group_server_id_mcp_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_tool_group_server_id_idx" ON "mcp_tool_group" USING btree ("server_id");--> statement-breakpoint
ALTER TABLE "mcp_tool" ADD CONSTRAINT "mcp_tool_group_id_mcp_tool_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."mcp_tool_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool" ADD CONSTRAINT "mcp_tool_group_same_server_fk" FOREIGN KEY ("server_id","group_id") REFERENCES "public"."mcp_tool_group"("server_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_tool_group_id_idx" ON "mcp_tool" USING btree ("group_id");