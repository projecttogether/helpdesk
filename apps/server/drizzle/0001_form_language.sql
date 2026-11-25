ALTER TABLE "users" DROP COLUMN "locale";
--> statement-breakpoint
-- Versions saved before forms had a language start in English; admins can switch a form to German.
UPDATE "form_versions" SET "definition" = jsonb_set("definition", '{language}', '"en"') WHERE NOT ("definition" ? 'language');
