import { sendEmailSES } from "./aws";
import { EmailData } from "./types";

export const handleJob = async (email: EmailData) => {
	try {
		const { to, subject, body } = email;

		const sentEmail = await sendEmailSES(
			"noreply@skyfunnel.ai",
			"SkyFunnel.ai",
			to,
			subject,
			body,
		);

		console.log(sentEmail);
	} catch (error) {
		console.error(error);
		throw error
	}
};
