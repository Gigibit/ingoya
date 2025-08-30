// --- ✨ NUOVO CODICE JAVASCRIPT (SOSTITUISCI IL VECCHIO) ---

//O gioia, Ch'io non conobbi, essere amato amando!

let socket = null;
const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('sessionId');

// Riferimenti agli elementi DOM
const joinContainer = document.getElementById('join-container');
const codeInputContainer = document.getElementById('code-input');
const fluidCanvas = document.getElementById('fluidCanvas');
const localVideoPreview = document.getElementById('local-video-preview');
const updateBtn = document.getElementById('update-params-btn');
const promptInput = document.getElementById('prompt');
const videoElement = document.getElementById('playback-video');
const loader = document.getElementById('loader');
const cameraButton = document.getElementById('camera-button');

const ___INITIAL_PROMPT_VALUE = "describe human beings.";
const ___INITIAL_NEGATIVE_PROMPT_VALUE = "blurry, low quality, flat, 2d";

function initShared() {
    socket = io();
    socket.on('connect', () => {
        console.log(`Connesso al server. In attesa di join...`);
        socket.emit('join-session', sessionId);
    });
    socket.on('session-joined', (confirmedSessionId) => {
        console.log(`Conferma ricevuta: unito alla sessione ${confirmedSessionId}`);
    });
}

