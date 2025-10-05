import compression from "compression";
import dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import morgan from "morgan";
import { z } from "zod";
import { AdminWorkerEmailSchema } from "../admin-worker/types/email.js";
import { DefaultPrioritySlug } from "../config.js";
import { query } from "../lib/db";
import { AppError, expressErrorHandler } from "../lib/errorHandler.js";
import { getRedisConnection } from "../lib/redis";
import { sendSMTPEmail } from "../lib/smtp";
import { addAdminEmailsToQueue } from "./admin-email.js";
import { skyfunnelSesQueue, smtpQueue } from "./emails";
import authMiddleware from "./middlewares/auth.js";
import { clearCacheOrganizationSchema, smtpInputSchema } from "./types/email";
import { AddBulkSkyfunnelSesRouteParamsSchema, AddSESEmailRouteParamsSchema } from "./types/emailQueue.js";
import { AddBulkSMTPRouteParamsSchema, AddSMTPRouteParamsSchema } from "./types/smtpQueue.js";
import { clearCache } from "../db/emailQueries.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.urlencoded({ extended: true, limit: "200mb" }));
app.use(express.json({ limit: "200mb" }));
app.use(morgan("tiny"));
app.use(compression());
app.use(helmet());

app.use(authMiddleware); // Authenticate the header with the token. skips in development

app.get("/", async (_, res) => {
  const redis = await getRedisConnection();
  const isRedisConnected = redis?.status === "ready";

  let isDbConnected = false;
  try {
    // Replace with your actual DB connection and query logic
    await query("SELECT 1", []); // A simple query to check if DB is up
    isDbConnected = true;
  } catch (error) {
    console.error("Database connection check failed:", error);
  }

  res.send({
    status: isRedisConnected && isDbConnected ? "ok" : "not-ok",
    message: "Server is running",
    uptime: process.uptime(),
    isRedisConnected,
    isDbConnected,
  });
});

app.get("/health", async (_, res) => {
  res.send({
    status: "ok",
    message: "Server is running",
  });
});

app.get("/bullmq-stats", async (_, res) => {
  const smtpCounts = await smtpQueue.getBullMqStats();
  const skyfunnelSesCounts = await skyfunnelSesQueue.getBullMqStats();

  res.send({
    smtpCounts,
    skyfunnelSesCounts,
  });
});

// ******************************************************************************************************************************************
// ***************************************************** SMTP  ROUTE ************************************************************************
// ******************************************************************************************************************************************

app.post("/smtp/add-emails", async (req, res, next) => {
  try {
    const { success, data: bulkEmailData, error: ZodError } = AddBulkSMTPRouteParamsSchema.safeParse(req.body);

    if (!success) {
      throw new AppError("BAD_REQUEST", ZodError.errors[0].path[0] + ": " + ZodError.errors[0].message);
    }

    await smtpQueue.addBulkEmailsToQueue(bulkEmailData, bulkEmailData.priority || DefaultPrioritySlug);
    res.status(200).json({
      success: true,
      message: "Emails added to queue",
    });
  } catch (error) {
    next(error);
  }
});

app.post("/smtp/add-email", async (req, res, next) => {
  try {
    const { success, data: emailData, error: ZodError } = AddSMTPRouteParamsSchema.safeParse(req.body);

    if (!success) {
      throw new AppError("BAD_REQUEST", ZodError.errors[0].path[0] + ": " + ZodError.errors[0].message);
    }

    await smtpQueue.addEmailToQueue(
      { campaignOrg: emailData.campaignOrg, email: emailData.email, smtpCredentials: emailData.smtpCredentials },
      emailData.priority || DefaultPrioritySlug,
    );

    res.status(200).json({
      success: true,
      message: "Email added to queue",
    });
  } catch (error) {
    next(error);
  }
});

