import { BulkJobOptions } from "bullmq";
import z from "zod";

const isValidTimeFormatRefine = (
  val: string | null,
  ctx: z.RefinementCtx,
  config: { path: string[]; message: string },
) => {
  if (!val) return true;
  if (val.split(":").length !== 2) {
    return ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: config.message,
      path: config.path,
    });
  }
};

export const EmailSchema = z.object({
  id: z.string(),
  leadId: z.string(),
  emailCampaignId: z.string(),
  leadFirstName: z.string().optional().nullable(),
  leadLastName: z.string().optional().nullable(),
  leadEmail: z.string(),
  senderId: z.string(),
  leadCompanyName: z.string().nullable(),
  status: z.string(),
  timestamp: z.string().datetime().optional(),
  startTimeInUTC: z
    .string()
    .nullable()
    .superRefine((val, ctx) =>
      isValidTimeFormatRefine(val, ctx, {
        path: ["startTimeInUTC"],
        message: "Invalid start time format must be like HH:mm",
      }),
    ),

  endTimeInUTC: z
    .string()
    .nullable()
    .superRefine((val, ctx) =>
      isValidTimeFormatRefine(val, ctx, {
        path: ["endTimeInUTC"],
        message: "Invalid end time format must be like HH:mm",
      }),
    ),

  activeDays: z.array(z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"])),
  timezone: z.string().nullable(),
});

export const AddBulkSkyfunnelSesRouteParamsSchema = z.object({
  emails: z.array(EmailSchema),
  campaignOrg: z.object({
    id: z.string(),
    name: z.string(),
  }),
  batchDelay: z.number(),
  interval: z.number(),
  priority: z.string().optional(),
  includeDelay: z.boolean(),
});

export const AddSESEmailRouteParamsSchema = z.object({
  email: EmailSchema,
  campaignOrg: z.object({
    id: z.string(),
    name: z.string(),
  }),
  priority: z.string().optional(),
});

export type Email = z.infer<typeof EmailSchema>;
export type AddBulkSkyfunnelSesRouteParamType = z.infer<typeof AddBulkSkyfunnelSesRouteParamsSchema>;
export type AddSESEmailRouteParamsType = z.infer<typeof AddSESEmailRouteParamsSchema>;

export type SESJobOptions = {
  name: string;
  data: Omit<AddSESEmailRouteParamsType, "priority">;
  opts?: BulkJobOptions;
}[];
