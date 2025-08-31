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
    let touchStartY = 0;
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('sessionId') || generateSessionId();
    let isSliderViewActive = false;
    let canExplore = false;
    let isTransitioning = false; // Flag per evitare transizioni multiple

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
     * Chiede al server un nuovo stream per il precaricamento.
     */
    function preloadNextStream() {
        console.log("🔌 Richiesta per precaricamento N+1...");
        if (socket) socket.emit('request-random-stream', { sessionId });
    }
    function removeSmooth(element, duration=600) {
        // 1. Applica la classe che fa partire la dissolvenza
const start = performance.now();

    function step(timestamp) {
        let progress = (timestamp - start) / duration;
        if (progress > 1) progress = 1;

        element.style.opacity = String(1 - progress);
        element.style.transform = `scale(${1 - 0.05 * progress})`;

        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            element.remove();
        }
    }

    requestAnimationFrame(step);
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
            removeSmooth(currentSlide)
            setTimeout(()=>{
                nextSlide.style.zIndex = '1';
                preloadNextStream();
                isTransitioning = false;
            },400)
        }, { once: true });
    }

    /**
     * Crea il contenitore principale e passa alla vista dei video.
     */
    function switchToSliderView() {
        if (isSliderViewActive) return;
        isSliderViewActive = true;
        console.log("🚀 Transizione in vista principale...");

        document.body.classList.add('slider-view-active');

        // 1. Crea contenitore per gli stream
        const streamContainer = document.createElement('div');
        streamContainer.id = 'stream-container';

        // 2. Slide precaricato
        const preloadedSlide = document.getElementById('random-stream-slide');
        preloadedSlide.classList.add('is-visible');
        streamContainer.appendChild(preloadedSlide);

        // 3. Mantieni tutto il resto del body intatto, aggiungi solo lo stream container
        document.body.appendChild(streamContainer);

        // 4. Rendi playback-video un quadratino in overlay (come nelle videocall)
        originalPlaybackVideo.classList.add('mini-video');
        document.getElementById('controls-section').style.display = 'none'
        document.body.appendChild(originalPlaybackVideo);

        // 5. Avvia precaricamento prossimo video
        preloadNextStream();

        // 6. Scroll -> cambia stream
        window.addEventListener('wheel', (event) => {
            if (event.deltaY > 0) {
                transitionToNextStream();
            }
        }, { passive: false });
        window.addEventListener('touchstart', (e) => {
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: false });

        window.addEventListener('touchend', (e) => {
            const touchEndY = e.changedTouches[0].screenY;
            // Se lo swipe è verso l'alto (come uno scroll verso il basso) e di almeno 50px
            if (touchStartY - touchEndY > 50) {
                transitionToNextStream();
            }
        }, { passive: false });
    }


    function handleInitialScroll(event) {
        if (canExplore && !isSliderViewActive && event.deltaY > 0) {
            event.preventDefault();
            window.removeEventListener('wheel', handleInitialScroll, { passive: false });
            switchToSliderView();
        }
    }

    function enableExploreMode() {
        if (canExplore) return;
        console.log("🌟 Modalità esplorazione abilitata. Scorri per iniziare.");
        canExplore = true;
        window.addEventListener('wheel', handleInitialScroll, { passive: false });
        const handleInitialTouch = (e) => {
            const touchEndY = e.changedTouches[0].screenY;
            // Se lo swipe è verso l'alto e l'esplorazione è attiva
            if (canExplore && !isSliderViewActive && (touchStartY - touchEndY > 50)) {
                e.preventDefault();
                // Rimuovi i listener iniziali per evitare attivazioni multiple
                window.removeEventListener('wheel', handleInitialScroll, { passive: false });
                window.removeEventListener('touchstart', handleInitialTouchStart);
                window.removeEventListener('touchend', handleInitialTouch);
                switchToSliderView();
            }
        };

        const handleInitialTouchStart = (e) => {
            touchStartY = e.changedTouches[0].screenY;
        };

        window.addEventListener('touchstart', handleInitialTouchStart, { passive: false });
        window.addEventListener('touchend', handleInitialTouch, { passive: false });
    }

    async function handleStartPlayback(targetVideoElement, whepUrl) {
        if (!targetVideoElement || !whepUrl) {
            console.error("handleStartPlayback chiamato con argomenti non validi.");
            return;
        }
        if (targetVideoElement.reconnectTimeoutId) clearTimeout(targetVideoElement.reconnectTimeoutId);
        if (targetVideoElement.peerConnection) targetVideoElement.peerConnection.close();

        async function tryToConnect(pollInterval) {
            try {
                targetVideoElement.reconnectTimeoutId = setTimeout(() => tryToConnect(Math.min(pollInterval + 2000, 30000)), pollInterval);
                const playbackPeerConnection = new RTCPeerConnection();
                targetVideoElement.peerConnection = playbackPeerConnection;

                playbackPeerConnection.ontrack = (event) => {
                    console.log("✅ Traccia video ricevuta per", targetVideoElement.parentElement.id);
                    const loader = targetVideoElement.parentElement.querySelector('.loader');
                    if (loader) loader.style.display = 'none';
                    if (targetVideoElement.srcObject !== event.streams[0]) targetVideoElement.srcObject = event.streams[0];
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
                console.error(`Tentativo di connessione fallito per ${whepUrl}. Prossimo tentativo tra ${pollInterval}ms`);
            }
        }
        tryToConnect(5000);
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

    async function handleUpdateParams(prompt) {
        if (!streamId) return;
        updateBtn.disabled = true;
        try {
            const paramsPayload = { "params": { "prompt": prompt || promptInput.value } };
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
            console.log('Updating with', e.detail.interpolation)
            handleUpdateParams(e.detail.interpolation)
        });

        setTimeout(() => {
            cameraButton.click();
        }, 1000);
    }

    init();
});

