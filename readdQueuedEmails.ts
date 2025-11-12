import Redis from "ioredis";
import { Queue } from "bullmq";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const REDIS_URL = process.env.REDIS_URL || "";
const SMTP_EMAIL_QUEUE_KEY = "SMTP_EMAIL_SENDING_QUEUE";
const CAMPAIGN_ID = "cmhsn6l2n0001lkk4vhf79mgw";
const STATUS = "QUEUED";

console.log(`📡 Using Redis URL: ${REDIS_URL.replace(/:[^:@]*@/, ':***@')}`);
console.log(`📦 Queue Name: ${SMTP_EMAIL_QUEUE_KEY}`);
console.log(`🎯 Campaign ID: ${CAMPAIGN_ID}\n`);

const redis = new Redis(REDIS_URL);

// Create BullMQ queue instance (same as the application uses)
const queue = new Queue(SMTP_EMAIL_QUEUE_KEY, {
  connection: {
    url: REDIS_URL,
  },
});

// Create PostgreSQL pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

interface EmailFromDB {
  id: string;
  clientId: string | null;
  leadId: string | null;
  recipientType: "CLIENT" | "LEAD";
  emailCampaignId: string;
  recipientEmail: string;
  senderId: string;
  senderEmail: string | null;
  senderName: string | null;
  status: string;
  timestamp: Date;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  startTimeInUTC: string | null;
  endTimeInUTC: string | null;
  activeDays: string[];
  timezone: string | null;
  leadDoubleOptInToken: string | null;
}

interface CampaignOrg {
  id: string;
  name: string;
}

