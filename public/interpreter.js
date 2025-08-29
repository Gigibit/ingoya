const start = () => {
  const SpeechRecognition = (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SpeechRecognition || !window.audioManaged) {
    console.log("Il tuo browser non supporta SpeechRecognition, o non fu alcunché ch'io po' gestire");
    return;
  }
  const recognition = new SpeechRecognition();
  var recognizing = true
  recognition.lang = 'it-IT';
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  document.getElementById('mic-button').addEventListener('click', ()=>{
      recognizing ? recognition.stop() : recognizing.start()
      recognizing = !recognizing
    }
  )

  let finalTranscript = "";

  const onSentenceComplete = async (userMessage) => {
    console.log("🎯 Frase completa:", userMessage);

    try {
      const res = await fetch("/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: userMessage })
      });

      const text = await res.text();

      if (window.selfMode) popWords(text)

      const userMessageInterpolationEvent = new CustomEvent("usermessageinterpolation", {
        detail: {
          text: userMessage,
          interpolation: text
        }
      });
      document.dispatchEvent(userMessageInterpolationEvent)

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
        finalTranscript = ''
      } else {
        interimTranscript += transcript;
      }
    }

  };

  recognition.onerror = (event) => {
    console.error("Errore riconoscimento vocale:", event.error);
  };

  recognition.onend = () => {
    console.log("Riconoscimento terminato. Riparto automaticamente...");
    recognition.start();
  };

  recognition.start();
  console.log("🎤 Riconoscimento avviato...");

  function popWords(text) {
    const words = (text).split(",");
    words.forEach((w, i) => {
      setTimeout(() => popWord(w.replace('"', '')), i * 300); // effetto scaglionato
    });
    recognition.stop()
    setTimeout(() => recognition.start(), 4000)
  }

  function popWord(word) {
    const span = document.createElement("span");
    span.textContent = word;
    span.className = "word-pop";

    // Dimensione random gigante (tra 5vw e 12vw)
    const fontSize = Math.random() * 7 + 5;
    span.style.fontSize = fontSize + "vw";

    // Posizione random rispetto allo schermo
    const x = Math.random() * (window.innerWidth - 200);
    const y = Math.random() * (window.innerHeight - 200);
    span.style.left = `${x}px`;
    span.style.top = `${y}px`;

    document.body.appendChild(span);

    // fade-in devastante
    requestAnimationFrame(() => span.classList.add("show"));

    // fade-out dopo 2-3s
    setTimeout(() => {
      span.classList.remove("show");
      span.classList.add("fadeout");
    }, 2000 + Math.random() * 1000);

    // rimuovi dal DOM
    setTimeout(() => {
      span.remove();
    }, 4000);
  }

  document.addEventListener('popwords', (e) => popWords(e.detail))

};
window.addEventListener('load', start);
