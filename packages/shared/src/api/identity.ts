import { z } from "zod";
import { idSchema } from "./common";
import { validDate } from "../form";

/**
 * Identity requests: staff ask IAM for a new person from a ticket.
 * IAM decides; the helpdesk shows what became of the request on the ticket.
 */

/** The fields of a request that a question of the form can fill in. */
export const IAM_FIELDS = [
  "firstName",
  "lastName",
  "personalEmail",
  "jobTitle",
  "personType",
  "team",
  "managerEmail",
  "startDate",
  "endDate",
  "notes",
] as const;
export type IamField = (typeof IAM_FIELDS)[number];

/** Which question of the form fills which field (question IDs). */
export const iamMappingSchema = z.object(
  Object.fromEntries(IAM_FIELDS.map((field) => [field, z.string().max(40).nullable().default(null)])) as {
    [K in IamField]: z.ZodDefault<z.ZodNullable<z.ZodString>>;
  },
);
export type IamMapping = z.infer<typeof iamMappingSchema>;

/** The IAM connection as superadmins see it: the API key only as a hint. */
export const iamSettingsSchema = z.object({
  url: z.string(),
  apiKeyHint: z.string().nullable(),
  mapping: iamMappingSchema,
});
export type IamSettings = z.infer<typeof iamSettingsSchema>;

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => value === "" || (/^https?:\/\//i.test(value) && URL.canParse(value)),
    "Enter the address of IAM, e.g. https://iam.example.org",
  );

/** Saving the IAM connection. An empty key keeps the stored one; null removes it. */
export const iamSettingsInputSchema = z.object({
  url: httpUrl,
  apiKey: z
    .string()
    .trim()
    .max(200)
    .refine((value) => value === "" || value.startsWith("iam_"), "An IAM API key starts with iam_")
    .nullable()
    .default(""),
  mapping: iamMappingSchema,
});
export type IamSettingsInput = z.input<typeof iamSettingsInputSchema>;

/** What the request dialog needs: whether IAM is set up, its choices, and the mapping. */
export const identityOptionsSchema = z.object({
  configured: z.boolean(),
  personTypes: z.array(z.object({ value: z.string(), label: z.string() })),
  teams: z.array(z.object({ id: z.number().int(), name: z.string() })),
  mapping: iamMappingSchema,
});
export type IdentityOptions = z.infer<typeof identityOptionsSchema>;

const emailOrEmpty = z
  .string()
  .trim()
  .max(254)
  .refine((value) => value === "" || z.email().safeParse(value).success, "Enter an email address");
const dateOrNull = z
  .string()
  .refine((value) => validDate(value) && value >= "0001-01-01", "Enter a date")
  .nullable()
  .default(null);

/** Staff send a request to IAM. `submissionKey` makes a repeated send one request. */
export const identityRequestInputSchema = z
  .object({
    firstName: z.string().trim().min(1, "Enter the first name").max(150),
    lastName: z.string().trim().min(1, "Enter the last name").max(150),
    personalEmail: emailOrEmpty.default(""),
    jobTitle: z.string().trim().max(200).default(""),
    personType: z.string().trim().min(1, "Choose the person type").max(20),
    teamId: z.number().int().positive().nullable().default(null),
    managerEmail: emailOrEmpty.default(""),
    startDate: dateOrNull,
    endDate: dateOrNull,
    notes: z.string().trim().max(5000).default(""),
    // Lower case, as PostgreSQL returns a UUID: it is sent to IAM as the reference.
    submissionKey: idSchema.transform((key) => key.toLowerCase()),
  })
  .refine((value) => !value.startDate || !value.endDate || value.endDate >= value.startDate, {
    path: ["endDate"],
    message: "The last day cannot be before the start date",
  });
export type IdentityRequestInput = z.input<typeof identityRequestInputSchema>;

/** `sending`: saved, IAM has not confirmed it yet. `refused`: IAM refused the details. The rest is IAM's status. */
export const IDENTITY_REQUEST_STATUSES = [
  "sending",
  "refused",
  "open",
  "approved",
  "rejected",
  "cancelled",
] as const;

/** A request as a ticket shows it, with what IAM last said. */
export const identityRequestSchema = z.object({
  id: idSchema,
  name: z.string(),
  personType: z.string(),
  status: z.enum(IDENTITY_REQUEST_STATUSES),
  /** Rejected or refused: why. */
  reason: z.string(),
  /** Sending: why IAM has not confirmed it yet. */
  lastError: z.string().nullable(),
  /** Approved: the person's status in IAM (planned, onboarding, active, …). */
  personStatus: z.string().nullable(),
  workEmail: z.string().nullable(),
  /** The request's page in IAM. */
  url: z.string(),
  sentBy: z.string().nullable(),
  createdAt: z.string(),
  checkedAt: z.string().nullable(),
});
export type IdentityRequest = z.infer<typeof identityRequestSchema>;
