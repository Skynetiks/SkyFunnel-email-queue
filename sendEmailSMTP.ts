import nodemailer from "nodemailer";

export async function sendEmailSMTP(
  senderEmail: string,
  senderName: string,
  recipient: string,
  subject: string,
  body: string,
  password: string,
  replyToEmail?: string,
) {
  try {
    if (!process.env.SMTP_HOST) {
      console.error("Missing SMTP_HOST")
    }
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, 
      port: 465, 
      secure: false,
      auth: {
        user: senderEmail,
        pass: password,
      },
    });

    // Prepare the email options
    const mailOptions = {
      from: `"${senderName}" <${senderEmail}>`,
      to: recipient,
      subject: subject,
      text: body,
      html: `<p>${body}</p>`,
      replyTo: replyToEmail || senderEmail,
    };

    const info = await transporter.sendMail(mailOptions);
    transporter.close();

    console.log("Email sent:", info.messageId);
    return info;
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
}
