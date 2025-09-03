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
    let currentAudioPartnerSocketId = null; // ID del socket dell'utente con cui stiamo parlando
    let touchStartY = 0;
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('sessionId') || generateSessionId();
    let isSliderViewActive = false;
    let canExplore = false;
    let isTransitioning = false;
    let audioPeerConnection = null;
    let localAudioStream = null;

    // --- RIFERIMENTI AGLI ELEMENTI DEL DOM ---
    const originalPlaybackVideo = document.getElementById('playback-video');
    const updateBtn = document.getElementById('update-params-btn');
    const promptInput = document.getElementById('prompt');
    const cameraButton = document.getElementById('camera-button');

    // --- COSTANTI API (invariate) ---
    const API_KEY = "sk_iK9uX4DPSmmGekB8McXnJGEKB3wWWozjtKKjUKa3WBVirYxMtXL5GLrZiTJZQ8Pb";
    const API_BASE_URL = "https://api.daydream.live";
    const PIPELINE_ID = "pip_qpUgXycjWF6YMeSL";
    
    // --- VARIABILI DI STATO (invariate) ---
    let streamId = null;
    let peerConnection = null;
    let isCameraActive = false;
    let cameraStream = null;

    // --- FUNZIONI DI BASE (invariate) ---
    function preloadNextStream() {
        if (socket) socket.emit('request-random-stream', { sessionId });
    }
    
    function removeSmooth(element, duration = 600) {
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
    function switchToSliderView() {
        if (isSliderViewActive) return;
        isSliderViewActive = true;
        document.body.classList.add('slider-view-active');
        const streamContainer = document.createElement('div');
        streamContainer.id = 'stream-container';
        const preloadedSlide = document.getElementById('random-stream-slide');
        preloadedSlide.classList.add('is-visible');
        streamContainer.appendChild(preloadedSlide);
        document.body.appendChild(streamContainer);
        originalPlaybackVideo.classList.add('mini-video');
        document.getElementById('controls-section').style.display = 'none'
        document.body.appendChild(originalPlaybackVideo);
        preloadNextStream();
        window.addEventListener('wheel', (event) => { if (event.deltaY > 0) { transitionToNextStream(); } }, { passive: false });
        window.addEventListener('touchstart', (e) => { touchStartY = e.changedTouches[0].screenY; }, { passive: false });
        window.addEventListener('touchend', (e) => {
            const touchEndY = e.changedTouches[0].screenY;
            if (touchStartY - touchEndY > 50) { transitionToNextStream(); }
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
        canExplore = true;
        window.addEventListener('wheel', handleInitialScroll, { passive: false });
        const handleInitialTouch = (e) => {
            const touchEndY = e.changedTouches[0].screenY;
            if (canExplore && !isSliderViewActive && (touchStartY - touchEndY > 50)) {
                e.preventDefault();
                window.removeEventListener('wheel', handleInitialScroll, { passive: false });
                window.removeEventListener('touchstart', handleInitialTouchStart);
                window.removeEventListener('touchend', handleInitialTouch);
                switchToSliderView();
            }
        };
        const handleInitialTouchStart = (e) => { touchStartY = e.changedTouches[0].screenY; };
        window.addEventListener('touchstart', handleInitialTouchStart, { passive: false });
        window.addEventListener('touchend', handleInitialTouch, { passive: false });
    }
    async function handleStartPlayback(targetVideoElement, whepUrl) {
        if (!targetVideoElement || !whepUrl) { console.error("handleStartPlayback args invalidi."); return; }
        if (targetVideoElement.reconnectTimeoutId) clearTimeout(targetVideoElement.reconnectTimeoutId);
        if (targetVideoElement.peerConnection) targetVideoElement.peerConnection.close();
        async function tryToConnect(pollInterval) {
            try {
                targetVideoElement.reconnectTimeoutId = setTimeout(() => tryToConnect(Math.min(pollInterval + 2000, 30000)), pollInterval);
                const playbackPeerConnection = new RTCPeerConnection();
                targetVideoElement.peerConnection = playbackPeerConnection;
                playbackPeerConnection.ontrack = (event) => {
                    const loader = targetVideoElement.parentElement.querySelector('.loader');
                    if (loader) loader.style.display = 'none';
                    if (targetVideoElement.srcObject !== event.streams[0]) targetVideoElement.srcObject = event.streams[0];
                    if (targetVideoElement.id === 'playback-video') { enableExploreMode(); }
                    if (targetVideoElement.reconnectTimeoutId) { clearTimeout(targetVideoElement.reconnectTimeoutId); targetVideoElement.reconnectTimeoutId = null; }
                };
                const offer = await playbackPeerConnection.createOffer({ offerToReceiveVideo: true });
                await playbackPeerConnection.setLocalDescription(offer);
                const whepResponse = await fetch(whepUrl, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: playbackPeerConnection.localDescription.sdp });
                if (!whepResponse.ok) throw new Error(`Connessione WHEP fallita: ${whepResponse.statusText}`);
                const answerSdp = await whepResponse.text();
                await playbackPeerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
            } catch (error) { console.error(`Connessione fallita per ${whepUrl}. Riprovo tra ${pollInterval}ms`); }
        }
        tryToConnect(5000);
    }
    async function startLivepeerStream(sourceStream) {
        if (!sourceStream) return console.error("No source stream.");
        try {
            if (peerConnection) peerConnection.close();
            const initPayload = { "name": "boya-stream", "pipeline_id": PIPELINE_ID, "pipeline_params": { "model_id": "stabilityai/sd-turbo", "prompt": "describe human beings.", "negative_prompt": "blurry, low quality, flat, 2d", "num_inference_steps": 50, "seed": 42, "t_index_list": [2, 4, 6], "controlnets": [{ "conditioning_scale": 0.4, "enabled": true, "model_id": "thibaud/controlnet-sd21-openpose-diffusers", "preprocessor": "pose_tensorrt" }, { "conditioning_scale": 0.14, "enabled": true, "model_id": "thibaud/controlnet-sd21-hed-diffusers", "preprocessor": "soft_edge" }, { "conditioning_scale": 0.27, "enabled": true, "model_id": "thibaud/controlnet-sd21-canny-diffusers", "preprocessor": "canny", "preprocessor_params": { "high_threshold": 200, "low_threshold": 100 } }, { "conditioning_scale": 0.34, "enabled": true, "model_id": "thibaud/controlnet-sd21-depth-diffusers", "preprocessor": "depth_tensorrt" }, { "conditioning_scale": 0.66, "enabled": true, "model_id": "thibaud/controlnet-sd21-color-diffusers", "preprocessor": "passthrough" }] } };
            const createStreamResponse = await fetch(`${API_BASE_URL}/v1/streams`, { method: 'POST', headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(initPayload) });
            if (!createStreamResponse.ok) throw new Error(`API Error: ${createStreamResponse.statusText}`);
            const streamData = await createStreamResponse.json();
            streamId = streamData.id;
            peerConnection = new RTCPeerConnection();
            sourceStream.getTracks().forEach(track => peerConnection.addTrack(track, sourceStream));
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            const whipResponse = await fetch(streamData.whip_url, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: peerConnection.localDescription.sdp });
            if (whipResponse.status !== 201) throw new Error(`WHIP fallito: ${whipResponse.statusText}`);
            const whepUrl = whipResponse.headers.get('livepeer-playback-url')?.replace('fra-ai-mediamtx-0.livepeer.com', 'ai.livepeer.com');
            if (!whepUrl) throw new Error('Header Location mancante in WHIP.');
            const answerSdp = await whipResponse.text();
            await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
            document.dispatchEvent(new Event('streamingReady')); // Annuncia che lo stream è pronto!
            updateBtn.disabled = false;
            setTimeout(() => {
                handleStartPlayback(originalPlaybackVideo, whepUrl);
                socket.emit('share-url', { sessionId: sessionId, url: whepUrl }, () => {
                    preloadNextStream();
                });
            }, 1500);
        } catch (error) { console.error('Errore avvio stream:', error); }
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

    // --- NUOVE FUNZIONI PER CHIAMATA AUDIO DINAMICA ---
    
    function hangUp() {
        if (audioPeerConnection) {
            console.log("📞 Riaggancio la chiamata con", currentAudioPartnerSocketId);
            if (socket && currentAudioPartnerSocketId) {
                socket.emit('hang-up', { targetSocketId: currentAudioPartnerSocketId });
            }
            audioPeerConnection.close();
            audioPeerConnection = null;
        }
        const remoteAudioEl = document.getElementById('remote-audio');
        if (remoteAudioEl) {
            remoteAudioEl.remove();
        }
        currentAudioPartnerSocketId = null;
    }

    function transitionToNextStream() {
        hangUp(); // <-- PRIMA AZIONE: chiudi la chiamata corrente
        if (isTransitioning) return;
        isTransitioning = true;
        
        const currentSlide = document.querySelector('.slide.is-visible');
        const nextSlide = document.querySelector('.slide:not(.is-visible)');

        if (!currentSlide || !nextSlide || !nextSlide.querySelector('video')?.srcObject) {
            console.warn("Transizione annullata: video non pronto.");
            isTransitioning = false;
            return;
        }

        nextSlide.style.zIndex = '2';
        nextSlide.classList.add('is-visible');

        nextSlide.addEventListener('transitionend', () => {
            removeSmooth(currentSlide);
            setTimeout(() => {
                nextSlide.style.zIndex = '1';
                preloadNextStream();
                isTransitioning = false;
            }, 400);
        }, { once: true });
    }

    function setupAudioPeerConnection() {
        if (audioPeerConnection) {
            audioPeerConnection.close();
        }
        const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        audioPeerConnection = new RTCPeerConnection(configuration);

        localAudioStream.getTracks().forEach(track => {
            audioPeerConnection.addTrack(track, localAudioStream);
        });

        audioPeerConnection.ontrack = (event) => {
            console.log('🎤 Traccia audio remota ricevuta!');
            let remoteAudioEl = document.getElementById('remote-audio');
            if (!remoteAudioEl) {
                remoteAudioEl = document.createElement('audio');
                remoteAudioEl.id = 'remote-audio';
                remoteAudioEl.controls = true;
                remoteAudioEl.autoplay = true;
                document.body.appendChild(remoteAudioEl);
            }
            if (remoteAudioEl.srcObject !== event.streams[0]) {
                remoteAudioEl.srcObject = event.streams[0];
            }
        };
        
        audioPeerConnection.onicecandidate = (event) => {
            if (event.candidate && currentAudioPartnerSocketId) {
                console.log(`✉️ Invio candidato ICE a ${currentAudioPartnerSocketId}`);
                socket.emit('audio-ice-candidate', {
                    candidate: event.candidate,
                    targetSocketId: currentAudioPartnerSocketId
                });
            }
        };
    }

    async function toggleVideoSource() {
        const canvasContainer = document.getElementById('canvas-container');
        cameraButton.classList.toggle('camera-enabled');
        isCameraActive = !isCameraActive;

        if (isCameraActive) {
            try {
                cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                localAudioStream = new MediaStream(cameraStream.getAudioTracks());
                if (canvasContainer) canvasContainer.style.display = 'none';
                document.getElementById('local-video-preview').srcObject = cameraStream;
                await startLivepeerStream(cameraStream);
            } catch (err) { console.error("Accesso camera/microfono fallito:", err); }
        } else {
            if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
            document.getElementById('local-video-preview').srcObject = null;
            if (canvasContainer) canvasContainer.style.display = 'block';
            const fluidCanvas = document.getElementById('fluidCanvas');
            const canvasStream = fluidCanvas.captureStream();
            await startLivepeerStream(canvasStream);
        }
    }

    // --- INIZIALIZZAZIONE E GESTIONE SOCKET ---
    function init() {
        const preloadedVideoElement = document.querySelector('#random-stream-slide .playback-video');
        if (!preloadedVideoElement) {
            return console.error("FATAL: Elemento #random-stream-slide non trovato.");
        }
        socket = io();

        socket.on('connect', () => {
            console.log(`Connesso con socket ID: ${socket.id}. Sessione: ${sessionId}`);
            const newUrl = `${window.location.pathname}?sessionId=${sessionId}`;
            window.history.replaceState({ path: newUrl }, '', newUrl);
            socket.emit('join-session', sessionId);
        });

        // FLUSSO DI CHIAMATA DINAMICA
        socket.on('random-stream-received', ({ sessionId: streamerSessionId, url }) => {
            console.log(`🎥 Stream ricevuto dalla sessione ${streamerSessionId}.`);
            hangUp(); 

            const streamContainer = document.getElementById('stream-container');
            if (isSliderViewActive && streamContainer) {
                const newSlide = document.createElement('div');
                newSlide.className = 'slide';
                newSlide.innerHTML = `<video class="playback-video" autoplay playsinline muted></video><div class="loader"></div>`;
                streamContainer.appendChild(newSlide);
                handleStartPlayback(newSlide.querySelector('video'), url);
            } else {
                handleStartPlayback(preloadedVideoElement, url);
            }
            
            if (localAudioStream) {
                console.log(`➡️ Invio richiesta di chiamata alla sessione ${streamerSessionId}`);
                socket.emit('request-audio-call', { streamerSessionId });
            }
        });

        socket.on('audio-request-received', async ({ visitorSocketId }) => {
            console.log(`📥 Ricevuta richiesta di chiamata da ${visitorSocketId}`);
            hangUp();
            currentAudioPartnerSocketId = visitorSocketId;
            
            setupAudioPeerConnection();
            const offer = await audioPeerConnection.createOffer();
            await audioPeerConnection.setLocalDescription(offer);
            
            console.log(`📤 Invio offerta a ${visitorSocketId}`);
            socket.emit('audio-offer', { offer, targetSocketId: visitorSocketId });
        });

        socket.on('audio-offer', async ({ offer, streamerSocketId }) => {
            if (!localAudioStream) return;
            console.log(`📥 Offerta ricevuta da ${streamerSocketId}`);
            currentAudioPartnerSocketId = streamerSocketId;

            setupAudioPeerConnection();
            await audioPeerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await audioPeerConnection.createAnswer();
            await audioPeerConnection.setLocalDescription(answer);

            console.log(`📤 Invio risposta a ${streamerSocketId}`);
            socket.emit('audio-answer', { answer, targetSocketId: streamerSocketId });
        });

        socket.on('audio-answer', async (answer) => {
            console.log('✅ Risposta ricevuta.');
            if (audioPeerConnection && !audioPeerConnection.currentRemoteDescription) {
                await audioPeerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            }
        });
        
        socket.on('audio-ice-candidate', async (candidate) => {
             if (audioPeerConnection && candidate) {
                try {
                    await audioPeerConnection.addIceCandidate(candidate);
                } catch (e) {
                    console.error('Errore aggiunta candidato ICE:', e);
                }
            }
        });

        socket.on('hang-up', () => {
            console.log("L'altro utente ha terminato la chiamata.");
            hangUp();
        });

        // Gestione eventi non legati alla chiamata
        socket.on('no-random-stream-found', () => { 
            console.log("Nessun altro stream trovato dal server.");
        });

        originalPlaybackVideo.addEventListener('canplay', () => document.getElementById('loader').style.display = 'none');
        originalPlaybackVideo.addEventListener('playing', () => document.getElementById('loader').style.display = 'none');
        originalPlaybackVideo.addEventListener('waiting', () => document.getElementById('loader').style.display = 'block');

        updateBtn.addEventListener('click', () => handleUpdateParams());
        
        promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !updateBtn.disabled) {
                e.preventDefault();
                handleUpdateParams();
            }
        });

        document.addEventListener('usermessageinterpolation', (e) => {
            if (socket) {
                socket.emit('share-user-message', { sessionId, text: e.detail.text, interpolation: e.detail.interpolation });
            }
            console.log('Updating with', e.detail.interpolation);
            handleUpdateParams(e.detail.interpolation);
        });

        cameraButton.addEventListener('click', toggleVideoSource);

        setTimeout(() => {
            cameraButton.click();
        }, 1000);
    }

    init();
});

