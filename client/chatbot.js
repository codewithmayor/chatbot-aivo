// load config from /config/config.json if needed; here we hardcode for demo
const CONFIG = {
    welcome:    "Tu veux arrêter de répondre à 47 messages/jour pour zéro RDV ? 😩 Tu veux te réveiller avec un agenda rempli sans rien faire ?",
    express:    "Tu veux aller droit au but et réserver ton appel stratégique maintenant ? 🔥",
    over18:     "T’as plus de 18 ans ?",
    business:   "Ton activité est lancée ou encore en construction ?",
    matrixAsk:  "Je peux t’envoyer notre guide Matrice Insta qui Convertit ?",
    activity:   "Tu fais quoi exactement ? Et tu génères déjà des leads en DM ?",
    budget:     "Si je te montrais un système qui te fait gagner 20h/mois et +30% de RDVs, quel budget mensuel te semblerait logique ?",
    thankYou:   "Merci ! Nous revenons vers toi sous peu."
  };
  
  const STEPS = [
    { key: 'welcome',  type: 'choice', options: ['Oui', 'Pas sûr'] },
    { key: 'over18',  type: 'choice', options: ['Oui', 'Non'] },
    { key: 'business',type: 'choice', options: ['Oui, déjà lancé', 'Pas encore lancé'] },
    { key: 'activity',type: 'input'  },
    { key: 'budget',  type: 'choice', options: ['<100€','100–500€','Jusqu’à 1000€'] },
    { key: 'thankYou',type: 'end'    }
  ];
  
  let stepIndex = 0;
  const responses = {};
  
  const chatlog  = document.getElementById('chatlog');
  const inputEl  = document.getElementById('userInput');
  const sendBtn  = document.getElementById('sendBtn');
  
  function appendMessage(who, text) {
    const p = document.createElement('p');
    p.className = 'message ' + who;
    p.innerText = text;
    chatlog.append(p);
    chatlog.scrollTop = chatlog.scrollHeight;
  }
  
  function showStep() {
    const step = STEPS[stepIndex];
    const msg  = CONFIG[step.key];
    appendMessage('bot', msg);
    if (step.type === 'choice') {
      inputEl.placeholder = 'Choisis : ' + step.options.join(' / ');
    } else {
      inputEl.placeholder = 'Écris ta réponse…';
    }
  }
  
  async function handleResponse(text) {
    const step = STEPS[stepIndex];
    appendMessage('user', text);
    responses[step.key] = text;
  
    // custom branching
    if (step.key === 'business' && text === 'Pas encore lancé') {
      appendMessage('bot', "Je peux t’envoyer notre guide Matrice Insta qui Convertit ?");
      // skip to next after matrixAsk
      return;
    }
  
    stepIndex++;
    if (stepIndex < STEPS.length) {
      showStep();
    } else {
      // send to backend
      await fetch('/api/lead', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          name:   responses.activity || 'Inconnu',
          email:  'non fourni',
          activity: responses.activity,
          budget:   responses.budget,
          tag:      'lead_maturer'
        })
      });
      appendMessage('bot', 'Ton inscription est prise en compte. À bientôt !');
      inputEl.disabled = sendBtn.disabled = true;
    }
  }
  
  sendBtn.addEventListener('click', () => {
    const text = inputEl.value.trim();
    if (!text) return;
    handleResponse(text);
    inputEl.value = '';
  });
  
  showStep();
  