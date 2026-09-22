CREATE TABLE "ai_tool_optimization_item" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"ref_kind" text NOT NULL,
	"tool_id" text,
	"operation_key" text,
	"name" text NOT NULL,
	"fingerprint" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"failure_code" text,
	"snapshot" jsonb NOT NULL,
	"review" jsonb,
	"ordinal" integer NOT NULL,
	"applied_tool_id" text,
	"applied_tool_name" text,
	"applied_draft_revision" integer,
	"applied_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_tool_optimization_item_ref_kind_check" CHECK ("ai_tool_optimization_item"."ref_kind" in ('draft_tool', 'openapi_candidate')),
	CONSTRAINT "ai_tool_optimization_item_state_check" CHECK ("ai_tool_optimization_item"."state" in ('queued', 'running', 'recommended', 'no_change', 'failed', 'cancelled', 'applied', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "ai_tool_optimization_run" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"server_id" text NOT NULL,
	"source" text NOT NULL,
	"scope_kind" text NOT NULL,
	"scope" jsonb NOT NULL,
	"state" text DEFAULT 'planned' NOT NULL,
	"policy_version" integer NOT NULL,
	"prompt_version" integer NOT NULL,
	"provider_kind" text,
	"model_id" text,
	"readiness_fingerprint" text,
	"server_config_revision" integer NOT NULL,
	"server_draft_revision" integer NOT NULL,
	"document_fingerprint" text,
	"eligible_count" integer DEFAULT 0 NOT NULL,
	"ineligible_count" integer DEFAULT 0 NOT NULL,
	"estimate" jsonb,
	"usage" jsonb,
	"error_code" text,
	"worker_id" text,
	"lease_expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"cancel_requested_at" timestamp with time zone,
	"authorized_at" timestamp with time zone,
	"queued_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"planned_expires_at" timestamp with time zone NOT NULL,
	"retention_expires_at" timestamp with time zone,
	"apply_key" text,
	"apply_result" jsonb,
	"applied_config_revision" integer,
	"applied_draft_revision" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_tool_optimization_run_apply_key_unique" UNIQUE("user_id","apply_key"),
	CONSTRAINT "ai_tool_optimization_run_state_check" CHECK ("ai_tool_optimization_run"."state" in ('planned', 'queued', 'running', 'completed', 'completed_with_errors', 'failed', 'cancel_requested', 'cancelled', 'expired')),
	CONSTRAINT "ai_tool_optimization_run_source_check" CHECK ("ai_tool_optimization_run"."source" in ('draft', 'openapi')),
	CONSTRAINT "ai_tool_optimization_run_scope_check" CHECK ("ai_tool_optimization_run"."scope_kind" in ('single', 'selected', 'all_eligible', 'openapi'))
);
--> statement-breakpoint
ALTER TABLE "ai_tool_optimization_item" ADD CONSTRAINT "ai_tool_optimization_item_run_id_ai_tool_optimization_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_tool_optimization_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_optimization_run" ADD CONSTRAINT "ai_tool_optimization_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_optimization_run" ADD CONSTRAINT "ai_tool_optimization_run_server_id_mcp_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_tool_optimization_item_run_ordinal_idx" ON "ai_tool_optimization_item" USING btree ("run_id","ordinal");--> statement-breakpoint
CREATE INDEX "ai_tool_optimization_item_run_state_idx" ON "ai_tool_optimization_item" USING btree ("run_id","state");--> statement-breakpoint
CREATE INDEX "ai_tool_optimization_item_tool_id_idx" ON "ai_tool_optimization_item" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "ai_tool_optimization_run_user_created_idx" ON "ai_tool_optimization_run" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_tool_optimization_run_server_created_idx" ON "ai_tool_optimization_run" USING btree ("server_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_tool_optimization_run_state_idx" ON "ai_tool_optimization_run" USING btree ("state");--> statement-breakpoint
CREATE INDEX "ai_tool_optimization_run_claim_idx" ON "ai_tool_optimization_run" USING btree ("state","lease_expires_at");--> statement-breakpoint
CREATE INDEX "ai_tool_optimization_run_retention_idx" ON "ai_tool_optimization_run" USING btree ("retention_expires_at");