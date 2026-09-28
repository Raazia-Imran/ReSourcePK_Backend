const { query } = require("../db");
const { sendMail } = require("./mailer");

async function deliverEmail({ eventKey, recipient, template, message }) {
  const inserted = await query(
    `INSERT INTO app.email_deliveries(event_key, recipient, template)
     VALUES ($1, $2, $3)
     ON CONFLICT (event_key) DO NOTHING
     RETURNING id`,
    [eventKey, recipient, template],
  );
  if (!inserted.rowCount) return { duplicate: true };

  const deliveryId = inserted.rows[0].id;
  try {
    const messageId = await sendMail({ to: recipient, ...message });
    await query(
      `UPDATE app.email_deliveries
       SET status = 'sent', provider_message_id = $2, attempt_count = 1, sent_at = NOW()
       WHERE id = $1`,
      [deliveryId, messageId],
    );
    return { messageId };
  } catch (error) {
    await query(
      `UPDATE app.email_deliveries
       SET status = 'failed', last_error = $2, attempt_count = 1
       WHERE id = $1`,
      [deliveryId, String(error.message).slice(0, 500)],
    );
    throw error;
  }
}

module.exports = { deliverEmail };
