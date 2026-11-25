ALTER TABLE "identity_requests" ALTER COLUMN "iam_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_requests" ALTER COLUMN "url" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "identity_requests" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "identity_requests" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "identity_requests" ADD COLUMN "alerted_at" timestamp with time zone;