// server/routes/webhook.js
const express = require('express');
const router  = express.Router();
const config  = require('../../config/config.json');
const { sendText, sendQuickReplies, sendButtonTemplate } = require('../services/instagramService');
const { saveLead, logEvent } = require('../services/airtableService');
const { notifyHuman } = require('../services/notificationService');

const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN;

// In-memory sessions (for demo; use Redis in prod)
const sessions = {}; /* { [userId]: { step, answers:{}, timer, fallbackCount } } */

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'], token = req.query['hub.verify_token'], challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});

router.post('/', async (req, res) => {
  const body = req.body;
  if (body.object !== 'instagram') return res.sendStatus(404);

  for (const entry of body.entry) {
    for (const ev of entry.messaging) {
      const user = ev.sender.id;
      if (ev.message && ev.message.text) {
        await handleIncomingText(user, ev.message.text);
      } else if (ev.postback && ev.postback.payload) {
        await handleIncomingText(user, ev.postback.payload);
      }
    }
  }
  res.sendStatus(200);
});

async function handleIncomingText(user, text) {
  // initialize session
  if (!sessions[user]) sessions[user] = { step: 0, answers: {}, fallbackCount: 0, timer: null };

  const sess = sessions[user];
  // clear any pending inactivity timer
  if (sess.timer) clearTimeout(sess.timer);

  // 1) FAQ auto-response
  const lower = text.toLowerCase();
  for (const faq of config.faq) {
    if (faq.keywords.some(k => lower.includes(k))) {
      await sendText(user, faq.answer);
      await logEvent({ user, direction: 'out', text: faq.answer });
      return;
    }
  }

  // 2) Handle human handoff payload
  if (text === 'HUMAN_HANDOFF') {
    await sendText(user, "Un coach arrive tout de suite ! 🙂");
    await notifyHuman({ user, answers: sess.answers });
    await logEvent({ user, direction: 'out', text: 'Human handoff triggered' });
    return;
  }

  // 3) Main flow steps
  const m = config.messages;
  switch (sess.step) {
    case 0: // welcome
      await sendQuickReplies(user, m.welcome, ['Oui','Pas sûr']);
      await logEvent({ user, direction:'out', text: m.welcome });
      break;

    case 1: // response to welcome
      if (text === 'Oui') {
        await sendQuickReplies(user, m.express, ['Oui','Non']);
      } else {
        // Pas sûr → explanation branch
        await sendText(user, "Je peux t’expliquer comment on aide des coachs comme Julien à générer +22 RDVs en 2 semaines. Tu veux que je t’en dise plus ?");
      }
      sess.answers.welcome = text;
      await logEvent({ user, direction:'in', text });
      break;

    case 2: // express block or "Pas sûr" branch
      if (sess.answers.welcome === 'Oui') {
        // express branch
        if (text === 'Oui') {
          await sendButtonTemplate(
            user,
            m.express,
            [{ type:'web_url', url: config.links.callStrategique, title:'Réserver un appel' }]
          );
          sess.answers.tag = config.tags.hotFastlane;
        } else {
          // continue normal
          await sendQuickReplies(user, m.over18, ['Oui','Non']);
        }
      } else {
        // "Pas sûr" → after explanation
        if (text.toLowerCase().startsWith('oui')) {
          await sendQuickReplies(user, m.over18, ['Oui','Non']);
        } else {
          await sendText(user, m.matrixNo);
          return endSession(user);
        }
      }
      await logEvent({ user, direction:'in', text });
      break;

    case 3: // over18?
      if (text === 'Non') {
        await sendText(user, m.over18No);
        return endSession(user);
      }
      await sendQuickReplies(user, m.business, ['Oui, déjà lancé','Pas encore lancé']);
      sess.answers.over18 = text;
      await logEvent({ user, direction:'in', text });
      break;

    case 4: // business launched?
      sess.answers.business = text;
      if (text === 'Pas encore lancé') {
        await sendQuickReplies(user, m.matrixOffer, ['Oui','Non']);
      } else {
        await sendQuickReplies(user, m.activity, []); // free-text next
      }
      await logEvent({ user, direction:'in', text });
      break;

    case 5: // matrixOffer branch?
      if (sess.answers.business === 'Pas encore lancé') {
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
      } else {
        // activity free-text
        sess.answers.activity = text;
        await sendQuickReplies(user, m.budget, ['<100€','100–500€','Jusqu’à 1000€']);
      }
      await logEvent({ user, direction:'in', text });
      break;

    case 6: // budget
      sess.answers.budget = text;
      if (text === '<100€') {
        await sendButtonTemplate(
          user,
          m.starterOffer,
          [{ type:'web_url', url: config.links.callStrategique, title:'Réserver un appel' }]
        );
        sess.answers.tag = config.tags.leadChaud;
      } else if (text === '100–500€' || text === 'Jusqu’à 1000€') {
        await sendQuickReplies(user, 'Appel stratégique ou démo vidéo ?', ['Appel stratégique','Démo vidéo']);
      } else {
        // any other – send script & matrix
        await sendButtonTemplate(
          user,
          "Voici notre script et matrice :",
          [{ type:'web_url', url: config.links.pdfMatrice, title:'Télécharger le PDF' }]
        );
        sess.answers.tag = config.tags.leadMaturer;
        return finalizeLead(user);
      }
      await logEvent({ user, direction:'in', text });
      break;

    case 7: // appel vs démo branch
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
      await logEvent({ user, direction:'in', text });
      return finalizeLead(user);
  }

  sess.step++;
  // set inactivity follow-up
  sess.timer = setTimeout(() => followUpNoResponse(user), 60*1000);
}

async function followUpNoResponse(user) {
  const sess = sessions[user];
  if (!sess) return;
  await sendText(user, config.messages.noResponse);
  await logEvent({ user, direction:'out', text: config.messages.noResponse });
  sess.fallbackCount = (sess.fallbackCount||0) + 1;
  if (sess.fallbackCount > 1) {
    // offer human handoff
    await sendButtonTemplate(
      user,
      config.messages.fallback2,
      [{ type:'postback', title:'Contacter un coach', payload:'HUMAN_HANDOFF' }]
    );
  }
}

async function finalizeLead(user) {
  const sess = sessions[user];
  await saveLead({
    name:     sess.answers.activity || 'Inconnu',
    email:    'non fourni',
    activity: sess.answers.activity || '',
    budget:   sess.answers.budget || '',
    tag:      sess.answers.tag
  });
  await logEvent({ user, direction:'out', text: config.messages.thankYou, tag: sess.answers.tag });
  await sendText(user, config.messages.thankYou);
  endSession(user);
}

function endSession(user) {
  if (sessions[user]?.timer) clearTimeout(sessions[user].timer);
  delete sessions[user];
}

module.exports = router;