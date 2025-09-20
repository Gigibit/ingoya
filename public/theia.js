/**
 * Gestisce la conversazione con un'AI audio e lo streaming del suo output video.
 */
export class Theia {
  constructor(sessionId) {
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
    this.theiaAudioSender = null;
    this.placeholderAudioElement = null;
    document.getElementById('theia-slide').setAttribute('data-session-id', this.sessionId + '_THEIA_SESSION')

  }

  /**
   * Avvia la conversazione e lo streaming video.
   * @param {MediaStream} inputStream - Lo stream audio del microfono dell'utente.
   * @param {HTMLElement} targetVideoElement - L'elemento <video> in cui mostrare lo stream di Theia.
   */
  async startConversation(inputStream, targetVideoElement) {
    if (window.theiaDoesExist) return;
    window.theiaDoesExist = true;
    if (!inputStream) throw new Error("Input stream per Theia mancante.");
    if (!targetVideoElement) throw new Error("Elemento video di destinazione per Theia mancante.");

    this.inputStream = inputStream;
    try {
      const streamSessionRes = await fetch('/stream-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId + '_THEIA_SESSION' })
      });
      if (!streamSessionRes.ok) throw new Error("Errore nel recuperare il whipUrl per Theia");
      const sessionData = await streamSessionRes.json();
      const whipUrl = sessionData.whipUrl;

      const whepUrl = await this._startLivepeerStreamWithPlaceholder(whipUrl);
      if (whepUrl) {
        this._handlePlayback(targetVideoElement, whepUrl);
      }

    } catch (e) {
      console.error("❌ Errore in Theia.startConversation:", e.message);
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

      const whepUrl = whipResponse.headers.get('livepeer-playback-url')?.replace('fra-ai-mediamtx-0.livepeer.com', 'ai.livepeer.com');
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

        this.inputStream.getTracks().forEach(track => this.conversationConnection.addTrack(track, this.inputStream));

        this.conversationConnection.ontrack = event => {
            const remoteStream = event.streams[0];
            console.log("🎤 Theia: prima traccia audio ricevuta.");

            window.theiaSoul(remoteStream);

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
    } catch(err) {
        console.error("❌ Errore in callTheia:", err);
    }
  }

  _handlePlayback(targetVideoElement, whepUrl) {
    if (!targetVideoElement || !whepUrl) return console.error("Theia Playback: argomenti invalidi.");
    //this.callTheia();

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
      if (msg.type == 'response.audio_transcript.done') {
        let transcript = msg.transcript;
        const response = await fetch('/theia-update-stream-params', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: this.sessionId + '_THEIA_SESSION', prompt: transcript })
        });
        if (!response.ok) console.error(`Errore aggiornamento parametri Theia: ${response.statusText}`);
      }
    };

    this.outChannel.onopen = async () => {
      try {
        const res = await fetch("/theia-config", { method: "GET" });
        const m = await res.json();
        this.outChannel.send(atob(m.i));
      } catch(err) {
          console.error("Errore nel setup del datachannel di Theia", err);
      }
      const userInteraction = new CustomEvent("userInteraction", {
            detail: { type: 'onExperienceStarted', isActive: !this.isConfigOverlayActive }
        });
      setTimeout(()=> document.dispatchEvent(userInteraction), 1000)
    };
    document.addEventListener('userInteraction', event =>{
        switch(event.detail.type){
          case 'onExperienceStarted':
              if(localStorage.getItem('platformExplained')) return
              localStorage.setItem('platformExplained', true)
              this.outChannel.send(JSON.stringify({
              type: "response.create",
              response: {
                conversation: "auto",
                modalities: ["audio", "text"],
                instructions: 'Dammi il benvenuto, e dimmi che questa è una magnifica piattaforma di esplorazione sociale in cui le persone sono quello che fottutamente vogliono essere, qualsiasi cosa o persona vogliano sembrare possono farlo, basta scrivere in quella input box in basso, e per iniziare ad esplorare il mondo, o fermarsi a fare due chiacchiere con te se non è online nessuno, basta scrollare questa pagina di configurazione.'
              }
            }));
            break;
          case 'onToggleConfigOverlay' :
            const instructions =  event.detail.isActive ? 
                                  "Parla in italiano. Ho cliccato il bottone per configurare il mio volto sulla base di un prompt, dimmi che sono una meraviglia." :
                                  "Parla in italiano. Augurami in maniera sintetica 'buona esplorazione', si parte!";
              
            this.outChannel.send(JSON.stringify({
              type: "response.create",
              response: {
                conversation: "auto",
                modalities: ["audio", "text"],
                instructions: instructions
              }
            }));
            break;
        }
    })
  }

  mute(){
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



