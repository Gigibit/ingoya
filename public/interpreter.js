const start = () => {
  const SpeechRecognition = (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SpeechRecognition || !window.audioManaged) {
    console.error("SpeechRecognition non supportato o non gestito.");
    return;
  }

  const recognition = new SpeechRecognition();
  const updateBtn = document.getElementById('update-params-btn');
  const promptInput = document.getElementById('prompt');

  // --- Stati ---
  let isListening = false; // Stato reale del riconoscimento

  // --- Config ---
  recognition.lang = 'it-IT';
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  // --- Gestione della UI del Pulsante ---
  promptInput.addEventListener('input', () => {
    updateBtn.classList.toggle('has-text', promptInput.value.trim() !== '');
  });

  // --- Funzioni per avviare e fermare il riconoscimento ---
  const startRecognition = () => {
    if (isListening || promptInput.value.trim() !== '') return;
    try {
      recognition.start();
    } catch(e) {
      console.error("Errore all'avvio del riconoscimento:", e.message);
    }
  };

  const stopRecognition = () => {
    if (!isListening) return;
    recognition.stop();
  };
  
  // --- Logica "Premi per Parlare" (Push-to-Talk) ---
  // Usiamo mousedown e touchstart per avviare
  updateBtn.addEventListener('mousedown', startRecognition);
  updateBtn.addEventListener('touchstart', (e) => {
    e.preventDefault(); // Impedisce l'attivazione di eventi 'mousedown' duplicati
    startRecognition();
  });

  // Usiamo mouseup, mouseleave e touchend per fermare
  updateBtn.addEventListener('mouseup', stopRecognition);
  updateBtn.addEventListener('mouseleave', stopRecognition);
  updateBtn.addEventListener('touchend', stopRecognition);
  
  // Gestione click per invio testo
  updateBtn.addEventListener('click', (e) => {
      if (updateBtn.classList.contains('has-text')) {
          console.log("Click rilevato per invio testo.");
          document.dispatchEvent(new CustomEvent('sendprompt'));
      }
  });


  // --- Eventi dell'API SpeechRecognition ---
  recognition.onstart = () => {
    isListening = true;
    updateBtn.classList.add('is-recording');
    console.log("🎤 In ascolto...");
  };

  recognition.onend = () => {
    isListening = false;
    updateBtn.classList.remove('is-recording');
    console.log("🛑 Ascolto terminato.");
  };

  recognition.onerror = (event) => {
    console.error("❌ Errore Riconoscimento Vocale:", event.error);
    isListening = false;
    updateBtn.classList.remove('is-recording');
  };

  recognition.onresult = (event) => {
    let finalTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      }
    }
    if (finalTranscript) {
        console.log("Testo finale riconosciuto:", finalTranscript);
        onSentenceComplete(finalTranscript.trim());
    }
  };

  // --- Azione su frase completa ---
  const onSentenceComplete = async (userMessage) => {
    try {
      const res = await fetch("/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: userMessage })
      });
      const text = await res.text();
      if (text.length > 4) popWords(text);
      document.dispatchEvent(new CustomEvent("usermessageinterpolation", {
        detail: { text: userMessage, interpolation: text }
      }));
    } catch (err) {
      console.error("❌ Errore fetch /interpret:", err);
    }
  };

  // --- Effetti grafici parole ---
  function popWords(text) {
    const words = text.split(",");
    words.forEach((w, i) => {
      setTimeout(() => popWord(w.replaceAll(/\\|"/g, '')), i * 300);
    });
  }

  function popWord(word) {
    const span = document.createElement("span");
    span.textContent = word;
    span.className = "word-pop";
    const fontSize = Math.random() * 7 + 5;
    span.style.fontSize = fontSize + "vw";
    const x = Math.random() * (window.innerWidth - 200);
    const y = Math.random() * (window.innerHeight - 200);
    span.style.left = `${x}px`;
    span.style.top = `${y}px`;
    document.body.appendChild(span);
    requestAnimationFrame(() => span.classList.add("show"));
    setTimeout(() => {
      span.classList.remove("show");
      span.classList.add("fadeout");
    }, 2000 + Math.random() * 1000);
    setTimeout(() => span.remove(), 4000);
  }
  document.addEventListener('popwords', (e) => popWords(e.detail));

};

// Avvia tutto solo quando la pagina è caricata
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', start);
} else {
    start();
}

