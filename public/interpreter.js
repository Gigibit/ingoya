const start = () => {
  const SpeechRecognition = (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SpeechRecognition || !window.audioManaged) {
    console.log("Il tuo browser non supporta SpeechRecognition, o non ci sono le condizioni per gestirlo.");
    return;
  }
  
  const recognition = new SpeechRecognition();
  // --- MODIFICA: La variabile 'recognizing' ora controlla lo stato desiderato
  let recognizing = false; // Partiamo da spento
  let finalTranscript = "";

  recognition.lang = 'it-IT';
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  const micButton = document.getElementById('mic-button');
  if (micButton) {
      micButton.addEventListener('click', () => {
        // --- MODIFICA: Logica di toggle più robusta
        if (recognizing) {
          recognizing = false;
          recognition.stop();
          console.log("🎤 Riconoscimento fermato manualmente.");
        } else {
          recognizing = true;
          recognition.start();
          console.log("🎤 Riconoscimento avviato manualmente.");
        }
      });
  }


  const onSentenceComplete = async (userMessage) => {
    console.log("🎯 Frase completa:", userMessage);

    try {
      const res = await fetch("/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: userMessage })
      });

      const text = await res.text();
      if (text.length > 2) popWords(text);

      const userMessageInterpolationEvent = new CustomEvent("usermessageinterpolation", {
        detail: {
          text: userMessage,
          interpolation: text
        }
      });
      document.dispatchEvent(userMessageInterpolationEvent);

    } catch (err) {
      console.log("❌ Errore fetch /interpret:", err);
    }
  };

  recognition.onresult = (event) => {
    let interimTranscript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript + " ";
        onSentenceComplete(transcript.trim());
        finalTranscript = '';
      } else {
        interimTranscript += transcript;
      }
    }
  };

  recognition.onerror = (event) => {
    console.error("Errore riconoscimento vocale:", event.error);
  };

  recognition.onend = () => {
    // --- MODIFICA CHIAVE: Riavvia solo se l'utente non lo ha spento
    if (recognizing) {
      console.log("Riconoscimento terminato (timeout/naturale). Riparto automaticamente...");
      setTimeout(()=>recognition.start, 4000);
    } else {
      console.log("Riconoscimento terminato e lasciato spento.");
    }
  };
  
  // Non avviamo più in automatico, ma aspettiamo il click dell'utente.
  // Se vuoi che parta da solo, decommenta le due righe sotto:
  recognizing = true;
  recognition.start();
  // console.log("🎤 Riconoscimento avviato...");


  function popWords(text) {
    const words = (text).split(",");
    words.forEach((w, i) => {
      setTimeout(() => popWord(w.replaceAll(/\\|"/g, '')), i * 300); // effetto scaglionato
    });
    // --- MODIFICA: RIMOSSO recognition.stop() per evitare il loop infinito
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

    setTimeout(() => {
      span.remove();
    }, 4000);
  }

  document.addEventListener('popwords', (e) => popWords(e.detail));
};

window.addEventListener('load', start);