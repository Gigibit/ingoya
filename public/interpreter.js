const start = () => {
  const SpeechRecognition = (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SpeechRecognition || !window.audioManaged) {
    console.error("SpeechRecognition non supportato o non gestito.");
    return;
  }

  const recognition = new SpeechRecognition();
  const updateBtn = document.getElementById('update-params-btn');
  const promptInput = document.getElementById('prompt');

  let isListening = false;
  let finalTranscriptDelivered = false; // Flag per evitare invii multipli
  let stopTimer = null; // Timer per gestire l'arresto ritardato

  // --- CONFIGURAZIONE ---
  recognition.lang = 'it-IT';
  recognition.interimResults = true;

  promptInput.addEventListener('input', () => {
    updateBtn.classList.toggle('has-text', promptInput.value.trim() !== '');
  });

  const startRecognition = () => {
    if (updateBtn.classList.contains('has-text') || isListening) return;
    
    console.log("Tentativo di avvio riconoscimento...");
    try {
      finalTranscriptDelivered = false; // Resetta il flag
      promptInput.value = ''; // Pulisce l'input precedente
      recognition.start();
    } catch(e) {
      console.error("Errore immediato su recognition.start():", e.message);
    }
  };

  const stopRecognition = () => {
    if (!isListening) return;
    
    console.log("Rilascio pulsante: avvio timer per arresto...");
    // Diamo 750ms di tempo all'API per processare l'audio prima di fermarla.
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
        if(isListening) {
            console.log("Timer scaduto. Arresto forzato del riconoscimento.");
            recognition.stop();
        }
    }, 750); 
  };
  
  // Gestori eventi tocco e mouse
  updateBtn.addEventListener('mousedown', startRecognition);
  updateBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startRecognition();
  });

  updateBtn.addEventListener('mouseup', stopRecognition);
  updateBtn.addEventListener('mouseleave', stopRecognition);
  updateBtn.addEventListener('touchend', stopRecognition);

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

    // Fallback: se l'ascolto finisce senza che un risultato finale sia stato inviato,
    // inviamo l'ultimo testo parziale disponibile.
    if (!finalTranscriptDelivered && promptInput.value.trim()) {
        console.log(`Invio forzato dell'ultimo transcript: "${promptInput.value.trim()}"`);
        onSentenceComplete(promptInput.value.trim());
    }
  };

  recognition.onerror = (event) => {
    console.error(`❌ ERRORE RICONOSCIMENTO: ${event.error}`);
    isListening = false;
    updateBtn.classList.remove('is-recording');
  };

  recognition.onresult = (event) => {
    console.log("-> ✅ onresult event fired!");
    let interimTranscript = '';
    let finalTranscript = '';
    
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }
    
    // Aggiorna l'input con l'ultimo risultato disponibile
    promptInput.value = interimTranscript || finalTranscript;

    if (finalTranscript) {
        console.log(`Finale: "${finalTranscript.trim()}"`);
        promptInput.dispatchEvent(new Event('input')); 
        onSentenceComplete(finalTranscript.trim());
        finalTranscriptDelivered = true; // Segna che abbiamo inviato un risultato
        if (stopTimer) clearTimeout(stopTimer); // Annulla il timer se arriva un risultato finale
    }
  };

  // Log di debug aggiuntivi
  recognition.onspeechstart = () => { console.log("🗣️ Speech detected (onspeechstart)"); };
  recognition.onaudiostart = () => { console.log("🔊 Audio capture started (onaudiostart)"); };

  const onSentenceComplete = async (userMessage) => {
    if (!userMessage || finalTranscriptDelivered) return;
    finalTranscriptDelivered = true; // Previene invii doppi

    try {
      const res = await fetch("/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: userMessage })
      });
      const text = await res.text();
      const userMessageInterpolationEvent = new CustomEvent("usermessageinterpolation", {
        detail: { text: userMessage, interpolation: text }
      });
      document.dispatchEvent(userMessageInterpolationEvent);
    } catch (err) {
      console.error("❌ Errore fetch /interpret:", err);
    }
  };
};

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', start);
} else {
    start();
}

