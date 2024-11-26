import { AdminWorkerEmail } from "../admin-worker/types/email";
import { ADMIN_DEFAULT_JOB_OPTIONS } from "../config";
import { getAdminEmailQueue } from "./admin-queue";

export async function addAdminEmailsToQueue(emails: AdminWorkerEmail[]) {
  const EmailQueue = await getAdminEmailQueue();
  console.log("Adding emails to queue");

  const payload = emails.map((email, i) => ({
    name: `send-email-${i}`,
    data: email,
    opts: ADMIN_DEFAULT_JOB_OPTIONS,
  }));

  const res = await EmailQueue.addBulk(payload);

  return res;
}
