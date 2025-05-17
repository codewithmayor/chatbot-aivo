// server/services/notificationService.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function notifyHuman(session) {
  const body = `
New human handoff request for user ${session.user}:

${Object.entries(session.answers)
  .map(([k,v]) => `${k}: ${v}`)
  .join('\n')}
`;
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to:   process.env.NOTIFY_EMAIL,
    subject: `Chatbot Handoff – ${session.user}`,
    text:    body
  });
}

module.exports = { notifyHuman };
