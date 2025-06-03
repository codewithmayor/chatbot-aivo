// server/services/instagramService.js
const axios = require("axios");
const PAGE_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;

const API_URL = "https://graph.facebook.com/v16.0/698987272735504/messages";


async function sendText(recipientId, text) {
  await axios.post(
    API_URL,
    {
      recipient: { id: recipientId },
      message: { text },
    },
    { params: { access_token: PAGE_TOKEN } }
  );
}

async function sendQuickReplies(recipientId, text, replies) {
  const qr = replies.map((title) => ({
    content_type: "text",
    title,
    payload: title,
  }));
  try {
    await axios.post(
      API_URL,
      {
        recipient: { id: recipientId },
        message: { text, quick_replies: qr },
      },
      { params: { access_token: PAGE_TOKEN } }
    );
  } catch (err) {
    console.error("Instagram API error:", err.response?.data || err.message);
    throw err;
  }
}

async function sendButtonTemplate(recipientId, text, buttons) {
  // buttons: [ { type:'web_url', url, title }, { type:'postback', title, payload } ]
  await axios.post(
    API_URL,
    {
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text,
            buttons,
          },
        },
      },
    },
    { params: { access_token: PAGE_TOKEN } }
  );
}

console.log("Using token:", PAGE_TOKEN);
console.log("Using endpoint:", API_URL);


module.exports = { sendText, sendQuickReplies, sendButtonTemplate };