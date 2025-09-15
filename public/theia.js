/**
 * Gestisce la conversazione con un'AI audio in tempo reale.
 * Riceve uno stream audio in input e notifica quando riceve lo stream di risposta.
 */
export class Theia {
    constructor() {
        this.pc = new RTCPeerConnection();
        this.outChannel = null;
        this.remoteAudioElement = null;
    }

    /**
     * Avvia la connessione WebRTC e la conversazione.
     * @param {MediaStream} inputStream - Lo stream audio del microfono dell'utente.
     */
    async startConversation(inputStream) {
        if (!inputStream) {
            throw new Error("È necessario fornire uno stream audio in input a Theia.");
        }

        try {
            console.log("📡 Theia: Richiedo sessione al backend...");
            const res = await fetch("/session", { method: "POST" });
            if (!res.ok) throw new Error("Errore creazione sessione per Theia");
            const session = await res.json();
            console.log("✅ Theia: Sessione creata:", session.id);

            inputStream.getTracks().forEach(track => this.pc.addTrack(track, inputStream));

            this.pc.ontrack = event => {
                console.log("🎤 Theia: Traccia audio di risposta ricevuta.");
                const remoteStream = event.streams[0];

                // Notifica al resto dell'applicazione che l'audio di Theia è pronto
                document.dispatchEvent(new CustomEvent('theiaAudioReady', {
                    detail: { stream: remoteStream }
                }));

                // Riproduci l'audio di Theia per l'utente locale
                this.remoteAudioElement = document.createElement("audio");
                this.remoteAudioElement.srcObject = remoteStream;
                this.remoteAudioElement.autoplay = true;
                this.remoteAudioElement.style.display = 'none';
                document.body.appendChild(this.remoteAudioElement);
            };

            this._setupDataChannel();

            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);

            const resOffer = await fetch("/offer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sdp: this.pc.localDescription.sdp })
            });

            if (!resOffer.ok) throw new Error("Errore durante l'invio dell'offerta SDP");
            const answer = await resOffer.json();
            await this.pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });

            console.log("✅ Theia: Connessione WebRTC stabilita.");

        } catch (e) {
            console.error("❌ Errore in Theia.startConversation:", e.message);
        }
    }
    
    _setupDataChannel() {
        this.outChannel = this.pc.createDataChannel("oai-events");
        
        this.outChannel.onopen = async () => {
            console.log("📤 Theia: Data channel aperto.");
            const res = await fetch("/config", { method: "GET" });
            const systemMessage = JSON.stringify(await res.json());
            this.outChannel.send(systemMessage);
        };

        this.outChannel.onmessage = ev => { /* Gestisci messaggi in arrivo */ };
        this.pc.ondatachannel = event => console.log("📥 Theia: Data channel ricevuto:", event.channel.label);
    }
    
    /**
     * Interrompe la connessione WebRTC e pulisce le risorse.
     */
    stopConversation() {
        if (this.pc) {
            this.pc.close();
            console.log("🛑 Theia: Conversazione terminata.");
        }
        if (this.remoteAudioElement) {
            this.remoteAudioElement.remove();
        }
    }
}

