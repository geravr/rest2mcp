ALTER TABLE "mcp_agent_token" ADD COLUMN "scopes" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_server_variable" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "mcp_server_variable" ADD COLUMN "owner" text;--> statement-breakpoint
ALTER TABLE "mcp_server_variable" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "mcp_tool" ADD COLUMN "request_definition" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_tool" ADD COLUMN "compiled_plan" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_tool" ADD COLUMN "compile_status" text;--> statement-breakpoint
ALTER TABLE "mcp_tool" ADD COLUMN "compile_issues" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_tool" ADD COLUMN "annotations" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_server" ADD COLUMN "common_entries" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_server" ADD COLUMN "auth_configuration" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_call_log" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "mcp_call_log" ADD COLUMN "phase" text;--> statement-breakpoint
ALTER TABLE "mcp_call_log" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "mcp_call_log" ADD CONSTRAINT "mcp_call_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_tool_compile_status_idx" ON "mcp_tool" USING btree ("compile_status");--> statement-breakpoint
CREATE INDEX "mcp_call_log_user_id_idx" ON "mcp_call_log" USING btree ("user_id");