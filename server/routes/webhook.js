// server/routes/webhook.js
const express = require('express');
const router  = express.Router();
const config  = require('../../config/config.json');
const {
  sendText,
  sendQuickReplies,
  sendButtonTemplate
} = require('../services/instagramService');
const { saveLead, logEvent }     = require('../services/airtableService');
const { notifyHuman }            = require('../services/notificationService');

const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN;

// In‐memory sessions (for demo; swap for Redis in prod)
const sessions = {}; 
// shape: { [userId]: { step, answers: {}, timer, fallbackCount } }

  
//── Verification endpoint ──────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});


//── Webhook receiver ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const body = req.body;
  if (body.object !== 'instagram') return res.sendStatus(404);

  for (const entry of body.entry) {
    for (const ev of entry.messaging) {
      const user = ev.sender.id;

      if (ev.message && ev.message.text) {
        await handleIncomingText(user, ev.message.text);
      }
      else if (ev.postback && ev.postback.payload) {
        await handleIncomingText(user, ev.postback.payload);
      }
    }
  }

  res.sendStatus(200);
});


//── Core conversation handler ────────────────────────────────────────────────
async function handleIncomingText(user, text) {
  // 1) init session
  if (!sessions[user]) {
    sessions[user] = { step: 0, answers: {}, fallbackCount: 0, timer: null };
  }
  const sess = sessions[user];

  // 2) cancel any pending “no‐response” timer
  if (sess.timer) {
    clearTimeout(sess.timer);
    sess.timer = null;
  }

  // 3) FAQ auto‐reply
  const lower = text.toLowerCase();
  for (const faq of config.faq) {
    if (faq.keywords.some(k => lower.includes(k))) {
      await sendText(user, faq.answer);
      await logEvent({ user, direction:'out', text: faq.answer });
      scheduleInactivity(user);
      return;
    }
  }

  // 4) human‐handoff
  if (text === 'HUMAN_HANDOFF') {
    await sendText(user, "Un coach arrive tout de suite ! 🙂");
    await notifyHuman({ user, answers: sess.answers });
    await logEvent({ user, direction:'out', text:'Human handoff' });
    endSession(user);
    return;
  }

  // 5) main flow
  const m = config.messages;
  switch (sess.step) {
    case 0:
      // welcome
      await sendQuickReplies(user, m.welcome, ['Oui','Pas sûr']);
      await logEvent({ user, direction:'out', text:m.welcome });
      sess.step = 1;
      break;

    case 1:
      // user replied to welcome
      sess.answers.welcome = text;
      await logEvent({ user, direction:'in', text });
      if (text === 'Oui') {
        await sendQuickReplies(user, m.express, ['Oui','Non']);
        sess.step = 2;
      } else {
        // “Pas sûr” branch
        await sendText(
          user,
          "Je peux t’expliquer comment on aide des coachs comme Julien à générer +22 RDVs en 2 semaines. Tu veux que je t’en dise plus ?"
        );
        sess.step = 10; // alternate branch
      }
      break;

    case 2:
      // express block
      sess.answers.express = text;
      await logEvent({ user, direction:'in', text });
      if (text === 'Oui') {
        await sendButtonTemplate(
          user,
          m.express,
          [{ type:'web_url', url: config.links.callStrategique, title:'Réserver un appel' }]
        );
        sess.answers.tag = config.tags.hotFastlane;
        return finalizeLead(user);
      } else {
        // continue normal
        await sendQuickReplies(user, m.over18, ['Oui','Non']);
        sess.step = 3;
      }
      break;

    case 3:
      // over-18?
      sess.answers.over18 = text;
      await logEvent({ user, direction:'in', text });
      if (text !== 'Oui') {
        await sendText(user, m.over18No);
        return endSession(user);
      }
      await sendQuickReplies(user, m.business, ['Oui, déjà lancé','Pas encore lancé']);
      sess.step = 4;
      break;

    case 4:
      // business launched?
      sess.answers.business = text;
      await logEvent({ user, direction:'in', text });
      if (text === 'Pas encore lancé') {
        await sendQuickReplies(user, m.matrixOffer, ['Oui','Non']);
        sess.step = 5;
      } else {
        await sendText(user, m.activity);
        sess.step = 6;
      }
      break;

    case 5:
      // matrix offer branch
      sess.answers.matrix = text;
      await logEvent({ user, direction:'in', text });
      if (text === 'Oui') {
        await sendButtonTemplate(
          user,
          m.matrixYes,
          [{ type:'web_url', url: config.links.pdfMatrice, title:'Télécharger le PDF' }]
        );
        sess.answers.tag = config.tags.leadFutur;
      } else {
        await sendText(user, m.matrixNo);
      }
      return endSession(user);

    case 6:
      // activity free text
      sess.answers.activity = text;
      await logEvent({ user, direction:'in', text });
      await sendQuickReplies(user, m.budget, ['<100€','100–500€','Jusqu’à 1000€']);
      sess.step = 7;
      break;

    case 7:
      // budget
      sess.answers.budget = text;
      await logEvent({ user, direction:'in', text });
      if (text === '<100€') {
        await sendButtonTemplate(
          user,
          m.starterOffer,
          [{ type:'web_url', url: config.links.callStrategique, title:'Réserver un appel' }]
        );
        sess.answers.tag = config.tags.leadChaud;
        return finalizeLead(user);
      }
      // higher budgets
      await sendQuickReplies(
        user,
        'Appel stratégique ou démo vidéo ?',
        ['Appel stratégique','Démo vidéo']
      );
      sess.step = 8;
      break;

    case 8:
      // appel vs démo
      sess.answers.next = text;
      await logEvent({ user, direction:'in', text });
      if (text === 'Appel stratégique') {
        await sendButtonTemplate(
          user,
          'Réservez un appel stratégique :',
          [{ type:'web_url', url: config.links.callStrategique, title:'Calendly' }]
        );
        sess.answers.tag = config.tags.leadChaud;
      } else {
        await sendButtonTemplate(
          user,
          'Voici la démo vidéo :',
          [{ type:'web_url', url: config.links.videoDemo, title:'Voir la vidéo' }]
        );
        sess.answers.tag = config.tags.leadQualifie;
      }
      return finalizeLead(user);

    case 10:
      // “Pas sûr” after welcome
      sess.answers.explain = text;
      await logEvent({ user, direction:'in', text });
      if (lower.startsWith('oui')) {
        await sendQuickReplies(user, m.over18, ['Oui','Non']);
        sess.step = 3;
      } else {
        await sendText(user, m.thankYou);
        return endSession(user);
      }
      break;

    default:
      // fallback
      await sendText(user, m.fallback1);
      sess.step = 0;
      break;
  }

  // 6) schedule inactivity‐followup
  sess.timer = setTimeout(() => followUpNoResponse(user), 60 * 1000);
}