app.post("/smtp/send-email", async (req, res, next) => {
  try {
    const { success, data, error: ZodError } = smtpInputSchema.safeParse(req.body);

    if (!success) {
      throw new AppError("BAD_REQUEST", ZodError.errors[0].path[0] + ": " + ZodError.errors[0].message);
    }

    const { smtpCredentials } = data;
    const { emailBody, receiverEmail, subject, senderEmail, replyToEmail, senderName } = data.emailDetails;

    await sendSMTPEmail(
      { body: emailBody, recipient: receiverEmail, senderEmail, replyToEmail, subject, senderName },
      smtpCredentials,
    );

    res.status(200).json({
      success: true,
      message: "Email sent",
      sent: true,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/smtp/cancel-campaign", async (req, res, next) => {
  try {
    if (!req.body.campaignId) {
      throw new AppError("BAD_REQUEST", "campaignId is required");
    }

    const { campaignId } = req.body;

    const cancelledEmailsLength = await smtpQueue.cancelEmails(campaignId);
    if (!cancelledEmailsLength) {
      throw new AppError("NOT_FOUND", "No emails found or campaign is already successful/failed");
    }

    res.status(200).json({
      success: true,
      message: "Emails cancelled",
      cancelledEmailsLength,
    });
  } catch (error) {
    next(error);
  }
});

// app.post("/smtp/pause-campaign", async (req, res, next) => {
//   try {
//     if (!req.body.campaignId) {
//       throw new AppError("BAD_REQUEST", "campaignId is required");
//     }

//     const { campaignId } = req.body;

//     const isSuccess = await smtpQueue.pauseCampaign(campaignId);
//     if (!isSuccess) {
//       throw new AppError("NOT_FOUND", "Campaign is not paused");
//     }

//     res.status(200).json({
//       success: true,
//       message: "Campaign is paused",
//     });
//   } catch (error) {
//     next(error);
//   }
// });

// app.post("/smtp/resume-campaign", async (req, res, next) => {
//   try {
//     if (!req.body.campaignId) {
//       throw new AppError("BAD_REQUEST", "campaignId is required");
//     }

//     const { campaignId } = req.body;

//     const isSuccess = await smtpQueue.resumeCampaign(campaignId);
//     if (!isSuccess) {
//       throw new AppError("NOT_FOUND", "Campaign is not resumed");
//     }

//     res.status(200).json({
//       success: true,
//       message: "Campaign is resumed",
//     });
//   } catch (error) {
//     next(error);
//   }
// });

// ******************************************************************************************************************************************
// ***************************************************** Skyfunnel Ses ROUTE ****************************************************************
// ******************************************************************************************************************************************

app.post("/ses/add-emails", async (req, res, next) => {
  try {
    const { success, data: bulkEmailData, error: ZodError } = AddBulkSkyfunnelSesRouteParamsSchema.safeParse(req.body);

    if (!success) {
      throw new AppError("BAD_REQUEST", ZodError.errors[0].path[0] + ": " + ZodError.errors[0].message);
    }

    console.log("[GOT_BULK_EMAILS]", bulkEmailData.emails.length);

    await skyfunnelSesQueue.addBulkEmailsToQueue(bulkEmailData, bulkEmailData.priority || DefaultPrioritySlug);
    res.status(200).json({
      success: true,
      message: `${bulkEmailData.emails.length} emails added to queue`,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/ses/add-email", async (req, res, next) => {
  try {
    const { success, data: emailData, error: ZodError } = AddSESEmailRouteParamsSchema.safeParse(req.body);

    if (!success) {
      throw new AppError("BAD_REQUEST", ZodError.errors[0].path[0] + ": " + ZodError.errors[0].message);
    }

    await skyfunnelSesQueue.addEmailToQueue(
      { campaignOrg: emailData.campaignOrg, email: emailData.email },
      emailData.priority || DefaultPrioritySlug,
    );

    res.status(200).json({
      success: true,
      message: "Email added to queue",
    });
  } catch (error) {
    next(error);
  }
});

// app.post("/ses/send-email", async (req, res, next) => {
//   try {
//     const { success, data, error: ZodError } = sesInputSchema.safeParse(req.body);

//     if (!success) {
//       throw new AppError("BAD_REQUEST", ZodError.errors[0].path[0] + ": " + ZodError.errors[0].message);
//     }

//     const { emailBody, receiverEmail, senderEmail, subject, replyToEmail, senderName } = data.emailDetails;
//     await sendEmailSES({ body: emailBody, recipient: receiverEmail, senderEmail, senderName, subject, replyToEmail });

//     res.status(200).json({
//       success: true,
//       message: "Email sent",
//       sent: true,
//     });
//   } catch (error) {
//     next(error);
//   }
// });

app.post("/organization/clear-cache", async (req, res, next) => {
  try {
    const { success, data, error: ZodError } = clearCacheOrganizationSchema.safeParse(req.body);

    if (!success) {
      throw new AppError("BAD_REQUEST", ZodError.errors[0].path[0] + ": " + ZodError.errors[0].message);
    }

    await clearCache(data.type, { campaignId: data.campaignId, organizationId: data.organizationId });

    res.status(200).json({
      success: true,
      message: "Cache cleared",
    });
  } catch (error) {
    next(error);
  }
});

app.post("/ses/cancel-campaign", async (req, res, next) => {
  try {
    if (!req.body.campaignId) {
      throw new AppError("BAD_REQUEST", "campaignId is required");
    }

    const { campaignId } = req.body;

    const cancelledEmailsLength = await skyfunnelSesQueue.cancelEmails(campaignId);
    if (!cancelledEmailsLength) {
      throw new AppError("NOT_FOUND", "No emails found or campaign is already successful/failed");
    }

    res.status(200).json({
      success: true,
      message: "Emails cancelled",
      cancelledEmailsLength,
    });
  } catch (error) {
    next(error);
  }
});

// app.post("/ses/pause-campaign", async (req, res, next) => {
//   try {
//     if (!req.body.campaignId) {
//       throw new AppError("BAD_REQUEST", "campaignId is required");
//     }

//     const { campaignId } = req.body;

//     const isSuccess = await skyfunnelSesQueue.pauseCampaign(campaignId);
//     if (!isSuccess) {
//       throw new AppError("NOT_FOUND", "Campaign is not paused");
//     }

//     res.status(200).json({
//       success: true,
//       message: "Campaign is paused",
//     });
//   } catch (error) {
//     next(error);
//   }
// });

// app.post("/ses/resume-campaign", async (req, res, next) => {
//   try {
//     if (!req.body.campaignId) {
//       throw new AppError("BAD_REQUEST", "campaignId is required");
//     }

//     const { campaignId } = req.body;

//     const isSuccess = await skyfunnelSesQueue.resumeCampaign(campaignId);
//     if (!isSuccess) {
//       throw new AppError("NOT_FOUND", "Campaign is not resumed");
//     }

//     res.status(200).json({
//       success: true,
//       message: "Campaign is resumed",
//     });
//   } catch (error) {
//     next(error);
//   }
// });

// ******************************************************************************************************************************************
// ***************************************************** ADMIN ROUTE ************************************************************************
// ******************************************************************************************************************************************

app.post("/add-admin-emails", async (req, res, next) => {
  const { emails } = req.body;
  const { success } = z.array(AdminWorkerEmailSchema).safeParse(emails);
  if (!success) {
    res.status(400).json({
      success: false,
      message: "Invalid email list",
    });
    return;
  }

  try {
    await addAdminEmailsToQueue(emails);

    res.status(200).json({
      success: true,
      message: "Emails added to queue",
    });
  } catch (error: unknown) {
    next(error);
  }
});

// ******************************************************************************************************************************************
// ***************************************************** Other ROUTES ****************************************************************
// ******************************************************************************************************************************************

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  expressErrorHandler(err, req, res, next);
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT} in ${process.env.NODE_ENV} mode`);
});
