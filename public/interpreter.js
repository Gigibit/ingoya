let pc;
const start = (stream, peerConnection) => {
  // We receive the entire camera stream, which contains the audio track we need.
  pc = peerConnection
  const localAudioStream = stream; 
  const SpeechRecognition = (window.SpeechRecognition || window.webkitSpeechRecognition);

  if (!SpeechRecognition) {
    console.error("SpeechRecognition non supportato.");
    // We remove the audioManaged check as we are now managing it directly.
    return;
  }

  const recognition = new SpeechRecognition();
  const updateBtn = document.getElementById('update-params-btn');
  const promptInput = document.getElementById('prompt');

  let isListening = false;
  let finalTranscriptDelivered = false;
  let stopTimer = null;

  // --- CONFIGURAZIONE ---
  recognition.lang = 'it-IT';
  recognition.interimResults = true;

  promptInput.addEventListener('input', () => {
    updateBtn.classList.toggle('has-text', promptInput.value.trim()!== '');
  });

  const startRecognition = () => {
    if (updateBtn.classList.contains('has-text') || isListening) return;

    // 1. Get the single audio track from the stream already captured by WebRTC.
    const audioTracks = localAudioStream.getAudioTracks();
    if (audioTracks) {
        console.log("Rilascio della traccia audio da WebRTC.");
        audioTracks.forEach(track => track.stop()); // This is the corrected line.
    }
    
    console.log("Tentativo di avvio riconoscimento sulla traccia audio esistente...");
    try {
      finalTranscriptDelivered = false;
      promptInput.value = '';
      
      // 2. **THE FIX**: Pass the specific MediaStreamTrack to the start() method.
      // This tells the API to use this track instead of trying to capture the microphone again.
      // The incorrect 'enabled = false' logic is no longer needed.
      recognition.start(); 

    } catch(e) {
      // This might fail in browsers that don't yet support this new feature.
      console.error("Errore su recognition.start(audioTrack):", e.message);
      console.error("Il tuo browser potrebbe non supportare l'uso di una MediaStreamTrack con la Web Speech API.");
    }
  };

  const stopRecognition = () => {
    if (!isListening) return;
    
    // The 'enabled = true' logic is removed as it's no longer relevant.
    console.log("Rilascio pulsante: avvio timer per arresto...");
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
        if(isListening) {
            console.log("Timer scaduto. Arresto forzato del riconoscimento.");
            recognition.stop();
        }
    }, 750); 
  };
  
  // Gestori eventi tocco e mouse (unchanged)
  updateBtn.addEventListener('mousedown', (e)=>{
    if (!updateBtn.classList.contains('has-text')) {
      e.preventDefault();
      startRecognition();
    }
  });
  updateBtn.addEventListener('touchstart', (e) => {
    if (!updateBtn.classList.contains('has-text')) {
      e.preventDefault();
      startRecognition();
    }
  });

  updateBtn.addEventListener('mouseup', stopRecognition);
  updateBtn.addEventListener('mouseleave', stopRecognition);
  updateBtn.addEventListener('touchend', stopRecognition);

  // --- Eventi dell'API SpeechRecognition (unchanged) ---
  recognition.onstart = () => {
    isListening = true;
    updateBtn.classList.add('is-recording');
    console.log("🎤 In ascolto (usando la traccia audio di WebRTC)...");
  };

 
  recognition.onend = async () => {
    isListening = false;
    updateBtn.classList.remove('is-recording');
    console.log("🛑 Ascolto terminato.");

    // Re-acquire audio for WebRTC
    console.log("Riacquisizione dell'audio per la chiamata WebRTC...");
    try {
        const newStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const newAudioTracks = newStream.getAudioTracks(); // Get the array of tracks
        
        if (newAudioTracks.length == 1) {
            const newAudioTrack = newAudioTracks[0]; // **THE FIX**: Select the first track from the array

            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
            if (sender) {
                await sender.replaceTrack(newAudioTrack); // Now we pass a single track
                console.log("Traccia audio ripristinata nella chiamata WebRTC.");
                localAudioStream = newStream; 
            } else {
                console.warn("Nessun sender audio trovato per ripristinare la traccia.");
            }
        } if (newAudioTracks.length == 1) {
            console.error("Multiple audio track, not handled for now.");
        }else {
            console.error("Impossibile riacquisire una traccia audio valida dal microfono.");
        }
    } catch (err) {
        console.error("Errore nel riacquisire l'audio per WebRTC:", err);
    }

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
      const transcript = event.results[i].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }
    
    promptInput.value = interimTranscript || finalTranscript;

    if (finalTranscript) {
        console.log(`Finale: "${finalTranscript.trim()}"`);
        promptInput.dispatchEvent(new Event('input')); 
        onSentenceComplete(finalTranscript.trim());
        finalTranscriptDelivered = true;
        if (stopTimer) clearTimeout(stopTimer);
    }
  };

  recognition.onspeechstart = () => { console.log("🗣️ Speech detected (onspeechstart)"); };
  recognition.onaudiostart = () => { console.log("🔊 Audio capture started (onaudiostart)"); };

  const onSentenceComplete = async (userMessage) => {
    if (!userMessage || finalTranscriptDelivered) return;
    finalTranscriptDelivered = true;

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

// This listener remains the same, it's the bridge between your two files.
document.addEventListener('streamAudioReady',(e)=>{
  if (e.detail.localAudioStream) {
    start(e.detail.localAudioStream, e.detail.peerConnection);
  } else {
    console.error("Evento streamAudioReady ricevuto senza uno stream valido.");
  }
});