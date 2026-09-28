function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function actionEmail({
  title,
  preview,
  greeting,
  message,
  actionLabel,
  actionUrl,
  expiry,
}) {
  const safe = {
    title: escapeHtml(title),
    preview: escapeHtml(preview),
    greeting: escapeHtml(greeting),
    message: escapeHtml(message),
    actionLabel: escapeHtml(actionLabel),
    actionUrl: escapeHtml(actionUrl),
    expiry: escapeHtml(expiry),
  };
  return `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${safe.title}</title></head>
<body style="margin:0;background:#f2efe7;color:#17242a;font-family:Arial,sans-serif">
<div lang="en" dir="ltr" style="display:none;max-height:0;overflow:hidden">${safe.preview}</div>
<div lang="en" dir="ltr" style="max-width:560px;margin:0 auto;padding:32px 18px">
  <div style="background:#fff;border:1px solid #d9d3c7;border-radius:22px;padding:36px 30px">
    <p style="margin:0 0 28px;font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#7b3f98">ReSource PK</p>
    <h1 style="font-size:28px;line-height:1.2;margin:0 0 18px">${safe.title}</h1>
    <p style="font-size:16px;line-height:1.6;margin:0 0 12px">${safe.greeting}</p>
    <p style="font-size:16px;line-height:1.6;margin:0 0 26px">${safe.message}</p>
    <a href="${safe.actionUrl}" style="display:inline-block;min-height:44px;line-height:44px;padding:0 22px;border-radius:999px;background:#17242a;color:#fff;text-decoration:none;font-weight:700">${safe.actionLabel}</a>
    <p style="font-size:13px;line-height:1.5;color:#626b70;margin:26px 0 0">This link expires ${safe.expiry}. If you did not request this, you can ignore this email.</p>
  </div>
</div></body></html>`;
}

function verificationEmail({ name, url }) {
  return {
    subject: "Verify your email for ReSource PK",
    text: `Hello ${name}, verify your email using this link: ${url}\nThe link expires in 24 hours.`,
    html: actionEmail({
      title: "Verify your email",
      preview:
        "Complete your ReSource PK account. This link expires in 24 hours.",
      greeting: `Hello ${name},`,
      message:
        "Confirm your email address to activate your account and enter your workspace.",
      actionLabel: "Verify email",
      actionUrl: url,
      expiry: "in 24 hours",
    }),
  };
}

function passwordResetEmail({ name, url }) {
  return {
    subject: "Reset your ReSource PK password",
    text: `Hello ${name}, reset your password using this link: ${url}\nThe link expires in 1 hour.`,
    html: actionEmail({
      title: "Reset your password",
      preview: "Use this secure link within one hour to reset your password.",
      greeting: `Hello ${name},`,
      message:
        "A password reset was requested for your account. Use the secure link below to choose a new password.",
      actionLabel: "Reset password",
      actionUrl: url,
      expiry: "in 1 hour",
    }),
  };
}

function organizationInviteEmail({ organizationName, inviterName, role, url }) {
  return {
    subject: `Join ${organizationName} on ReSource PK`,
    text: `${inviterName} invited you to join ${organizationName} as ${role}. Accept within 72 hours: ${url}`,
    html: actionEmail({
      title: `Join ${organizationName}`,
      preview: `${inviterName} invited you to their ReSource PK workspace.`,
      greeting: "You have been invited,",
      message: `${inviterName} invited you to join ${organizationName} as ${role}.`,
      actionLabel: "Accept invitation",
      actionUrl: url,
      expiry: "in 72 hours",
    }),
  };
}

module.exports = {
  verificationEmail,
  passwordResetEmail,
  organizationInviteEmail,
};
