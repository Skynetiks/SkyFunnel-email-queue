import express from "express";
import {
  initializeWorkerForCampaign,
  addEmailToQueue,
  addBulkEmailsToQueue,
} from "./emailQueue";
import { isCampaignOrg, isEmail, isValidEmail } from "./types";
import dotenv from "dotenv";
import { addEmailsToQueue } from "./admin-queue";

dotenv.config(); // Load environment variables from .env file

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json()); // Middleware to parse JSON bodies

// TODO: uncomment all auth token checks before push

// Initialize the worker for a campaign
app.post("/initialize-worker", async (req, res) => {
  const authToken = req.headers['authorization'];

  if (!authToken) {
  	res.status(401).send('Authorization token is required');
  	return;
  }

  if (authToken !== process.env.AUTH_TOKEN) {
  	res.status(403).send('Invalid authorization token');
  	return;
  }

  const { campaignId } = req.body;
  if (!campaignId) {
    return res.status(400).json({
      success: false,
      message: "Campaign ID is required",
    });
  }

  try {
    await initializeWorkerForCampaign(campaignId);
    res.status(200).json({
      success: true,
      message: "Worker initialized",
    });
  } catch (error: any) {
    console.error(`Failed to initialize worker: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Failed to initialize worker",
    });
  }
});

// Add an email to the queue
// app.post("/add-email", async (req, res) => {
//   const authToken = req.headers["authorization"];

//   if (!authToken) {
//     res.status(401).send("Authorization token is required");
//     return;
//   }

//   if (authToken !== process.env.AUTH_TOKEN) {
//     res.status(403).send("Invalid authorization token");
//     return;
//   }

//   const { email, campaignOrg, interval, index } = req.body;

//   if (!isEmail(email)) {
//     return res.status(400).json({
//       success: false,
//       message: "Invalid email",
//     });
//   }
//   if (!isCampaignOrg(campaignOrg)) {
//     return res.status(400).json({
//       success: false,
//       message: "Invalid campaignOrg",
//     });
//   }
//   if (!interval) {
//     return res.status(400).json({
//       success: false,
//       message: "Invalid interval",
//     });
//   }
//   if (!index) {
//     return res.status(400).json({
//       success: false,
//       message: "Invalid index",
//     });
//   }

//   try {
//     await addEmailToQueue(email, campaignOrg, interval, index);
//     res.status(200).json({
//       success: true,
//       message: "Email added to queue",
//     });
//   } catch (error: any) {
//     console.error(`Failed to add email to queue: ${error.message}`);
//     res.status(500).json({
//       success: false,
//       message: "Failed to add email to queue",
//     });
//   }
// });

// Add emails to the queue
app.post("/add-emails", async (req, res) => {
  const authToken = req.headers['authorization'];

  if (!authToken) {
  	res.status(401).send('Authorization token is required');
  	return;
  }

  if (authToken !== process.env.AUTH_TOKEN) {
  	res.status(403).send('Invalid authorization token');
  	return;
  }

  const { emails, campaignOrg, interval } = req.body;

  if (!Array.isArray(emails) || emails.some((email) => !isEmail(email))) {
    return res.status(400).json({
      success: false,
      message: "Invalid email list",
    });
  }
  if (!isCampaignOrg(campaignOrg)) {
    return res.status(400).json({
      success: false,
      message: "Invalid campaignOrg",
    });
  }
  if (!interval) {
    return res.status(400).json({
      success: false,
      message: "Invalid interval",
    });
  }

  try {
    await addBulkEmailsToQueue(emails, campaignOrg, interval);
    res.status(200).json({
      success: true,
      message: "Emails added to queue",
    });
  } catch (error: any) {
    console.error(`Failed to add emails to queue: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Failed to add emails to queue",
    });
  }
});

app.post("/add-admin-emails", async (req, res) => {
  const authToken = req.headers['authorization'];

  if (!authToken) {
  	res.status(401).send('Authorization token is required');
  	return;
  }

  if (authToken !== process.env.AUTH_TOKEN) {
  	res.status(403).send('Invalid authorization token');
  	return;
  }

  const { emails } = req.body;

	if (!Array.isArray(emails) || emails.some((email) => !isValidEmail(email))) {
		return res.status(400).json({
			success: false,
			message: "Invalid email list",
		});
	}

  try {
    await addEmailsToQueue(emails);

    res.status(200).json({
      success: true,
      message: "Emails added to queue",
    });
  } catch (error: any) {
    console.error(`Failed to add emails to queue: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Failed to add emails to queue",
    });
  }
});

app.get("/", (req: any, res: any) => {
  res.sendStatus(200);
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
