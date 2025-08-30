// o gioia, ch'io conobbi, esser amato amando!
window.addEventListener('DOMContentLoaded', () => {
    function generateSessionId(length = 6) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    // --- VARIABILI GLOBALI ---
    let socket = null;
    const TEST = true
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('sessionId') || generateSessionId();
    let isSliderViewActive = false;
    let canExplore = false;
    let isTransitioning = false; // Flag per evitare transizioni multiple
    const pollIntervals = new Map(); // Mappa per gli intervalli di polling [url -> intervallo]
    const BASE_POLL_INTERVAL = 5000;
    const MAX_POLL_INTERVAL = 30000;


    // --- RIFERIMENTI AGLI ELEMENTI DEL DOM ---
    const originalPlaybackVideo = document.getElementById('playback-video');
    const updateBtn = document.getElementById('update-params-btn');
    const promptInput = document.getElementById('prompt');
    const cameraButton = document.getElementById('camera-button');

    // --- COSTANTI API ---
    const ___INITIAL_PROMPT_VALUE = "describe human beings.";
    const ___INITIAL_NEGATIVE_PROMPT_VALUE = "blurry, low quality, flat, 2d";
    const API_KEY = "sk_iK9uX4DPSmmGekB8McXnJGEKB3wWWozjtKKjUKa3WBVirYxMtXL5GLrZiTJZQ8Pb";
    const API_BASE_URL = "https://api.daydream.live";
    const PIPELINE_ID = "pip_qpUgXycjWF6YMeSL";

    // --- VARIABILI DI STATO ---
    let streamId = null;
    let peerConnection = null;
    let isCameraActive = false;
    let cameraStream = null;

    // --- FUNZIONI PRINCIPALI ---

    /**
     * Inietta gli stili CSS necessari per la nuova transizione in dissolvenza.
     */
    function injectTransitionStyles() {
        const style = document.createElement('style');
        style.textContent = `
            body.slider-view-active {
                display: block; /* <-- CORREZIONE: Risolve il conflitto di layout */
                padding: 0;
                overflow: hidden;
                background-color: #000;
            }
            #stream-container {
                position: fixed;
                top: 0; left: 0;
                width: 100vw;
                height: 100vh;
            }
            .slide {
                position: absolute;
                top: 0; left: 0;
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                background-color: #000;
                opacity: 0;
                transition: opacity 0.7s ease-in-out;
                pointer-events: none;
            }
            .slide.is-visible {
                opacity: 1;
                pointer-events: auto;
                z-index: 1;
            }
            .slide .playback-video {
                width: 100%;
                height: 100%;
                object-fit: contain;
            }
            .slide .loader {
                position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                background-color: rgba(0, 0, 0, 0.7); display: flex; flex-direction: column;
                justify-content: center; align-items: center; color: white; z-index: 10;
            }
            .slide .loader .spinner {
                border: 4px solid rgba(255, 255, 255, 0.3); border-radius: 50%;
                border-top: 4px solid #fff; width: 40px; height: 40px;
                animation: spin 1s linear infinite; margin-bottom: 10px;
            }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        `;
        document.head.appendChild(style);
    }

    /**
     * Chiede al server un nuovo stream per il precaricamento.
     */
    function preloadNextStream() {
        console.log("🔌 Richiesta per precaricamento N+1...");
        if (socket) socket.emit('request-random-stream', { sessionId });
    }
    
    /**
     * Gestisce la transizione al video successivo.
     */
    function transitionToNextStream() {
        if (isTransitioning) return;

        const currentSlide = document.querySelector('.slide.is-visible');
        const nextSlide = document.querySelector('.slide:not(.is-visible)');

        if (!currentSlide || !nextSlide || !nextSlide.querySelector('video')?.srcObject) {
            console.warn("Transizione annullata: il prossimo video non è ancora pronto.");
            return;
        }

        isTransitioning = true;
        console.log("🎬 Avvio dissolvenza...");

        nextSlide.style.zIndex = '2';
        nextSlide.classList.add('is-visible');

        nextSlide.addEventListener('transitionend', () => {
            currentSlide.remove();
            nextSlide.style.zIndex = '1';
            preloadNextStream();
            isTransitioning = false;
        }, { once: true });
    }

    /**
     * Crea il contenitore principale e passa alla vista dei video.
     */
    function switchToSliderView() {
        if (isSliderViewActive) return;
        isSliderViewActive = true;
        console.log("🚀 Transizione in vista principale...");

        // 1. Applica la classe al body per attivare i nuovi stili
        document.body.classList.add('slider-view-active');
        
        // 2. Prepara il nuovo contenitore
        const streamContainer = document.createElement('div');
        streamContainer.id = 'stream-container';

        // 3. Prendi lo slide GIÀ precaricato e rendilo visibile
        const preloadedSlide = document.getElementById('random-stream-slide');
        preloadedSlide.classList.add('is-visible');
        streamContainer.appendChild(preloadedSlide);

        // 4. Sostituisci il contenuto del body con il nuovo contenitore
        document.body.innerHTML = '';
        document.body.appendChild(streamContainer);

        // 5. Avvia il precaricamento del prossimo video (N+1)
        preloadNextStream();

        // 6. Abilita lo scroll per le transizioni future
        console.log("✅ Transizione iniziale completata. Scroll per i prossimi video abilitato.");
        window.addEventListener('wheel', (event) => {
            if (event.deltaY > 0) {
                transitionToNextStream();
            }
        }, { passive: false });
    }

    function handleInitialScroll(event) {
        if (canExplore && !isSliderViewActive && event.deltaY > 0) {
            event.preventDefault();
            window.removeEventListener('wheel', handleInitialScroll, { passive : false });
            switchToSliderView();
        }
    }

    function enableExploreMode() {
        if (canExplore) return;
        console.log("🌟 Modalità esplorazione abilitata. Scorri per iniziare.");
        canExplore = true;
        window.addEventListener('wheel', handleInitialScroll, { passive : false });
    }

    /**
     * MODIFICATO: Gestisce la connessione WHEP e la logica di polling usando una Map.
     * @param {HTMLElement} targetVideoElement L'elemento video a cui collegare lo stream.
     * @param {string} whepUrl L'URL del WHEP endpoint.
     */
    async function handleStartPlayback(targetVideoElement, whepUrl) {
        if (!targetVideoElement || !whepUrl) {
            console.error("handleStartPlayback chiamato con argomenti non validi.");
            return;
        }
        if (targetVideoElement.reconnectTimeoutId) clearTimeout(targetVideoElement.reconnectTimeoutId);
        if (targetVideoElement.peerConnection) targetVideoElement.peerConnection.close();

        // Inizializza l'intervallo per questo URL se non esiste
        if (!pollIntervals.has(whepUrl)) {
            pollIntervals.set(whepUrl, BASE_POLL_INTERVAL);
        }

        async function tryToConnect() {
            try {
                const currentInterval = pollIntervals.get(whepUrl);

                // Pianifica il prossimo tentativo di riconnessione
                targetVideoElement.reconnectTimeoutId = setTimeout(() => {
                    // Calcola e imposta il prossimo intervallo prima della chiamata ricorsiva
                    const nextInterval = Math.min(currentInterval + 2000, MAX_POLL_INTERVAL);
                    pollIntervals.set(whepUrl, nextInterval);
                    tryToConnect();
                }, currentInterval);
                
                const playbackPeerConnection = new RTCPeerConnection();
                targetVideoElement.peerConnection = playbackPeerConnection;

                playbackPeerConnection.ontrack = (event) => {
                    console.log("✅ Traccia video ricevuta per", targetVideoElement.parentElement.id);
                    const loader = targetVideoElement.parentElement.querySelector('.loader');
                    if (loader) loader.style.display = 'none';
                    if (targetVideoElement.srcObject !== event.streams[0]) targetVideoElement.srcObject = event.streams[0];
                    
                    // Resetta l'intervallo di polling per questo URL in caso di successo
                    pollIntervals.set(whepUrl, BASE_POLL_INTERVAL);
                    
                    if (targetVideoElement.id === 'playback-video') {
                        enableExploreMode();
                    }
                    if (targetVideoElement.reconnectTimeoutId) {
                        clearTimeout(targetVideoElement.reconnectTimeoutId);
                        targetVideoElement.reconnectTimeoutId = null;
                    }
                };

                const offer = await playbackPeerConnection.createOffer({ offerToReceiveVideo: true });
                await playbackPeerConnection.setLocalDescription(offer);
                const whepResponse = await fetch(whepUrl, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: playbackPeerConnection.localDescription.sdp });
                if (!whepResponse.ok) throw new Error(`Connessione WHEP fallita: ${whepResponse.statusText}`);
                const answerSdp = await whepResponse.text();
                await playbackPeerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });

            } catch (error) {
                const currentInterval = pollIntervals.get(whepUrl);
                console.error(`Tentativo di connessione fallito per ${whepUrl}. Prossimo tentativo tra ${currentInterval || BASE_POLL_INTERVAL}ms`);
            }
        }
        tryToConnect();
    }

    async function startLivepeerStream(sourceStream) {
        if (!sourceStream) return console.error("Nessuna sorgente stream fornita.");
        try {
            if (peerConnection) peerConnection.close();
            console.log("Creazione di una nuova risorsa stream su Livepeer...");
            const initPayload = { "name": "boya-stream", "pipeline_id": PIPELINE_ID, "pipeline_params": { "model_id": "stabilityai/sd-turbo", "prompt": ___INITIAL_PROMPT_VALUE, "negative_prompt": ___INITIAL_NEGATIVE_PROMPT_VALUE, "num_inference_steps": 50, "seed": 42, "t_index_list": [2, 4, 6], "controlnets": [{ "conditioning_scale": 0.4, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-openpose-diffusers", "preprocessor": "pose_tensorrt", "preprocessor_params": {} }, { "conditioning_scale": 0.14, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-hed-diffusers", "preprocessor": "soft_edge", "preprocessor_params": {} }, { "conditioning_scale": 0.27, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-canny-diffusers", "preprocessor": "canny", "preprocessor_params": { "high_threshold": 200, "low_threshold": 100 } }, { "conditioning_scale": 0.34, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-depth-diffusers", "preprocessor": "depth_tensorrt", "preprocessor_params": {} }, { "conditioning_scale": 0.66, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-color-diffusers", "preprocessor": "passthrough", "preprocessor_params": {} }] } };
            const createStreamResponse = await fetch(`${API_BASE_URL}/v1/streams`, { method: 'POST', headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(initPayload) });
            if (!createStreamResponse.ok) throw new Error(`API Error: ${createStreamResponse.statusText}`);
            const streamData = await createStreamResponse.json();
            streamId = streamData.id;
            peerConnection = new RTCPeerConnection();
            sourceStream.getTracks().forEach(track => peerConnection.addTrack(track, sourceStream));
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            const whipResponse = await fetch(streamData.whip_url, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: peerConnection.localDescription.sdp });
            if (whipResponse.status !== 201) throw new Error(`Connessione WHIP fallita: ${whipResponse.status} ${whipResponse.statusText}`);
            const whepUrl = whipResponse.headers.get('livepeer-playback-url')?.replace('fra-ai-mediamtx-0.livepeer.com', 'ai.livepeer.com');
            if (!whepUrl) throw new Error('Header Location mancante nella risposta WHIP.');
            const answerSdp = await whipResponse.text();
            await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
            console.log(`Connessione WHIP stabilita con successo! ✔️ ${whepUrl}`);
            setTimeout(() => {
                handleStartPlayback(originalPlaybackVideo, whepUrl);
                
                socket.emit('share-url', { sessionId: sessionId, url: whepUrl }, () => {
                    console.log('✅ Server ha confermato URL. Avvio precaricamento primo stream.');
                    preloadNextStream();
                });
            }, 1500);
            updateBtn.disabled = false;
        } catch (error) {
            console.error('Errore durante l\'avvio dello stream:', error);
        }
    }

    async function handleUpdateParams() {
        if (!streamId) return;
        updateBtn.disabled = true;
        try {
            const paramsPayload = { "params": { "prompt": promptInput.value } };
            const response = await fetch(`${API_BASE_URL}/v1/streams/${streamId}`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${API_KEY}`, 'x-client-source': 'streamdiffusion-web', 'Content-Type': 'application/json' }, body: JSON.stringify(paramsPayload) });
            if (!response.ok) throw new Error(`API Update Error: ${response.statusText}`);
            promptInput.value = '';
        } catch (error) { console.error('Error updating parameters:', error); }
        finally { updateBtn.disabled = false; }
    }

    async function toggleVideoSource() {
        const canvasContainer = document.getElementById('canvas-container');
        cameraButton.classList.toggle('camera-enabled');
        isCameraActive = !isCameraActive;

        if (isCameraActive) {
            try {
                cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
                if (canvasContainer) canvasContainer.style.display = 'none';
                document.getElementById('local-video-preview').srcObject = cameraStream;
                await startLivepeerStream(cameraStream);
            } catch (err) { console.error("Accesso alla camera fallito:", err); }
        } else {
            if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
            document.getElementById('local-video-preview').srcObject = null;
            if (canvasContainer) canvasContainer.style.display = 'block';
            const fluidCanvas = document.getElementById('fluidCanvas');
            const canvasStream = fluidCanvas.captureStream();
            await startLivepeerStream(canvasStream);
        }
    }

    // --- INIZIALIZZAZIONE ---
    function init() {
        injectTransitionStyles(); // Aggiunge i nuovi stili per la dissolvenza

        const preloadedVideoElement = document.querySelector('#random-stream-slide .playback-video');
        if (!preloadedVideoElement) {
            return console.error("FATAL: L'elemento #random-stream-slide non è stato trovato nell'HTML.");
        }

        socket = io();

        socket.on('connect', () => {
            console.log(`Connesso con socket ID: ${socket.id}. Sessione: ${sessionId}`);
            const newUrl = `${window.location.pathname}?sessionId=${sessionId}`;
            window.history.replaceState({ path: newUrl }, '', newUrl);
            socket.emit('join-session', sessionId);
        });
       
        socket.on('random-stream-received', ({ url }) => {
            console.log(`🎥 URL ricevuto: ${url}`);
            const streamContainer = document.getElementById('stream-container');

            if (isSliderViewActive && streamContainer) {
                const newSlide = document.createElement('div');
                newSlide.className = 'slide';
                newSlide.innerHTML = `<video class="playback-video" autoplay playsinline muted></video><div class="loader"><div class="spinner"></div><p>Caricamento...</p></div>`;
                streamContainer.appendChild(newSlide);
                handleStartPlayback(newSlide.querySelector('video'), url);
            } else {
                handleStartPlayback(preloadedVideoElement, url);
            }
        });

        socket.on('no-random-stream-found', () => {
            console.log("Nessun altro stream trovato dal server.");
        });

        originalPlaybackVideo.addEventListener('canplay', () => document.getElementById('loader').style.display = 'none');
        originalPlaybackVideo.addEventListener('playing', () => document.getElementById('loader').style.display = 'none');
        originalPlaybackVideo.addEventListener('waiting', () => document.getElementById('loader').style.display = 'block');
        updateBtn.addEventListener('click', handleUpdateParams);
        cameraButton.addEventListener('click', toggleVideoSource);
        promptInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !updateBtn.disabled) { e.preventDefault(); handleUpdateParams(); } });

        document.addEventListener('usermessageinterpolation', (e) => {
            if (socket) socket.emit('share-user-message', { sessionId, text: e.detail.text, interpolation: e.detail.interpolation });
            promptInput.value = e.detail.interpolation;
            updateBtn.click();
        });

        setTimeout(() => {
            cameraButton.click();
        }, 1000);
    }

    init();
});

