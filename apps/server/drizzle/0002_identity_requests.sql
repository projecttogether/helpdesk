CREATE TABLE "identity_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"iam_id" integer NOT NULL,
	"name" text NOT NULL,
	"person_type" text NOT NULL,
	"status" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"person_status" text,
	"work_email" text,
	"url" text NOT NULL,
	"sent_by_id" uuid,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity_requests" ADD CONSTRAINT "identity_requests_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_requests" ADD CONSTRAINT "identity_requests_sent_by_id_users_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_identity_requests_ticket" ON "identity_requests" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_identity_requests_status" ON "identity_requests" USING btree ("status");