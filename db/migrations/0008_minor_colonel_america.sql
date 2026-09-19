ALTER TABLE "mcp_server_variable" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_server_variable" ALTER COLUMN "owner" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_server_variable" DROP COLUMN "is_secret";--> statement-breakpoint
ALTER TABLE "mcp_tool" DROP COLUMN "path_template";--> statement-breakpoint
ALTER TABLE "mcp_tool" DROP COLUMN "request_template";--> statement-breakpoint
ALTER TABLE "mcp_tool" DROP COLUMN "params";--> statement-breakpoint
ALTER TABLE "mcp_server_revision_config" DROP COLUMN "is_secret";--> statement-breakpoint
ALTER TABLE "mcp_server_revision_tool" DROP COLUMN "path_template";--> statement-breakpoint
ALTER TABLE "mcp_server" DROP COLUMN "default_headers";--> statement-breakpoint
ALTER TABLE "mcp_server" DROP COLUMN "default_query";