import { z } from "zod";
import { EmailSchema } from "./emailQueue";
import { BulkJobOptions } from "bullmq";

export const SMTPCredentialsSchema = z.object({
  host: z.string(),
  port: z.number(),
  user: z.string(),
  encryptedPass: z.string(),
});

export const AddBulkSMTPRouteParamsSchema = z.object({
  emails: z.array(EmailSchema),
  campaignOrg: z.object({
    id: z.string(),
    name: z.string(),
  }),
  interval: z.number(),
  priority: z.string().optional(),
  smtpCredentials: SMTPCredentialsSchema,
});

export const AddSMTPRouteParamsSchema = z.object({
  email: EmailSchema,
  campaignOrg: z.object({
    id: z.string(),
    name: z.string(),
  }),
  priority: z.string().optional(),
  smtpCredentials: SMTPCredentialsSchema,
});

// Types
export type AddBulkSMTPRouteParamType = z.infer<typeof AddBulkSMTPRouteParamsSchema>;
export type AddSMTPRouteParamsType = z.infer<typeof AddSMTPRouteParamsSchema>;
export type SMTPCredentials = z.infer<typeof SMTPCredentialsSchema>;

export type SMTPJobOptions = {
  name: string;
  data: Omit<AddSMTPRouteParamsType, "priority">;
  opts?: BulkJobOptions;
}[];
