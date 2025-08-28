
//O gioia, Ch'io non conobbi, essere amato amando!

let socket = null;
const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('sessionId');
const joinContainer = document.getElementById('join-container');
const codeInputContainer = document.getElementById('code-input');
const ___INITIAL_PROMPT_VALUE = "describe human beings.";
const ___INITIAL_NEGATIVE_PROMPT_VALUE = "blurry, low quality, flat, 2d"
const fluidCanvas = document.getElementById('fluidCanvas');
const updateBtn = document.getElementById('update-params-btn');
const promptInput = document.getElementById('prompt');
const videoElement = document.getElementById('playback-video');
const loader = document.getElementById('loader');
function initShared() {
    socket = io();
    joinContainer.style.display = 'none';
    // Tutta la logica dell'app può ora partire, sapendo che il canvas è visibile.
    socket.on('connect', () => {
        console.log(`Connesso al server. In attesa di join...`);
        socket.emit('join-session', sessionId);
    });

    socket.on('session-joined', (confirmedSessionId) => {
        console.log(`Conferma ricevuta: unito alla sessione ${confirmedSessionId}`);
        // Ora puoi inviare l'URL, ma è meglio farlo dopo aver creato lo stream
    });
 
}

function initSelf(){
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

}

// --- ✨ LOGICA JAVASCRIPT INVERTITA ---
if (sessionId || window.selfMode) {
    // Se l'ID è nell'URL, nascondi l'overlay del form di join.

    if (window.selfMode) initSelf()
    else initShared()

    const API_KEY = "sk_iK9uX4DPSmmGekB8McXnJGEKB3wWWozjtKKjUKa3WBVirYxMtXL5GLrZiTJZQ8Pb";
    const API_BASE_URL = "https://api.daydream.live";
    const PIPELINE_ID = "pip_qpUgXycjWF6YMeSL";

    let streamId = null, whipUrl = null,  peerConnection = null, canvasStream = null;

    async function handleStartPlayback(whepUrl, sessionAlreadyEstabilished = false, pollIntervall = 1500) {
        let retryId = setInterval(async () => {
            try {
                const peerConnection = new RTCPeerConnection();

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
                if (!sessionAlreadyEstabilished) {
                    clearInterval(retryId)
                    handleStartPlayback(whepUrl, true, 10000)
                }
            } catch (error) {
                console.error('Errore durante l\'avvio del playback WHEP:', error);
            }
        }, pollIntervall)
    }

    async function handleStartStream() {
        try {
            canvasStream = fluidCanvas.captureStream();
            const initPayload = {
                "name": "Stream (Streamdiffusion)",
                "pipeline_id": PIPELINE_ID,
                "pipeline_params": {
                    "model_id": "stabilityai/sd-turbo",
                    "prompt": ___INITIAL_PROMPT_VALUE,
                    "negative_prompt": ___INITIAL_NEGATIVE_PROMPT_VALUE,
                }
            };

            const createStreamResponse = await fetch(`${API_BASE_URL}/v1/streams`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(initPayload)
            });

            if (!createStreamResponse.ok) throw new Error(`API Error: ${createStreamResponse.statusText}`);
            const streamData = await createStreamResponse.json();

            streamId = streamData.id;
            whipUrl = streamData.whip_url; // Questo è l'URL di INGEST (invio)
            playbackId = streamData.output_playback_id;

            peerConnection = new RTCPeerConnection();
            canvasStream.getTracks().forEach(track => peerConnection.addTrack(track, canvasStream));
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);

            const whipResponse = await fetch(whipUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/sdp' },
                body: peerConnection.localDescription.sdp
            });

            // --- MODIFICA #2: Controlla la risposta WHIP e ottieni l'URL corretto ---
            if (whipResponse.status !== 201) { // WHIP risponde con 201 Created
                throw new Error(`Connessione WHIP fallita: ${whipResponse.status} ${whipResponse.statusText}`);
            }

            // Questo è il passaggio FONDAMENTALE. Il server ci dice dove andare.
            const locationHeader = whipResponse.headers.get('livepeer-playback-url').replace('fra-ai-mediamtx-0.livepeer.com', 'ai.livepeer.com');
            if (!locationHeader) {
                throw new Error('Header Location mancante nella risposta WHIP.');
            }
            console.log('whepUrl: ', locationHeader)
            // -----------------------------------------------------------------

            const answerSdp = await whipResponse.text();
            await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
            console.log("Connessione WHIP stabilita con successo! ✔️");

            setTimeout(() => {
                if (!window.selfMode) socket.emit('share-url', { sessionId: sessionId, url: locationHeader });
                else handleStartPlayback(locationHeader, videoElement);
            }, 1500); // Mezzo secondo di attesa dovrebbe essere sufficiente
            // --------------------------------------------------------------------

            updateBtn.disabled = false;

        } catch (error) {
            console.error('Errore durante l\'avvio dello stream:', error);
        }
    }

    async function handleUpdateParams() {
        if (!streamId) return;
        updateBtn.disabled = true;

        // Aggiungiamo il negative_prompt anche qui!
        const paramsPayload = {
            "params": {
                "prompt": promptInput.value,
                "model_id": "stabilityai/sd-turbo",
                "prompt_interpolation_method": "slerp",
                "normalize_seed_weights": true,
                "num_inference_steps": 50,
                // "controlnets": [
                //     // ... (il tuo array di controlnets rimane qui, invariato)
                //     { "conditioning_scale": 0, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-openpose-diffusers", "preprocessor": "pose_tensorrt", "preprocessor_params": {} }, 
                //     { "conditioning_scale": 0, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-hed-diffusers", "preprocessor": "soft_edge", "preprocessor_params": {} }, 
                //     { "conditioning_scale": 0, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-canny-diffusers", "preprocessor": "canny", "preprocessor_params": { "high_threshold": 200, "low_threshold": 100 } }, 
                //     { "conditioning_scale": 0, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-depth-diffusers", "preprocessor": "depth_tensorrt", "preprocessor_params": {} }, 
                //     { "conditioning_scale": 0, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-color-diffusers", "preprocessor": "passthrough", "preprocessor_params": {} }
                // ] 
            }
        };

        try {
            const response = await fetch(`${API_BASE_URL}/v1/streams/${streamId}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${API_KEY}`, 'x-client-source': 'streamdiffusion-web', 'Content-Type': 'application/json' },
                body: JSON.stringify(paramsPayload)
            });
            if (!response.ok) throw new Error(`API Update Error: ${response.statusText}`);

            // La pulizia dell'input va bene qui
            promptInput.value = '';

        } catch (error) {
            console.error('Error updating parameters:', error);
        } finally {
            updateBtn.disabled = false;
        }
    }
    window.handleUpdateParams = handleUpdateParams
    setTimeout(handleStartStream, 2000);
    updateBtn.addEventListener('click', handleUpdateParams);
    promptInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !updateBtn.disabled) {
            event.preventDefault();
            updateBtn.click();
        }
    });
} else if (!window.selfMode) {
    // Se l'ID NON è nell'URL, l'overlay #join-container è già visibile.
    // Aggiungiamo solo la logica al pulsante "Unisciti".
    const joinBtn = document.getElementById('join-btn');
    const codeInput = document.getElementById('code-input');
    joinContainer.style.display = '';
    joinContainer.style.position = 'fixed';

    joinBtn.addEventListener('click', () => {
        const code = codeInput.value.trim().toUpperCase();
        if (code.length === 6) {
            window.location.href = `${window.location.pathname}?sessionId=${code}`;
        } else {
            alert('Il codice deve essere di 6 caratteri.');
        }
    });
    codeInput.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') joinBtn.click();
    });
}

document.addEventListener('usermessageinterpolation', function(e){
    socket.emit('share-user-message', {
        sessionId,
        text: e.detail.text,
        interpolation: e.detail.interpolation
    })
    promptInput.value = e.detail.interpolation
    updateBtn.click()
})
