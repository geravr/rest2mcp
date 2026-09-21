CREATE TABLE "ai_provider_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider_kind" text NOT NULL,
	"ciphertext" text NOT NULL,
	"credential_revision" integer DEFAULT 1 NOT NULL,
	"config_revision" integer DEFAULT 1 NOT NULL,
	"verified_at" timestamp with time zone,
	"last_error_code" text,
	"last_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_connection_user_provider_unique" UNIQUE("user_id","provider_kind")
);
--> statement-breakpoint
CREATE TABLE "ai_model_selection" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"capability_profile" text NOT NULL,
	"model_id" text NOT NULL,
	"protocol" text NOT NULL,
	"route_origin" text NOT NULL,
	"capability_snapshot" jsonb NOT NULL,
	"verification_fingerprint" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_model_selection_user_profile_unique" UNIQUE("user_id","capability_profile")
);
--> statement-breakpoint
ALTER TABLE "ai_provider_connection" ADD CONSTRAINT "ai_provider_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_selection" ADD CONSTRAINT "ai_model_selection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_selection" ADD CONSTRAINT "ai_model_selection_connection_id_ai_provider_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ai_provider_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_provider_connection_user_id_idx" ON "ai_provider_connection" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_model_selection_connection_id_idx" ON "ai_model_selection" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "ai_model_selection_user_id_idx" ON "ai_model_selection" USING btree ("user_id");