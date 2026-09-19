CREATE TABLE "mcp_platform_step_up_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_platform_token_server_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"token_id" text NOT NULL,
	"server_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_platform_token_server_grant_token_server_unique" UNIQUE("token_id","server_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_platform_token_scope" (
	"id" text PRIMARY KEY NOT NULL,
	"token_id" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_platform_token_scope_token_scope_unique" UNIQUE("token_id","scope")
);
--> statement-breakpoint
CREATE TABLE "mcp_platform_security_event" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_id" text,
	"token_prefix" text,
	"event_type" text NOT NULL,
	"outcome" text NOT NULL,
	"scopes" jsonb,
	"server_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_platform_security_event_type_check" CHECK ("mcp_platform_security_event"."event_type" in ('token_issued', 'token_rotated', 'token_revoked', 'scope_denied', 'resource_denied', 'step_up_failed', 'destructive_action', 'mutating_invocation')),
	CONSTRAINT "mcp_platform_security_event_outcome_check" CHECK ("mcp_platform_security_event"."outcome" in ('success', 'denied', 'failure'))
);
--> statement-breakpoint
ALTER TABLE "mcp_agent_token" ADD COLUMN "policy_version" integer;--> statement-breakpoint
ALTER TABLE "mcp_agent_token" ADD COLUMN "resource_mode" text;--> statement-breakpoint
ALTER TABLE "mcp_agent_token" ADD COLUMN "replaces_token_id" text;--> statement-breakpoint
ALTER TABLE "mcp_platform_step_up_grant" ADD CONSTRAINT "mcp_platform_step_up_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_platform_token_server_grant" ADD CONSTRAINT "mcp_platform_token_server_grant_token_id_mcp_agent_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."mcp_agent_token"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_platform_token_server_grant" ADD CONSTRAINT "mcp_platform_token_server_grant_server_id_mcp_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_platform_token_scope" ADD CONSTRAINT "mcp_platform_token_scope_token_id_mcp_agent_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."mcp_agent_token"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_platform_security_event" ADD CONSTRAINT "mcp_platform_security_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_platform_security_event" ADD CONSTRAINT "mcp_platform_security_event_token_id_mcp_agent_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."mcp_agent_token"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_platform_security_event" ADD CONSTRAINT "mcp_platform_security_event_server_id_mcp_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_server"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_platform_step_up_grant_user_id_idx" ON "mcp_platform_step_up_grant" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_platform_step_up_grant_session_id_idx" ON "mcp_platform_step_up_grant" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "mcp_platform_step_up_grant_expires_at_idx" ON "mcp_platform_step_up_grant" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "mcp_platform_token_server_grant_token_id_idx" ON "mcp_platform_token_server_grant" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "mcp_platform_token_server_grant_server_id_idx" ON "mcp_platform_token_server_grant" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "mcp_platform_token_scope_token_id_idx" ON "mcp_platform_token_scope" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "mcp_platform_security_event_user_created_idx" ON "mcp_platform_security_event" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_platform_security_event_created_idx" ON "mcp_platform_security_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mcp_platform_security_event_token_id_idx" ON "mcp_platform_security_event" USING btree ("token_id");--> statement-breakpoint
ALTER TABLE "mcp_agent_token" ADD CONSTRAINT "mcp_agent_token_replaces_token_id_mcp_agent_token_id_fk" FOREIGN KEY ("replaces_token_id") REFERENCES "public"."mcp_agent_token"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_agent_token_platform_owner_idx" ON "mcp_agent_token" USING btree ("user_id","kind","revoked_at") WHERE "mcp_agent_token"."kind" = 'platform';--> statement-breakpoint
CREATE INDEX "mcp_agent_token_expires_at_idx" ON "mcp_agent_token" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "mcp_agent_token" DROP COLUMN "scopes";--> statement-breakpoint
-- Intentional pre-production data cutover: Platform PATs cannot be migrated to
-- normalized grants (their legacy JSON scopes are unsafe), so disposable
-- Platform credentials are removed. Server gateway tokens are a distinct
-- audience and are left unchanged.
DELETE FROM "mcp_agent_token" WHERE "kind" = 'platform';