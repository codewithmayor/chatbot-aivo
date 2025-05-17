// server/services/airtableService.js
const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE);

async function saveLead({ name, email, activity, budget, tag }) {
  return base('Leads').create({
    Prénom:        name,
    Email:         email,
    Activité:      activity,
    Budget:        budget,
    Tag:           tag,
    Source:        'Chatbot Insta',
    "Date d'entrée": new Date().toISOString()
  });
}

async function logEvent({ user, direction, text, tag }) {
  return base('Logs').create({
    User:      user,
    Direction: direction,   // 'in' or 'out'
    Message:   text,
    Tag:       tag || '',
    Timestamp: new Date().toISOString()
  });
}

module.exports = { saveLead, logEvent };
