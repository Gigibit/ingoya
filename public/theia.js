import { InteractionEvent } from "./InteractionEvent.js";

/**
 * Gestisce la conversazione con un'AI audio e lo streaming del suo output video.
 */
export class Theia {
  constructor(sessionId) {
    this.config = {
      THEIA_REACTION_PROBABILITY : .05
    }
    this.sessionId = sessionId
    this.conversationConnection = new RTCPeerConnection();
    this.livepeerConnection = null;
    this.playbackConnection = null;
    this.reconnectTimeoutId = null;
    this.outChannel = null;
    this.inputStream = null;
    this.remoteAudioElement = null;
    this.audioCtx = null;
    this.currentAmplifiedStream = null;
    this.theiaVideoSender = null;
    this.theiaAudioSenders = null;
    this.placeholderAudioElement = null;
    document.getElementById('theia-slide').setAttribute('data-session-id', this.sessionId + '_THEIA')
  }

  /**
   * Avvia la conversazione e lo streaming video.
   * @param {MediaStream} inputStream - Lo stream audio del microfono dell'utente.
   * @param {HTMLElement} targetVideoElement - L'elemento <video> in cui mostrare lo stream di Theia.
   */
  async start(inputStream, targetVideoElement) {
    if (window.theiaDoesExist) return;
    window.theiaDoesExist = true;
    if (!inputStream) throw new Error("Input stream per Theia mancante.");
    if (!targetVideoElement) throw new Error("Elemento video di destinazione per Theia mancante.");

    this.inputStream = inputStream;
    try {
      const streamSessionRes = await fetch('/stream-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId + '_THEIA' })
      });
      if (!streamSessionRes.ok) throw new Error("Errore nel recuperare il whipUrl per Theia");
      const sessionData = await streamSessionRes.json();
      const whipUrl = sessionData.whipUrl;

      const whepUrl = await this._startLivepeerStreamWithPlaceholder(whipUrl);
      if (whepUrl) {
        this._handlePlayback(targetVideoElement, whepUrl);
      }

    } catch (e) {
      console.error("❌ Errore in Theia.start:", e.message);
    }
  }

  _createSpectrogramVideoStream() {
    const canvas = document.getElementById("theia-canvas");
    return canvas.captureStream();
  }

  async _startLivepeerStreamWithPlaceholder(whipUrl) {
    try {
      this.livepeerConnection = new RTCPeerConnection();
      let stream = this._createSpectrogramVideoStream();
      let streamTrack = stream.getVideoTracks()[0];
      this.theiaVideoSender = this.livepeerConnection.addTrack(streamTrack, stream);

      const offer = await this.livepeerConnection.createOffer();
      await this.livepeerConnection.setLocalDescription(offer);

      const whipResponse = await fetch(whipUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: this.livepeerConnection.localDescription.sdp
      });
      if (whipResponse.status !== 201) throw new Error(`Connessione WHIP di Theia fallita: ${whipResponse.statusText}`);

      const whepUrl = whipResponse.headers.get('livepeer-playback-url')?.replace('fra-ai-prod-livepeer-ai-gateway-0.livepeer.com', 'ai.livepeer.com');
      if (!whepUrl) throw new Error('Header livepeer-playback-url mancante per Theia.');

      const answerSdp = await whipResponse.text();
      await this.livepeerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      console.log(`✅ Theia: Stream pubblico pronto per essere visualizzato.`);
      return whepUrl;
    } catch (error) {
      console.error("❌ Errore durante lo streaming di Theia a Livepeer:", error);
      return null;
    }
  }

  async callTheia() {
    try {
      const conversationSessionRes = await fetch("/theia-session", { method: "POST" });
      if (!conversationSessionRes.ok) throw new Error("Errore creazione sessione per Theia");

      if (!this.conversationConnection || this.conversationConnection.signalingState === "closed") {
        this.conversationConnection = new RTCPeerConnection();
      }

      if (this.inputStream)
      this.theiaAudioSenders = this.inputStream.getTracks().forEach(track => this.conversationConnection.addTrack(track, this.inputStream));

      this.conversationConnection.ontrack = event => {
        const remoteStream = event.streams[0];
        console.log("🎤 Theia: prima traccia audio ricevuta.");
        if (!this.remoteAudioElement) {
          this.remoteAudioElement = document.createElement("audio");
          this.remoteAudioElement.autoplay = true;
          // --- MODIFICA: L'audio di Theia ora parte attivo per le istruzioni iniziali ---
          this.remoteAudioElement.muted = false;
          this.remoteAudioElement.style.display = 'none';
          document.body.appendChild(this.remoteAudioElement);
        }
        this.remoteAudioElement.srcObject = remoteStream;
        this.remoteAudioElement.play().catch(e => {
          console.warn("Autoplay di Theia bloccato dal browser, l'utente dovrà interagire con la pagina.", e);
        });
      };

      this._setupDataChannel();
      const offer = await this.conversationConnection.createOffer({ offerToReceiveAudio: true });
      await this.conversationConnection.setLocalDescription(offer);

      const offerRes = await fetch("/offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sdp: this.conversationConnection.localDescription.sdp })
      });
      if (!offerRes.ok) throw new Error("Errore invio offerta SDP");
      const answer = await offerRes.json();
      await this.conversationConnection.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      console.log("✅ Theia: Connessione audio con AI stabilita.");
    } catch (err) {
      console.error("❌ Errore in callTheia:", err);
    }
  }
  

  _handlePlayback(targetVideoElement, whepUrl) {
    if (!targetVideoElement || !whepUrl) return console.error("Theia Playback: argomenti invalidi.");
    if (this.reconnectTimeoutId) clearTimeout(this.reconnectTimeoutId);
    if (this.playbackConnection) this.playbackConnection.close();

    const tryToConnect = async (pollInterval) => {
      try {
        this.reconnectTimeoutId = setTimeout(() => tryToConnect(Math.min(pollInterval + 2000, 30000)), pollInterval);
        this.playbackConnection = new RTCPeerConnection();
        this.playbackConnection.ontrack = (event) => {
          if (targetVideoElement.srcObject !== event.streams[0]) {
            targetVideoElement.srcObject = event.streams[0];
          }
          if (this.reconnectTimeoutId) { clearTimeout(this.reconnectTimeoutId); this.reconnectTimeoutId = null; }
        };
        let offer = await this.playbackConnection.createOffer({ offerToReceiveVideo: true });
        await this.playbackConnection.setLocalDescription(offer);
        const whepResponse = await fetch(whepUrl, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: this.playbackConnection.localDescription.sdp });
        if (!whepResponse.ok) throw new Error(`Connessione WHEP di Theia fallita: ${whepResponse.statusText}`);
        const answerSdp = await whepResponse.text();
        await this.playbackConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      } catch (error) { console.error(`Connessione Theia Playback fallita. Riprovo tra ${pollInterval}ms`, error); }
      
    };
    tryToConnect(5000);
  }

  _setupDataChannel() {
    this.outChannel = this.conversationConnection.createDataChannel("oai-events");
    this.outChannel.onmessage = async ev => {
      const msg = JSON.parse(ev.data);
      console.log(msg)
      if (msg.type == 'response.audio_transcript.done') {
        let transcript = msg.transcript;
        const response = await fetch('/theia-update-stream-params', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: this.sessionId + '_THEIA', prompt: transcript })
        });
        if (!response.ok) console.error(`Errore aggiornamento parametri Theia: ${response.statusText}`);
      }

         // 💡 Handle custom tool call: turn_on_lights
    if (msg.type === "response.function_call_arguments.done" && msg.name === "turn_on_lights") {
      try {
        const args = JSON.parse(msg.arguments);
        console.log("💡 Turn on lights event:", args);

        // 👉 Here is where you trigger your actual IoT logic
        // For demo, just log it
        if (args.room) {
          console.log(`Turning on lights in ${args.room}`);
        } else {
          console.log("Turning on lights (no room specified)");
        }

        // ✅ Send acknowledgment back to Realtime API
        this.outChannel.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            output: "Lights turned on",
            call_id: msg.call_id
          }
        }));
      } catch (err) {
        console.error("❌ Error parsing turn_on_lights arguments:", err);
      }
    }
    };

    this.outChannel.onopen = async () => {
      try {
        const res = await fetch("/theia-config", { method: "GET" });
        const m = await res.json();
        this.outChannel.send(atob(m.i));
      } catch (err) {
        console.error("Errore nel setup del datachannel di Theia", err);
      }
      InteractionEvent.dispatchCustom('theiaReady')

    };
    document.addEventListener('userInteraction', event => {
      let instructions = null
      if(Math.random() <= this.config.THEIA_REACTION_PROBABILITY )
      switch (event.detail.type) {
        case 'onExperienceStartedAgain':
          instructions = 'Dimmi sottovoce che sei contenta di rivedermi sulla piattaforma di inGòya, massimo 20 parole'
          break;
        case 'onExperienceStarted':
          instructions = 'Dammi il benvenuto sulla piattaforma di inGòya, e sussurrami (senza fare riferimenti al sussurro) sottovoce che questa è una magnifica piattaforma di esplorazione sociale in cui le persone sono quello che fottutamente vogliono essere, qualsiasi cosa o persona vogliano sembrare possono farlo, basta scrivere in quella input box in basso, e per iniziare ad esplorare il mondo, o fermarsi a fare due chiacchiere con te se non è online nessuno, basta scrollare questa pagina di configurazione.'
          break;
        case 'onToggleConfigOverlay':
          if(!event.detail.isActive)
            instructions = "Ho cliccato il bottone per configurare il mio volto sulla base di un prompt, sussurrami (senza fare riferimenti al sussurro) che sono una meraviglia. massimo 7 parole";
          else return this.shhhh();
        case 'onPartecipantsViewOpened':
          instructions = "Ho appena cliccato su una lista di partecipanti che stanno seguendo il mio stream. dimmi sottovoce vediamo un po chi ci sta seguendo. massimo 20 parole, rapide"
          break;
        case 'onDialpadViewOpened':
          instructions = "chiedi tu a me 'chi stai chiamando' perchè sei curiosa, quello è il pulsante per chiamare altri stream. massimo 30 parole, rapide"
          break;
        case 'shh':
        default: this.shhhh()
      }
      if (instructions) this.tell(instructions)
    })
  }

  shhhh() {
    if (!this.outChannel || this.outChannel.readyState !== "open") {
      console.warn("❌ DataChannel not open, cannot send shhhh.");
      return;
    }

    // Tell the model to cancel the *currently playing / streaming* response
    this.outChannel.send(JSON.stringify({
      type: "response.cancel"
    }));

    console.log("🤫 Shhhh: interrupted current response.");
  }

  tell(instructions) {
    if (!this.outChannel || this.outChannel.readyState !== "open") {
      console.warn("❌ DataChannel not open, cannot tell her anything.");
      return;
    }
      this.outChannel.send(JSON.stringify({
        type: "response.create",
        response: {
          conversation: "auto",
          modalities: ["audio", "text"],
          instructions
        }
      }));
    
  }

  mute() {
    this.conversationConnection.close()
    if (this.remoteAudioElement) this.remoteAudioElement.remove();
    if (this.placeholderAudioElement) {
      this.placeholderAudioElement.pause();
      this.placeholderAudioElement.remove();
    }
  }

  unmute = this.callTheia

  stopConversation() {
    if (this.conversationConnection) this.conversationConnection.close();
    if (this.livepeerConnection) this.livepeerConnection.close();
    if (this.playbackConnection) this.playbackConnection.close();
    if (this.reconnectTimeoutId) clearTimeout(this.reconnectTimeoutId);
    if (this.remoteAudioElement) this.remoteAudioElement.remove();
    if (this.placeholderAudioElement) {
      this.placeholderAudioElement.pause();
      this.placeholderAudioElement.remove();
    }
    console.log("🛑 Theia: Conversazione e streaming terminati.");
  }
}