//── Inactivity follow-up & human-handoff ─────────────────────────────────────
async function followUpNoResponse(user) {
  const sess = sessions[user];
  if (!sess) return;

  await sendText(user, config.messages.noResponse);
  await logEvent({ user, direction:'out', text: config.messages.noResponse });

  sess.fallbackCount = (sess.fallbackCount || 0) + 1;
  if (sess.fallbackCount > 1) {
    await sendButtonTemplate(
      user,
      config.messages.fallback2,
      [{ type:'postback', title:'Contacter un coach', payload:'HUMAN_HANDOFF' }]
    );
  }
}


//── Save the lead & say thanks ────────────────────────────────────────────────
async function finalizeLead(user) {
  const sess = sessions[user];
  await saveLead({
    name:     sess.answers.activity || 'Inconnu',
    email:    'non fourni',
    activity: sess.answers.activity || '',
    budget:   sess.answers.budget || '',
    tag:      sess.answers.tag
  });
  await logEvent({
    user,
    direction:'out',
    text: config.messages.thankYou,
    tag: sess.answers.tag
  });
  await sendText(user, config.messages.thankYou);
  endSession(user);
}


//── Tear down session when conversation ends ─────────────────────────────────
function endSession(user) {
  if (sessions[user]?.timer) {
    clearTimeout(sessions[user].timer);
  }
  delete sessions[user];
}


module.exports = router;
