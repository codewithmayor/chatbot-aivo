const express = require('express');
const router  = express.Router();
const config  = require('../../config/config.json');
const { sendText, sendQuickReplies, sendButtonTemplate } = require('../services/instagramService');
const { saveLead, logEvent } = require('../services/airtableService');
const { notifyHuman } = require('../services/notificationService');
const { getSession, setSession, clearSession } = require('../services/sessionService');

const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN;

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
  // Get session from Redis (or initialize if missing)
  let sess = await getSession(user);
  if (!sess) sess = { step: 0, answers: {}, fallbackCount:0, timer: null };

  // FAQ auto-response
  const lower = text.toLowerCase();
  for (const faq of config.faq) {
    if (faq.keywords.some(k => lower.includes(k))) {
      await sendText(user, faq.answer);
      await logEvent({ user, direction: 'out', text: faq.answer });
      return;
    }
  }

  // Human handoff
  if (text === 'HUMAN_HANDOFF') {
    await sendText(user, "Un coach arrive tout de suite ! 🙂");
    await notifyHuman({ user, answers: sess.answers });
    await logEvent({ user, direction: 'out', text: 'Human handoff triggered' });
    await clearSession(user);
    return;
  }

  // Main flow
  const m = config.messages;
  switch (sess.step) {
    case 0:
      await sendQuickReplies(user, m.welcome, ['Oui','Pas sûr']);
      await logEvent({ user, direction:'out', text: m.welcome });
      sess.step++;
      break;

    case 1:
      if (text === 'Oui') {
        await sendQuickReplies(user, m.express, ['Oui','Non']);
      } else {
        await sendText(user, "Je peux t’expliquer comment on aide des coachs comme Julien à générer +22 RDVs en2 semaines. Tu veux que je t’en dise plus ?");
      }
      sess.answers.welcome = text;
      await logEvent({ user, direction:'in', text });
      sess.step++;
      break;

    case 2:
      if (sess.answers.welcome === 'Oui') {
        if (text === 'Oui') {
          await sendButtonTemplate(
            user,
            m.express,
            [{ type:'web_url', url: config.links.callStrategique, title:'Réserver un appel' }]
          );
          sess.answers.tag = config.tags.hotFastlane;
          await setSession(user, sess);
          return await finalizeLead(user);
        } else {
          await sendQuickReplies(user, m.over18, ['Oui','Non']);
        }
      } else {
        if (text.toLowerCase().startsWith('oui')) {
          await sendQuickReplies(user, m.over18, ['Oui','Non']);
        } else {
          await sendText(user, m.matrixNo);
          await clearSession(user);
          return;
        }
      }
      await logEvent({ user, direction:'in', text });
      sess.step++;
      break;

    case 3:
      if (text === 'Non') {
        await sendText(user, m.over18No);
        await clearSession(user);
        return;
      }
      await sendQuickReplies(user, m.business, ['Oui, déjà lancé','Pas encore lancé']);
      sess.answers.over18 = text;
      await logEvent({ user, direction:'in', text });
      sess.step++;
      break;

    case 4:
      sess.answers.business = text;
      if (text === 'Pas encore lancé') {
        await sendQuickReplies(user, m.matrixOffer, ['Oui','Non']);
      } else {
        await sendQuickReplies(user, m.activity, []);
      }
      await logEvent({ user, direction:'in', text });
      sess.step++;
      break;

    case 5:
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
        await clearSession(user);
        return;
      } else {
        sess.answers.activity = text;
        await sendQuickReplies(user, m.budget, ['<100€','100–500€','Jusqu’à 1000€']);
      }
      await logEvent({ user, direction:'in', text });
      sess.step++;
      break;

    case 6:
      sess.answers.budget = text;
      if (text === '<100€') {
        await sendButtonTemplate(
          user,
          m.starterOffer,
          [{ type:'web_url', url: config.links.callStrategique, title:'Réserver un appel' }]
        );
        sess.answers.tag = config.tags.leadChaud;
        await setSession(user, sess);
        return await finalizeLead(user);
      } else if (text === '100–500€' || text === 'Jusqu’à1000€') {
        await sendQuickReplies(user, 'Appel stratégique ou démo vidéo ?', ['Appel stratégique','Démo vidéo']);
      } else {
        await sendButtonTemplate(
          user,
          "Voici notre script et matrice :",
          [{ type:'web_url', url: config.links.pdfMatrice, title:'Télécharger le PDF' }]
        );
        sess.answers.tag = config.tags.leadMaturer;
        await setSession(user, sess);
        return await finalizeLead(user);
      }
      await logEvent({ user, direction:'in', text });
      sess.step++;
      break;

    case 7:
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
          [{ type:'web_url', url: config.links.videoDemo, title: 'Voir la vidéo' }]
        );
        sess.answers.tag = config.tags.leadQualifie;
      }
      await logEvent({ user, direction:'in', text });
      await setSession(user, sess);
      return await finalizeLead(user);

    default:
      await sendText(user, m.fallback1);
      sess.step = 0;
      break;
  }

  // Save session after step update
  await setSession(user, sess);
}

async function finalizeLead(user) {
  const sess = await getSession(user);
  await saveLead({
    name:     sess.answers.activity || 'Inconnu',
    email:    'non fourni',
    activity: sess.answers.activity || '',
    budget:   sess.answers.budget || '',
    tag:      sess.answers.tag
  });
  await logEvent({ user, direction:'out', text: config.messages.thankYou, tag: sess.answers.tag });
  await sendText(user, config.messages.thankYou);
  await clearSession(user);
}

module.exports = router;
