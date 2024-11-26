import express, { NextFunction, Request, Response } from "express";
import dotenv from "dotenv";
import morgan from "morgan";
import compression from "compression";
import authMiddleware from "./middlewares/auth.js";
import helmet from "helmet";
import { AddEmailRouteParamsSchema, AddBulkRouteParamsSchema } from "./types/emailQueue.js";
import { addBulkEmailsToQueue, addEmailToQueue, cancelEmails, pauseCampaign, resumeCampaign } from "./emails.js";
import { AppError, expressErrorHandler } from "../lib/errorHandler.js";
import { DefaultPrioritySlug } from "../config.js";
import { AdminWorkerEmailSchema } from "../admin-worker/types/email.js";
import { z } from "zod";
import { addAdminEmailsToQueue } from "./admin-email.js";

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

app.get("/", (_, res) => {
  res.send({
    status: "ok",
    message: "Server is running",
    uptime: process.uptime(),
  });
});

app.post("/add-emails", async (req, res, next) => {
  try {
    console.log(req.body);
    const { success, data: bulkEmailData, error: ZodError } = AddBulkRouteParamsSchema.safeParse(req.body);

    if (!success) {
      throw new AppError("BAD_REQUEST", ZodError.errors[0].path[0] + ": " + ZodError.errors[0].message);
    }

    await addBulkEmailsToQueue(bulkEmailData, bulkEmailData.priority || DefaultPrioritySlug);
    res.status(200).json({
      success: true,
      message: "Emails added to queue",
    });
  } catch (error) {
    next(error);
  }
});

app.post("/add-email", async (req, res, next) => {
  try {
    const { success, data: emailData, error: ZodError } = AddEmailRouteParamsSchema.safeParse(req.body);

    if (!success) {
      throw new AppError("BAD_REQUEST", ZodError.errors[0].path[0] + ": " + ZodError.errors[0].message);
    }

    await addEmailToQueue(
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

app.post("/cancel-campaign", async (req, res, next) => {
  try {
    if (!req.body.campaignId) {
      throw new AppError("BAD_REQUEST", "campaignId is required");
    }

    const { campaignId } = req.body;

    const cancelledEmailsLength = await cancelEmails(campaignId);
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

app.post("/pause-campaign", async (req, res, next) => {
  try {
    if (!req.body.campaignId) {
      throw new AppError("BAD_REQUEST", "campaignId is required");
    }

    const { campaignId } = req.body;

    const isSuccess = await pauseCampaign(campaignId);
    if (!isSuccess) {
      throw new AppError("NOT_FOUND", "Campaign is not paused");
    }

    res.status(200).json({
      success: true,
      message: "Campaign is paused",
    });
  } catch (error) {
    next(error);
  }
});

app.post("/resume-campaign", async (req, res, next) => {
  try {
    if (!req.body.campaignId) {
      throw new AppError("BAD_REQUEST", "campaignId is required");
    }

    const { campaignId } = req.body;

    const isSuccess = await resumeCampaign(campaignId);
    if (!isSuccess) {
      throw new AppError("NOT_FOUND", "Campaign is not resumed");
    }

    res.status(200).json({
      success: true,
      message: "Campaign is resumed",
    });
  } catch (error) {
    next(error);
  }
});

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

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  expressErrorHandler(err, req, res, next);
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT} in ${process.env.NODE_ENV} mode`);
});
