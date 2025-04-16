import { z } from "zod";
import { SMTPCredentialsSchema } from "./smtpQueue";

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
  identityType: z.enum(identityTypes),
});

export const smtpInputSchema = z.object({
  emailDetails: emailDetailsSchema,
  smtpCredentials: SMTPCredentialsSchema,
});

export const sesInputSchema = z.object({
  emailDetails: emailDetailsSchema,
});

export const clearCacheOrganizationSchema = z.object({
  organizationId: z.string(),
});
