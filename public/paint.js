function generateSessionId(length = 6) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; // Rimosse minuscole per leggibilità
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
const videoElement = document.getElementById('playback-video');
const codeDisplay = document.getElementById('session-code-display');
const sessionId = generateSessionId();
const joinURL = `${window.location.origin}/self-drawing?sessionId=${sessionId}`;

// ✨ Mostra subito il codice generato
codeDisplay.textContent = sessionId;
console.log(`sessionId ${sessionId}`)
videoElement.addEventListener('canplay', () => {
    loader.style.display = 'none'; // nascondi spinner
});

// In alternativa: quando effettivamente inizia a suonare
videoElement.addEventListener('playing', () => {
    loader.style.display = 'none';
});

// Se vuoi gestire anche il caso in cui torna in buffering
videoElement.addEventListener('waiting', () => {
    loader.style.display = 'block';
});

new QRCode(document.getElementById('qrcode'), { text: joinURL, width: 200, height: 200 });
const socket = io();
socket.on('connect', () => socket.emit('create-session', sessionId));

socket.on('user-joined', () => {
    console.log('Partecipante connesso!');
    // ✨ Aggiunge la classe per il feedback visivo (bordo verde)
    codeDisplay.classList.add('connected');
});
socket.on('user-message-received', (message) => {
            const popWords = new CustomEvent("popwords", {
            detail: message.interpolation
    });
    document.dispatchEvent(popWords)
});
async function handleStartPlayback(whepUrl, pollIntervall = 5000) {
    setTimeout(async () => {
        try {
            const peerConnection = new RTCPeerConnection();
            handleStartPlayback(whepUrl, pollIntervall+2000)

            // Questa funzione viene chiamata quando arriva uno stream video dal server
            peerConnection.ontrack = (event) => {
                console.log("Traccia video ricevuta, la collego all'elemento video.");
                if (videoElement.srcObject !== event.streams[0]) {
                    videoElement.srcObject = event.streams[0];
                }
            };

            // WHEP richiede che il client invii un'offerta per ricevere il video
            const offer = await peerConnection.createOffer({
                offerToReceiveVideo: true // Specifichiamo che vogliamo ricevere video
            });
            await peerConnection.setLocalDescription(offer);
            // Invia l'offerta (SDP) all'endpoint WHEP
            const whepResponse = await fetch(whepUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/sdp'
                },
                body: peerConnection.localDescription.sdp
            });

            if (!whepResponse.ok) {
                throw new Error(`Connessione WHEP fallita: ${whepResponse.statusText}`);

            } //else clearInterval(retryId)
            // Ricevi la risposta (SDP) dal server e imposta la remote description
            const answerSdp = await whepResponse.text();
            // --- AGGIUNGI QUESTO LOG ---
            console.log("--- Risposta SDP ricevuta dal server WHEP ---");
            console.log(answerSdp);
            // --------------------------
            await peerConnection.setRemoteDescription({
                type: 'answer',
                sdp: answerSdp
            });

            console.log("Connessione WHEP stabilita con successo! ✨");
            
        } catch (error) {
            console.error('Errore durante l\'avvio del playback WHEP:', error);
        }
    }, pollIntervall)
}
socket.on('url-received', (url) => {
    document.body.className = 'iframe-mode';
    document.getElementById('video-container').classList.remove('hidden')
    handleStartPlayback(url)
});