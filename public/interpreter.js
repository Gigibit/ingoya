const start = () => {
  const SpeechRecognition = (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SpeechRecognition || !window.audioManaged) {
    console.log("❌ Il tuo browser non supporta SpeechRecognition, o non ci sono le condizioni per gestirlo.");
    return;
  }

  const recognition = new SpeechRecognition();

  // --- Stati ---
  let recognizing = false;    // volontà dell’utente
  let isRecognizing = false;  // stato reale
  let finalTranscript = "";

  // --- Config ---
  recognition.lang = 'it-IT';
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  // --- Pulsante microfono ---
  const micButton = document.getElementById('mic-button');
  if (micButton) {
    micButton.addEventListener('click', () => {
      if (recognizing) {
        recognizing = false;
        recognition.stop();
        console.log("🛑 Riconoscimento fermato manualmente.");
      } else {
        recognizing = true;
        if (!isRecognizing) {
          recognition.start();
          console.log("🎤 Riconoscimento avviato manualmente.");
        }
      }
    });
  }

  // --- Gestione risultati ---
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

  // --- Eventi di stato ---
  recognition.onstart = () => {
    isRecognizing = true;
    console.log("▶️ Riconoscimento attivo...");
  };

  recognition.onend = () => {
    isRecognizing = false;
    if (recognizing) {
      console.log("⏳ Riconoscimento terminato. Riavvio fra 2s...");
      setTimeout(() => {
        if (recognizing && !isRecognizing) {
          try {
            recognition.start();
          } catch (err) {
            console.warn("⚠️ Errore restart recognition:", err);
          }
        }
      }, 2000);
    } else {
      console.log("🛑 Riconoscimento fermato definitivamente.");
    }
  };

  recognition.onerror = (event) => {
    console.error("❌ Errore riconoscimento vocale:", event.error);
  };

  // --- Azione su frase completa ---
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
        detail: { text: userMessage, interpolation: text }
      });
      document.dispatchEvent(userMessageInterpolationEvent);

    } catch (err) {
      console.log("❌ Errore fetch /interpret:", err);
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

  // --- Event listener custom ---
  document.addEventListener('popwords', (e) => popWords(e.detail));

  // Se vuoi partire subito in auto-ascolto:
  recognizing = true;
  recognition.start();
};

window.addEventListener('load', start);
