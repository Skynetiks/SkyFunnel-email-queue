import z from "zod";

const EmailSchema = z.object({
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

export const AddBulkRouteParamsSchema = z.object({
  emails: z.array(EmailSchema),
  campaignOrg: z.object({
    id: z.string(),
    name: z.string(),
  }),
  interval: z.number(),
  priority: z.string().optional(),
});

export const AddEmailRouteParamsSchema = z.object({
  email: EmailSchema,
  campaignOrg: z.object({
    id: z.string(),
    name: z.string(),
  }),
  priority: z.string().optional(),
});

export type Email = z.infer<typeof EmailSchema>;
export type AddBulkRouteParamsType = z.infer<typeof AddBulkRouteParamsSchema>;
export type AddEmailRouteParamsType = z.infer<typeof AddEmailRouteParamsSchema>;
