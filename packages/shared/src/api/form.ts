import { z } from "zod";
import { idSchema } from "./common";
import { formDefinitionSchema } from "../form";

export const categorySchema = z.object({
  id: idSchema,
  name: z.string(),
  position: z.number().int(),
  isActive: z.boolean(),
  /** New tickets in this category go to this person. */
  defaultAssigneeId: idSchema.nullable(),
  defaultAssigneeName: z.string().nullable(),
});
export type Category = z.infer<typeof categorySchema>;
export const categoryListSchema = z.object({ items: z.array(categorySchema) });

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(80),
  isActive: z.boolean().default(true),
  defaultAssigneeId: idSchema.nullable().default(null),
});
export type CategoryInput = z.input<typeof categoryInputSchema>;

export const categoryOrderSchema = z.object({ ids: z.array(idSchema).min(1).max(200) });

/** The request form as requesters fill it in. */
export const formSchema = z.object({
  versionId: idSchema,
  version: z.number().int(),
  definition: formDefinitionSchema,
  /** The categories a requester can choose, in order. */
  categories: z.array(z.object({ id: idSchema, name: z.string() })),
  updatedAt: z.string(),
  updatedBy: z.string().nullable(),
});
export type Form = z.infer<typeof formSchema>;

/** Saving publishes a new version; `baseVersion` refuses to overwrite a newer one. */
export const formUpdateSchema = z.object({
  baseVersion: z.number().int().min(1),
  definition: formDefinitionSchema,
});
export type FormUpdate = z.input<typeof formUpdateSchema>;
