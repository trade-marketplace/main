import { z } from "zod";

// C02–C05: use the field's existing mockup wording as its validation prompt. No wizard UI in #116.
export const DRAFT_STORAGE_KEY = "trade.job-draft.v1";
export const POST_KEY_SCHEMA = z.uuid().transform((value) => value.toLowerCase());
const text = (message: string, max = 200) => z.string({ error: message }).trim().min(1, message).max(max, message);
const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const timeWindow = z.object({
  date: z.iso.date({ error: "When do you need it?" }),
  timeOfDay: z.enum(["MORNING", "AFTERNOON", "EVENING"], { error: "When do you need it?" }),
});

const fields = {
  postKey: POST_KEY_SCHEMA.optional(),
  description: text("Describe the job", 1000).min(10, "Describe the job"),
  category: z.enum(["ELECTRICAL", "PLUMBING", "GAS", "CONSTRUCTION", "OTHER"], { error: "Type of job" }),
  photoPaths: z.array(z.string().max(250)).max(6, "Add some photos"),
  addressLine1: text("Address"),
  addressLine2: z.string().trim().max(200, "Address").optional(),
  suburb: text("Address", 100),
  city: text("Address", 100),
  postcode: z.string().trim().regex(/^\d{4}$/, "Address").optional(),
  locationSource: z.enum(["SEARCH", "PIN", "TYPED"], { error: "Address" }),
  point: point.optional(),
  accessNotes: z.string().trim().max(1000, "Anything else? (optional)").optional(),
  asap: z.boolean(),
  anyTime: z.boolean(),
  timeWindows: z.array(timeWindow).max(21, "When do you need it?"),
};

// A save is a complete snapshot of fields entered so far: absent later steps are valid.
export const jobDraftSchema = z.object(fields).partial().strict();
export type JobDraft = z.infer<typeof jobDraftSchema>;
export const postJobSchema = z.object({ ...fields, asap: fields.asap.default(false), anyTime: fields.anyTime.default(false), timeWindows: fields.timeWindows.default([]) }).strict().superRefine((data, ctx) => {
  if (data.locationSource !== "TYPED" && !data.point) {
    ctx.addIssue({ code: "custom", path: ["point"], message: "Address" });
  }
  if (!data.anyTime && !data.timeWindows.length) {
    ctx.addIssue({ code: "custom", path: ["timeWindows"], message: "When do you need it?" });
  }
  if (new Set(data.photoPaths).size !== data.photoPaths.length) {
    ctx.addIssue({ code: "custom", path: ["photoPaths"], message: "Add some photos" });
  }
  if (new Set(data.timeWindows.map((w) => `${w.date}:${w.timeOfDay}`)).size !== data.timeWindows.length) {
    ctx.addIssue({ code: "custom", path: ["timeWindows"], message: "When do you need it?" });
  }
});
export type PostJobInput = z.infer<typeof postJobSchema>;
export type DraftFieldErrors = Record<string, string>;
const FIELD_PROMPTS: Record<string, string> = {
  description: "Describe the job", category: "Type of job", photoPaths: "Add some photos",
  addressLine1: "Address", addressLine2: "Address", suburb: "Address", city: "Address", postcode: "Address", point: "Address", locationSource: "Address",
  timeWindows: "When do you need it?", asap: "As soon as possible", anyTime: "Any time",
  accessNotes: "Anything else? (optional)", postKey: "Post it", draft: "Post it",
};
export function draftFieldErrors(error: z.ZodError): DraftFieldErrors {
  return Object.fromEntries(error.issues.map((issue) => {
    const field = String(issue.path[0] ?? "draft");
    return [field, FIELD_PROMPTS[field] ?? FIELD_PROMPTS.draft];
  }));
}
