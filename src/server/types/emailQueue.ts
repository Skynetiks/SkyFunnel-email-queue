import { BulkJobOptions } from "bullmq";
import z from "zod";

export const EmailSchema = z.object({
  id: z.string(),
  leadId: z.string(),
  emailCampaignId: z.string(),
  leadFirstName: z.string().optional().nullable(),
  leadLastName: z.string().optional().nullable(),
  leadEmail: z.string(),
  senderId: z.string(),

  isSentMessage: z.boolean(),
  isRead: z.boolean(),
  status: z.string(),
  timeStamp: z.string().datetime().optional(),
  leadCompanyName: z.string().nullable(),
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