async function readdQueuedEmails() {
  console.log("🔍 Fetching queued emails from database...\n");

  try {
    // First, get the campaign organization details
    const campaignQuery = `
      SELECT ec.id, ec."organizationId", org.name as "orgName"
      FROM "EmailCampaign" ec
      INNER JOIN "Organization" org ON org.id = ec."organizationId"
      WHERE ec.id = $1
    `;

    const campaignResult = await pool.query(campaignQuery, [CAMPAIGN_ID]);

    if (campaignResult.rows.length === 0) {
      console.error(`❌ Campaign with ID ${CAMPAIGN_ID} not found`);
      await cleanup();
      return;
    }

    const campaignOrg: CampaignOrg = {
      id: campaignResult.rows[0].organizationId,
      name: campaignResult.rows[0].orgName,
    };

    console.log(`✅ Found campaign: ${CAMPAIGN_ID}`);
    console.log(`   Organization: ${campaignOrg.name} (${campaignOrg.id})\n`);

    // Fetch queued emails for this campaign with lead/client and campaign details
    const emailsQuery = `
      SELECT
        e.id,
        e."clientId",
        e."leadId",
        e."recipientType",
        e."emailCampaignId",
        e."senderId",
        e."senderEmail",
        e."senderName",
        e.status,
        e.timestamp,
        COALESCE(l.email, c.email) as "recipientEmail",
        COALESCE(l."firstName", c."firstName") as "firstName",
        COALESCE(l."lastName", c."lastName") as "lastName",
        COALESCE(l."companyName", c."companyName") as "companyName",
        ec."startTimeInUTC",
        ec."endTimeInUTC",
        ec."activeDays",
        ec.timezone,
        ldo.token as "leadDoubleOptInToken"
      FROM "Email" e
      LEFT JOIN "Lead" l ON e."leadId" = l.id
      LEFT JOIN "Client" c ON e."clientId" = c.id
      LEFT JOIN "EmailCampaign" ec ON e."emailCampaignId" = ec.id
      LEFT JOIN "LeadDoubleOptIn" ldo ON l.id = ldo."leadId"
      WHERE e."emailCampaignId" = $1 AND e.status = $2
      ORDER BY e.timestamp ASC
    `;

    const emailsResult = await pool.query(emailsQuery, [CAMPAIGN_ID, STATUS]);

    // Transform the data to ensure arrays are properly formatted
    const emails = emailsResult.rows.map(row => {
      // Handle activeDays - PostgreSQL may return it as a string or array
      let activeDays: string[] = [];
      if (row.activeDays) {
        if (Array.isArray(row.activeDays)) {
          activeDays = row.activeDays;
        } else if (typeof row.activeDays === 'string') {
          // Parse PostgreSQL array format: {MONDAY,TUESDAY} or "MONDAY,TUESDAY"
          const cleaned = row.activeDays.replace(/[{}]/g, '');
          activeDays = cleaned ? cleaned.split(',').map((day: string) => day.trim()) : [];
        }
      }

      return {
        ...row,
        activeDays,
      } as EmailFromDB;
    });

    if (emails.length === 0) {
      console.log(`ℹ️  No queued emails found for campaign ${CAMPAIGN_ID}`);
      await cleanup();
      return;
    }

    console.log(`📧 Found ${emails.length} queued emails\n`);

    // Display summary
    console.log("═══════════════════════════════════════════════════════════");
    console.log("QUEUED EMAILS SUMMARY");
    console.log("═══════════════════════════════════════════════════════════");

    emails.slice(0, 5).forEach((email, index) => {
      console.log(`\n${index + 1}. Email ID: ${email.id}`);
      console.log(`   Recipient: ${email.recipientEmail}`);
      console.log(`   Sender: ${email.senderEmail}`);
      console.log(`   Status: ${email.status}`);
      console.log(`   Recipient Type: ${email.recipientType}`);
    });

    if (emails.length > 5) {
      console.log(`\n... and ${emails.length - 5} more emails`);
    }

    console.log("\n═══════════════════════════════════════════════════════════\n");
    console.log("🔧 Preparing to add all emails to queue...\n");

    // Process emails with 15 second delay between each
    const DELAY_BETWEEN_JOBS_MS = 15000; // 15 seconds

    // Prepare all jobs
    const jobs = emails.map((email, i) => {
      const delayMs = i * DELAY_BETWEEN_JOBS_MS;
      const jobId = `SMTP-${email.emailCampaignId}-${generateRandomId()}-${email.id}`;

      // Ensure activeDays is always an array
      const activeDays = Array.isArray(email.activeDays) ? email.activeDays : [];

      // Ensure timestamp is a proper ISO string
      const timestamp = email.timestamp instanceof Date
        ? email.timestamp.toISOString()
        : new Date(email.timestamp).toISOString();

      const jobData = {
        email: {
          id: email.id,
          clientId: email.clientId,
          leadId: email.leadId,
          recipientType: email.recipientType,
          emailCampaignId: email.emailCampaignId,
          firstName: email.firstName,
          lastName: email.lastName,
          email: email.recipientEmail,
          leadDoubleOptInToken: email.leadDoubleOptInToken,
          senderId: email.senderId,
          senderEmail: email.senderEmail || '',
          senderName: email.senderName,
          companyName: email.companyName,
          status: email.status,
          timestamp,
          startTimeInUTC: email.startTimeInUTC,
          endTimeInUTC: email.endTimeInUTC,
          activeDays,
          timezone: email.timezone,
        },
        campaignOrg,
      };

      // Debug: Log the first email's activeDays to verify it's an array
      if (i === 0) {
        console.log(`   Debug - First email activeDays type: ${typeof activeDays}, isArray: ${Array.isArray(activeDays)}, value:`, activeDays);
      }

      return {
        name: email.id,
        data: jobData,
        opts: {
          jobId,
          priority: 10,
          delay: delayMs,
          removeOnComplete: true,
          removeOnFail: true,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
        },
      };
    });

    console.log(`📦 Prepared ${jobs.length} jobs. Adding to queue in bulk...\n`);

    try {
      await queue.addBulk(jobs);

      console.log("\n═══════════════════════════════════════════════════════════");
      console.log("PROCESS COMPLETE");
      console.log("═══════════════════════════════════════════════════════════");
      console.log(`✅ Successfully added: ${jobs.length} emails to queue`);
      console.log(`📊 Total processed: ${emails.length} emails`);
      console.log(`\n⏱️  Jobs are scheduled with ${DELAY_BETWEEN_JOBS_MS / 1000}-second intervals between each.`);
      console.log(`   First job executes immediately, last job in ~${(emails.length * DELAY_BETWEEN_JOBS_MS / 1000 / 60).toFixed(1)} minutes.`);
      console.log(`   Your worker will process them automatically.\n`);

      // Verify jobs were added by checking Redis
      console.log("🔍 Verifying jobs in Redis...\n");
      const pattern = `bull:${SMTP_EMAIL_QUEUE_KEY}:*${CAMPAIGN_ID}*`;
      const keys = await redis.keys(pattern);
      console.log(`Found ${keys.length} Redis keys matching pattern: ${pattern}`);

      if (keys.length > 0) {
        console.log(`Sample keys (first 3):`);
        keys.slice(0, 3).forEach(key => console.log(`   - ${key}`));
      }

      console.log(`\n💡 To search for these jobs in Redis, use:`);
      console.log(`   KEYS bull:${SMTP_EMAIL_QUEUE_KEY}:*${CAMPAIGN_ID}*`);
      console.log(`   Or: KEYS bull:${SMTP_EMAIL_QUEUE_KEY}:SMTP-${CAMPAIGN_ID}*\n`);

      // Get queue stats
      const queueCounts = await queue.getJobCounts();
      console.log("📊 Queue Statistics:");
      console.log(`   Waiting: ${queueCounts.waiting}`);
      console.log(`   Delayed: ${queueCounts.delayed}`);
      console.log(`   Active: ${queueCounts.active}`);
      console.log(`   Completed: ${queueCounts.completed}`);
      console.log(`   Failed: ${queueCounts.failed}\n`);
    } catch (error) {
      console.error("\n❌ Failed to add jobs to queue:", error);
      throw error;
    }

    await cleanup();
  } catch (error) {
    console.error("❌ Fatal error:", error);
    await cleanup();
    process.exit(1);
  }
}

function generateRandomId(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

async function cleanup() {
  console.log("\n🧹 Cleaning up connections...");
  await queue.close();
  await redis.quit();
  await pool.end();
  console.log("✅ Cleanup complete");
}

// Run the script
readdQueuedEmails().catch((error) => {
  console.error("Fatal error:", error);
  cleanup().then(() => process.exit(1));
});
