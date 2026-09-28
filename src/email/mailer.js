const nodemailer = require("nodemailer");
const { env } = require("../config/env");
const { AppError } = require("../lib/errors");

let transporter;

function getTransporter() {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
    throw new AppError(
      503,
      "EMAIL_NOT_CONFIGURED",
      "Email delivery is not configured",
    );
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
      pool: true,
      maxConnections: 2,
      maxMessages: 50,
      connectionTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
}

async function sendMail({ to, subject, text, html }) {
  const info = await getTransporter().sendMail({
    from: { name: env.EMAIL_FROM_NAME, address: env.GMAIL_USER },
    replyTo: env.GMAIL_USER,
    to,
    subject,
    text,
    html,
  });
  return info.messageId;
}

module.exports = { sendMail };
