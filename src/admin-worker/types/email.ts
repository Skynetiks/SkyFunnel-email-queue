import { z } from "zod";

const AttachmentSchema = z.object({
  filename: z.string(),
  content: z.string(),
});

export const AdminWorkerEmailSchema = z.object({
  to: z.string().email(),
  subject: z.string(),
  body: z.string(),
  attachments: z.array(AttachmentSchema),
});

export type AdminWorkerEmail = z.infer<typeof AdminWorkerEmailSchema>;

export const AdminWorkerEmailArraySchema = z.array(AdminWorkerEmailSchema);