function initSelf() {
    videoElement.addEventListener('canplay', () => loader.style.display = 'none');
    videoElement.addEventListener('playing', () => loader.style.display = 'none');
    videoElement.addEventListener('waiting', () => loader.style.display = 'block');
}

 
    if (sessionId) initSelf();
    initShared();

    const API_KEY = "sk_iK9uX4DPSmmGekB8McXnJGEKB3wWWozjtKKjUKa3WBVirYxMtXL5GLrZiTJZQ8Pb";
    const API_BASE_URL = "https://api.daydream.live";
    const PIPELINE_ID = "pip_qpUgXycjWF6YMeSL";

    let streamId = null;
    let peerConnection = null;
    // --- NUOVE VARIABILI DI STATO ---
    let isCameraActive = false;
    let cameraStream = null;
    // --------------------------------

    async function handleStartPlayback(whepUrl, pollInterval = 5000) {
        setTimeout(async () => {
            try {
                const playbackPeerConnection = new RTCPeerConnection();
                handleStartPlayback(whepUrl, pollInterval + 13000);

                playbackPeerConnection.ontrack = (event) => {
                    console.log("Traccia video ricevuta, la collego all'elemento video.");
                    if (videoElement.srcObject !== event.streams[0]) {
                        videoElement.srcObject = event.streams[0];
                    }
                };

                const offer = await playbackPeerConnection.createOffer({ offerToReceiveVideo: true });
                await playbackPeerConnection.setLocalDescription(offer);

                const whepResponse = await fetch(whepUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/sdp' },
                    body: playbackPeerConnection.localDescription.sdp
                });

                if (!whepResponse.ok) {
                    throw new Error(`Connessione WHEP fallita: ${whepResponse.statusText}`);
                }

                const answerSdp = await whepResponse.text();
                await playbackPeerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
                console.log("Connessione WHEP stabilita con successo! ✨");

            } catch (error) {
                console.error('Errore durante l\'avvio del playback WHEP:', error);
            }
        }, pollInterval);
    }

    async function startLivepeerStream(sourceStream) {
        if (!sourceStream) {
            console.error("Nessuna sorgente stream fornita.");
            return;
        }
        try {
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
                console.log("Vecchia connessione PeerConnection chiusa.");
            }
            console.log("Creazione di una nuova risorsa stream su Livepeer...");
            const initPayload = {
                "name": "boya-stream", "pipeline_id": PIPELINE_ID,
                "pipeline_params": {
                    "model_id": "stabilityai/sd-turbo", "prompt": ___INITIAL_PROMPT_VALUE, "negative_prompt": ___INITIAL_NEGATIVE_PROMPT_VALUE, "num_inference_steps": 50, "seed": 42, "t_index_list": [2, 4, 6], "controlnets": [{"conditioning_scale": 0.4,"control_guidance_end": 1,"control_guidance_start": 0,"enabled": true,"model_id": "thibaud/controlnet-sd21-openpose-diffusers","preprocessor": "pose_tensorrt","preprocessor_params": {}},{"conditioning_scale": 0.14,"control_guidance_end": 1,"control_guidance_start": 0,"enabled": true,"model_id": "thibaud/controlnet-sd21-hed-diffusers","preprocessor": "soft_edge","preprocessor_params": {}},{"conditioning_scale": 0.27,"control_guidance_end": 1,"control_guidance_start": 0,"enabled": true,"model_id": "thibaud/controlnet-sd21-canny-diffusers","preprocessor": "canny","preprocessor_params": {"high_threshold": 200,"low_threshold": 100}},{"conditioning_scale": 0.34,"control_guidance_end": 1,"control_guidance_start": 0,"enabled": true,"model_id": "thibaud/controlnet-sd21-depth-diffusers","preprocessor": "depth_tensorrt","preprocessor_params": {}},{"conditioning_scale": 0.66,"control_guidance_end": 1,"control_guidance_start": 0,"enabled": true,"model_id": "thibaud/controlnet-sd21-color-diffusers","preprocessor": "passthrough","preprocessor_params": {}}]
                }
            };
            const createStreamResponse = await fetch(`${API_BASE_URL}/v1/streams`, {
                method: 'POST', headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(initPayload)
            });
            if (!createStreamResponse.ok) throw new Error(`API Error: ${createStreamResponse.statusText}`);
            const streamData = await createStreamResponse.json();
            streamId = streamData.id;
            const whipUrl = streamData.whip_url;
            console.log("Avvio connessione WHIP con la nuova sorgente...");
            peerConnection = new RTCPeerConnection();
            sourceStream.getTracks().forEach(track => peerConnection.addTrack(track, sourceStream));
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            const whipResponse = await fetch(whipUrl, {
                method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: peerConnection.localDescription.sdp
            });
            if (whipResponse.status !== 201) {
                throw new Error(`Connessione WHIP fallita: ${whipResponse.status} ${whipResponse.statusText}`);
            }
            const locationHeader = whipResponse.headers.get('livepeer-playback-url')?.replace('fra-ai-mediamtx-0.livepeer.com', 'ai.livepeer.com');
            if (!locationHeader) {
                throw new Error('Header Location mancante nella risposta WHIP.');
            }
            console.log('WHEP URL ricevuto:', locationHeader);
            const answerSdp = await whipResponse.text();
            await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
            console.log("Connessione WHIP stabilita con successo! ✔️");
            setTimeout(() => {
                if (sessionId) socket.emit('share-url', { sessionId: sessionId, url: locationHeader });
                handleStartPlayback(locationHeader);
            }, 1500);
            updateBtn.disabled = false;
        } catch (error) {
            console.error('Errore durante l\'avvio dello stream:', error);
            alert("Si è verificato un errore durante la creazione dello stream. Controlla la console.");
        }
    }

    async function handleUpdateParams() {
        if (!streamId) return;
        updateBtn.disabled = true;
        const paramsPayload = { "params": { "prompt": promptInput.value } };
        try {
            const response = await fetch(`${API_BASE_URL}/v1/streams/${streamId}`, {
                method: 'PATCH', headers: { 'Authorization': `Bearer ${API_KEY}`, 'x-client-source': 'streamdiffusion-web', 'Content-Type': 'application/json' }, body: JSON.stringify(paramsPayload)
            });
            if (!response.ok) throw new Error(`API Update Error: ${response.statusText}`);
            promptInput.value = '';
        } catch (error) {
            console.error('Error updating parameters:', error);
        } finally {
            updateBtn.disabled = false;
        }
    }

    /**
     * NUOVA FUNZIONE: Alterna la sorgente video tra camera e canvas.
     */
    async function toggleVideoSource() {
        const canvasContainer = document.getElementById('canvas-container')
        if (!isCameraActive) {
            // --- Logica per ATTIVARE LA CAMERA ---
            try {
                console.log("Passaggio alla fotocamera...");
                cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
                console.log("Accesso alla fotocamera ottenuto. ✅");
                canvasContainer.style.display = 'none';
                localVideoPreview.srcObject = cameraStream;
                // Non mostriamo il video: localVideoPreview.style.display = 'block';
                await startLivepeerStream(cameraStream);
                isCameraActive = true;
            } catch (err) {
                console.error("Errore nell'accesso alla fotocamera: ", err);
                alert("Non è stato possibile accedere alla fotocamera. Assicurati di aver concesso i permessi." + err);
            }
        } else {
            // --- Logica per RITORNARE AL CANVAS ---
            console.log("Ritorno al canvas...");
            if (cameraStream) {
                // Interrompi le tracce video per spegnere la camera
                cameraStream.getTracks().forEach(track => track.stop());
                cameraStream = null;
            }
            localVideoPreview.style.display = 'none';
            canvasContainer.style.display = 'block';
            const canvasStream = fluidCanvas.captureStream();
            await startLivepeerStream(canvasStream);
            isCameraActive = false;
        }
    }

    // Avvio iniziale con il canvas
    setTimeout(() => {
        const canvasStream = fluidCanvas.captureStream();
        startLivepeerStream(canvasStream);
    }, 2000);

    // Collegamento degli eventi
    window.handleUpdateParams = handleUpdateParams;
    updateBtn.addEventListener('click', handleUpdateParams);
    cameraButton.addEventListener('click', toggleVideoSource); // Modificato qui
    promptInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !updateBtn.disabled) {
            event.preventDefault();
            handleUpdateParams();
        }
    });

// } else if (!window.selfMode) {
//     const joinBtn = document.getElementById('join-btn');
//     const codeInput = document.getElementById('code-input');
//     joinContainer.style.display = '';
//     joinContainer.style.position = 'fixed';

//     joinBtn.addEventListener('click', () => {
//         const code = codeInput.value.trim().toUpperCase();
//         if (code.length === 6) {
//             window.location.href = `${window.location.pathname}?sessionId=${code}`;
//         } else {
//             alert('Il codice deve essere di 6 caratteri.');
//         }
//     });
//     codeInput.addEventListener('keyup', (event) => {
//         if (event.key === 'Enter') joinBtn.click();
//     });
// }

document.addEventListener('usermessageinterpolation', function (e) {
    if (socket) socket.emit('share-user-message', {
        sessionId,
        text: e.detail.text,
        interpolation: e.detail.interpolation
    });
    promptInput.value = e.detail.interpolation;
    updateBtn.click();
});