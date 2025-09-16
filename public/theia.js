import { TheiaSoul } from "./theia.soul.js";

/**
 * Gestisce la conversazione con un'AI audio e lo streaming del suo output video.
 */
export class Theia {
  constructor() {
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
    this.soul = new TheiaSoul(); // Crea un'istanza del visualizer
    this.placeholderAudioElement = null; // Aggiunto per tracciare l'elemento audio del placeholder
  }

  /**
   * Avvia la conversazione e lo streaming video.
   * @param {MediaStream} inputStream - Lo stream audio del microfono dell'utente.
   * @param {HTMLElement} targetVideoElement - L'elemento <video> in cui mostrare lo stream di Theia.
   */
  async startConversation(inputStream, targetVideoElement) {
    if (window.theiaDoesExist) return
    window.theiaDoesExist = true

    if (!inputStream) throw new Error("Input stream per Theia mancante.");
    if (!targetVideoElement) throw new Error("Elemento video di destinazione per Theia mancante.");

    this.inputStream = inputStream
    try {
      // FASE 1: Ottieni un WHIP URL per lo stream video di Theia
      const streamSessionRes = await fetch('/stream-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'THEIA_SESSION' })
      });
      if (!streamSessionRes.ok) throw new Error("Errore nel recuperare il whipUrl per Theia");
      const sessionData = await streamSessionRes.json();
      const whipUrl = sessionData.whipUrl;

      // FASE 1.5: Avvia lo streaming verso Livepeer e ottieni il WHEP URL
      const whepUrl = await this._startLivepeerStreamWithPlaceholder(whipUrl);
      if (whepUrl) {
        // FASE 1.6: Avvia il polling per il playback del video di Theia
        this._handlePlayback(targetVideoElement, whepUrl);
      }

    } catch (e) {
      console.error("❌ Errore in Theia.startConversation:", e.message);
    }
  }

  /**
   * NUOVO METODO: Genera uno stream audio da un file .wav in loop in modo robusto.
   * @returns {Promise<MediaStream>} Lo stream audio generato.
   */

  _createSpectrogramVideoStream(audioStream) {
    const canvas = document.getElementById("theia-canvas");
    return canvas.captureStream(30);
  }


  async _startLivepeerStreamWithPlaceholder(whipUrl) {
    try {
      this.livepeerConnection = new RTCPeerConnection();
      let stream = this._createSpectrogramVideoStream()
      let streamTrack = stream.getTracks()[0]
      this.theiaVideoSender = this.livepeerConnection.addTrack(streamTrack, stream);

      // Rimuovi subito la traccia video se vuoi solo audio


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

  _createBeepAudioStream(frequency = 440, duration = 0.1) {
    // 1. Crea un AudioContext
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // 2. Crea un OscillatorNode (onda sinusoidale)
    let oscillator = audioCtx.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);

    // 3. Crea un GainNode per controllare il volume
    const gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime); // volume basso

    // 4. Collega oscillator -> gain -> MediaStreamDestination
    const dest = audioCtx.createMediaStreamDestination();
    oscillator.connect(gainNode);
    gainNode.connect(dest);

    // 5. Configura il beep loop: on/off per il tempo “duration”
    function startBeepLoop() {
      oscillator.start();
      setTimeout(() => {
        oscillator.stop();
        // ricrea oscillator per nuovo ciclo
        const newOsc = audioCtx.createOscillator();
        newOsc.type = "sine";
        newOsc.frequency.value = frequency;
        newOsc.connect(gainNode);
        oscillator = newOsc;
        startBeepLoop();
      }, duration * 1000);
    }
    startBeepLoop();

    // 6. Restituisci lo stream
    return dest.stream;
  }
  _createSineAudioStream(frequency = 440) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = frequency;

    const gain = audioCtx.createGain();
    gain.gain.value = 1.0; // volume forte

    osc.connect(gain);
    const dest = audioCtx.createMediaStreamDestination();
    gain.connect(dest);

    osc.start();
    return dest.stream;
  }
  _handlePlayback(targetVideoElement, whepUrl) {
    if (!targetVideoElement || !whepUrl) return console.error("Theia Playback: argomenti invalidi.");

    if (this.reconnectTimeoutId) clearTimeout(this.reconnectTimeoutId);
    if (this.playbackConnection) this.playbackConnection.close();

    const tryToConnect = async (pollInterval) => {
      try {
        window.theiaSoul(this._createBeepAudioStream())
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

        /// SEZIONE AI TALK
        const conversationSessionRes = await fetch("/session", { method: "POST" });
        if (!conversationSessionRes.ok) throw new Error("Errore creazione sessione per Theia");
        if (!this.conversationConnection || this.conversationConnection.signalingState === "closed") {
          this.conversationConnection = new RTCPeerConnection();
        }
        this.inputStream.getTracks().forEach(track => this.conversationConnection.addTrack(track, this.inputStream));


            this.conversationConnection.ontrack = event => {
                const remoteStream = event.streams[0]; // Questo è l'audio di Theia
                console.log("🎤 Theia: prima traccia ricevuta.");

                window.theiaSoul(remoteStream);

                this.remoteAudioElement = document.createElement("audio");
                this.remoteAudioElement.srcObject = remoteStream;
                this.remoteAudioElement.autoplay = true;
                this.remoteAudioElement.style.display = 'none';
                document.body.appendChild(this.remoteAudioElement);
            };

        this._setupDataChannel();
        offer = await this.conversationConnection.createOffer();
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
        // --- FINE BLOCCO DISABILITATO ---


      } catch (error) { console.error(`Connessione Theia Playback fallita. Riprovo tra ${pollInterval}ms`, error); }
    };
    tryToConnect(5000);
  }

  _setupDataChannel() {
    this.outChannel = this.conversationConnection.createDataChannel("oai-events");
    this.outChannel.onopen = async () => {
      const res = await fetch("/config", { method: "GET" });
      this.outChannel.send(JSON.stringify(await res.json()));
    };
  }

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
