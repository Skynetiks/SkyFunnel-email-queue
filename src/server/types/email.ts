import { z } from "zod";
import { SMTPCredentialsSchema } from "./smtpQueue";
import { CACHE_CLEAR_TYPE } from "../../db/emailQueries";

const identityTypes = ["SMTP", "AWS_SMTP", "SKYFUNNEL"] as const;

const emailDetailsSchema = z.object({
  senderEmail: z
    .string()
    .email({ message: "Provide a valid sender email" })
    .transform((val) => val.toLowerCase()),
  senderName: z.string({ message: "Provide a sender name" }).transform((val) => val.trim()),
  receiverEmail: z.string().email({ message: "Provide a valid receiver email address" }),
  replyToEmail: z
    .string()
    .email({ message: "Reply to email should be a valid email address" })
    .optional()
    .transform((val) => val?.toLowerCase()),
  subject: z.string({ message: "Subject cannot be empty" }).transform((val) => val.trim()),
  emailBody: z.string(),
  inReplyTo: z.string().optional(),
  identityType: z.enum(identityTypes),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        content: z.union([z.string(), z.instanceof(Buffer)]),
        contentType: z.string().optional(),
        encoding: z.string().optional(),
        cid: z.string().optional(),
        path: z.string().optional(),
        href: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
});

export const smtpInputSchema = z.object({
  emailDetails: emailDetailsSchema,
  smtpCredentials: SMTPCredentialsSchema,
});

export const sesInputSchema = z.object({
  emailDetails: emailDetailsSchema,
});

export const clearCacheOrganizationSchema = z
  .object({
    organizationId: z.string().min(3, { message: "Organization Id cannot be empty. Minimum 3 characters required" }),
    type: z.nativeEnum(CACHE_CLEAR_TYPE).default(CACHE_CLEAR_TYPE.ALL),
    campaignId: z.string().min(3, { message: "Minimum 3 characters required" }).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === CACHE_CLEAR_TYPE.CAMPAIGN && !val.campaignId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Campaign id is required when type is CAMPAIGN",
      });
    }

    if (val.organizationId === "*" || val.campaignId === "*") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Organization id and campaign id cannot be *. DON'T ABUSE THIS! ☠️☠️",
      });
    }
  });
