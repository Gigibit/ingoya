// o gioia, ch'io conobbi, esser amato amando!
window.addEventListener('DOMContentLoaded', () => {
    let socket = null;
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('sessionId');
    let isSliderViewActive = false;
    let canExplore = false;
    const originalPlaybackVideo = document.getElementById('playback-video');
    const originalLoader = document.getElementById('loader');
    let randomStreamSlide, randomVideoElement, randomLoader;
    const fluidCanvas = document.getElementById('fluidCanvas');

    const localVideoPreview = document.getElementById('local-video-preview');

    const updateBtn = document.getElementById('update-params-btn');

    const promptInput = document.getElementById('prompt');

    const cameraButton = document.getElementById('camera-button');



    const ___INITIAL_PROMPT_VALUE = "describe human beings.";

    const ___INITIAL_NEGATIVE_PROMPT_VALUE = "blurry, low quality, flat, 2d";

    const API_KEY = "sk_iK9uX4DPSmmGekB8McXnJGEKB3wWWozjtKKjUKa3WBVirYxMtXL5GLrZiTJZQ8Pb";

    const API_BASE_URL = "https://api.daydream.live";

    const PIPELINE_ID = "pip_qpUgXycjWF6YMeSL";



    let streamId = null;

    let peerConnection = null;

    let isCameraActive = false;

    let cameraStream = null;



    // --- FUNZIONI PER LA TRANSIZIONE E LO SCROLL ---



    function switchToSliderView() {

        if (isSliderViewActive) return;

        isSliderViewActive = true;

        console.log("🚀 Transizione in vista slider...");


        // La classe 'slider-view-active' viene aggiunta subito per preparare il CSS

        document.body.classList.add('slider-view-active');



        const videoContainer = document.getElementById('video-container');

        const controlsSection = document.getElementById('controls-section');

        const sliderWrapper = document.createElement('div');

        sliderWrapper.id = 'slider-wrapper';

        const configSlide = document.createElement('div');

        configSlide.className = 'slide';

        configSlide.id = 'config-slide';

        const randomSlide = document.createElement('div');

        randomSlide.className = 'slide';

        randomSlide.id = 'random-stream-slide';

        randomSlide.innerHTML = `<video class="playback-video" autoplay playsinline></video><div class="loader" style="display: block;"><div class="spinner"></div><p>Scorri per un altro stream...</p></div>`;


        // Sposta i vecchi elementi (già invisibili) nel nuovo layout

        configSlide.appendChild(videoContainer);

        configSlide.appendChild(controlsSection);

        sliderWrapper.appendChild(configSlide);

        sliderWrapper.appendChild(randomSlide);


        // --- MODIFICA PER FADE-IN ---

        // Prepara il wrapper per il fade-in

        sliderWrapper.style.opacity = '0';



        document.body.innerHTML = '';

        document.body.appendChild(sliderWrapper);


        // Attiva il fade-in dopo un istante per permettere al browser di applicare lo stile iniziale

        setTimeout(() => {

            sliderWrapper.classList.add('is-transitioning');

            sliderWrapper.style.opacity = '1';

        }, 50);

        // --------------------------



        randomStreamSlide = document.getElementById('random-stream-slide');

        randomVideoElement = randomStreamSlide.querySelector('.playback-video');

        randomLoader = randomStreamSlide.querySelector('.loader');


        setupSliderObserver();

        setupDesktopScrollFix();

        setupDragToScroll();

    }



    /**
    
    * MODIFICATO: Ora gestisce l'animazione di fade-out prima della transizione.
    
    */

    function handleInitialScroll(event) {

        if (canExplore && !isSliderViewActive && event.deltaY > 0) {

            event.preventDefault();

            window.removeEventListener('wheel', handleInitialScroll); // Rimuove subito il listener



            console.log("🎬 Avvio transizione smooth...");



            // 1. Applica la classe per il fade-out agli elementi della configurazione

            const videoContainer = document.getElementById('video-container');

            const controlsSection = document.getElementById('controls-section');

            if (videoContainer) videoContainer.classList.add('is-transitioning');

            if (controlsSection) controlsSection.classList.add('is-transitioning');



            // 2. Attendi la fine dell'animazione (400ms) e poi cambia la UI

            setTimeout(() => {

                switchToSliderView();

            }, 400);

        }

    }



    function enableExploreMode() {

        if (canExplore) return;

        console.log("🌟 Modalità esplorazione abilitata. Scorri per iniziare.");

        canExplore = true;

        window.addEventListener('wheel', handleInitialScroll);

    }


    // (Le altre funzioni di setup, connessione e inizializzazione rimangono invariate)

    function setupSliderObserver() {

        let hasScrolledDownOnce = false;

        const observer = new IntersectionObserver((entries) => {

            entries.forEach(entry => {

                if (entry.isIntersecting && entry.target.id === 'random-stream-slide') {

                    if (socket) socket.emit('request-random-stream', { sessionId });

                    if (!hasScrolledDownOnce) {

                        hasScrolledDownOnce = true;

                        console.log("Punto di non ritorno. Rimuovo lo slide di configurazione.");

                        const configSlide = document.getElementById('config-slide');

                        if (configSlide) configSlide.remove();

                    }

                }

            });

        }, { threshold: 0.5 });

        observer.observe(randomStreamSlide);

    }



    function setupDesktopScrollFix() {

        const sliderWrapper = document.getElementById('slider-wrapper');

        if (!sliderWrapper) return;

        sliderWrapper.addEventListener('wheel', (event) => {

            event.preventDefault();

            sliderWrapper.scrollBy({ top: event.deltaY, behavior: 'smooth' });

        });

    }



    function setupDragToScroll() {

        const sliderWrapper = document.getElementById('slider-wrapper');

        if (!sliderWrapper) return;

        let isDragging = false;

        let startY;

        let startScrollTop;

        sliderWrapper.addEventListener('mousedown', (e) => {

            isDragging = true;

            startY = e.pageY;

            startScrollTop = sliderWrapper.scrollTop;

            sliderWrapper.style.cursor = 'grabbing';

            e.preventDefault();

        });

        const stopDragging = () => {

            if (!isDragging) return;

            isDragging = false;

            sliderWrapper.style.cursor = 'grab';

        };

        sliderWrapper.addEventListener('mouseup', stopDragging);

        sliderWrapper.addEventListener('mouseleave', stopDragging);

        sliderWrapper.addEventListener('mousemove', (e) => {

            if (!isDragging) return;

            const deltaY = e.pageY - startY;

            sliderWrapper.scrollTop = startScrollTop - deltaY;

        });

    }



    async function handleStartPlayback(targetVideoElement, whepUrl) {

        if (targetVideoElement.reconnectTimeoutId) clearTimeout(targetVideoElement.reconnectTimeoutId);

        if (targetVideoElement.peerConnection) targetVideoElement.peerConnection.close();


        async function tryToConnect(pollInterval) {

            try {

                targetVideoElement.reconnectTimeoutId = setTimeout(() => tryToConnect(pollInterval + pollInterval), pollInterval);

                const playbackPeerConnection = new RTCPeerConnection();

                targetVideoElement.peerConnection = playbackPeerConnection;


                playbackPeerConnection.ontrack = (event) => {

                    console.log("✅ Traccia video ricevuta per", targetVideoElement.id || "video casuale");

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

                console.error(`Tentativo di connessione fallito. Prossimo tentativo tra ${pollInterval}ms`);

            }

        }

        tryToConnect(5000);

    }


    async function startLivepeerStream(sourceStream) {

        if (!sourceStream) return console.error("Nessuna sorgente stream fornita.");

        try {

            if (peerConnection) peerConnection.close();

            console.log("Creazione di una nuova risorsa stream su Livepeer...");

            const initPayload = {

                "name": "boya-stream", "pipeline_id": PIPELINE_ID,

                "pipeline_params": { "model_id": "stabilityai/sd-turbo", "prompt": ___INITIAL_PROMPT_VALUE, "negative_prompt": ___INITIAL_NEGATIVE_PROMPT_VALUE, "num_inference_steps": 50, "seed": 42, "t_index_list": [2, 4, 6], "controlnets": [{ "conditioning_scale": 0.4, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-openpose-diffusers", "preprocessor": "pose_tensorrt", "preprocessor_params": {} }, { "conditioning_scale": 0.14, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-hed-diffusers", "preprocessor": "soft_edge", "preprocessor_params": {} }, { "conditioning_scale": 0.27, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-canny-diffusers", "preprocessor": "canny", "preprocessor_params": { "high_threshold": 200, "low_threshold": 100 } }, { "conditioning_scale": 0.34, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-depth-diffusers", "preprocessor": "depth_tensorrt", "preprocessor_params": {} }, { "conditioning_scale": 0.66, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-color-diffusers", "preprocessor": "passthrough", "preprocessor_params": {} }] }

            };

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

            const locationHeader = whipResponse.headers.get('livepeer-playback-url')?.replace('fra-ai-mediamtx-0.livepeer.com', 'ai.livepeer.com');

            if (!locationHeader) throw new Error('Header Location mancante nella risposta WHIP.');

            const answerSdp = await whipResponse.text();

            await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });

            console.log("Connessione WHIP stabilita con successo! ✔️");

            setTimeout(() => {

                if (sessionId) socket.emit('share-url', { sessionId: sessionId, url: locationHeader });

                handleStartPlayback(originalPlaybackVideo, locationHeader);

            }, 1500);

            updateBtn.disabled = false;

        } catch (error) {

            console.error('Errore durante l\'avvio dello stream:', error);

            alert("Si è verificato un errore durante la creazione dello stream.");

        }

    }


    async function handleUpdateParams() {

        if (!streamId) return;

        updateBtn.disabled = true;

        const paramsPayload = { "params": { "prompt": promptInput.value } };

        try {

            const response = await fetch(`${API_BASE_URL}/v1/streams/${streamId}`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${API_KEY}`, 'x-client-source': 'streamdiffusion-web', 'Content-Type': 'application/json' }, body: JSON.stringify(paramsPayload) });

            if (!response.ok) throw new Error(`API Update Error: ${response.statusText}`);

            promptInput.value = '';

        } catch (error) { console.error('Error updating parameters:', error); }

        finally { updateBtn.disabled = false; }

    }



    async function toggleVideoSource() {

        const canvasContainer = document.getElementById('canvas-container');
        if (!isCameraActive) {
            try {
                cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
                if (canvasContainer) canvasContainer.style.display = 'none';
                localVideoPreview.srcObject = cameraStream;
                await startLivepeerStream(cameraStream);
                isCameraActive = true;
            } catch (err) { alert("Non è stato possibile accedere alla fotcamera."); }

        } else {

            if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
            localVideoPreview.style.display = 'none';
            if (canvasContainer) canvasContainer.style.display = 'block';
            const canvasStream = fluidCanvas.captureStream();
            await startLivepeerStream(canvasStream);
            isCameraActive = false;
        }
    }

    // --- INIZIALIZZAZIONE ---
    function init() {

        socket = io();
        socket.on('connect', () => { if (sessionId) socket.emit('join-session', sessionId); });
        socket.on('random-stream-received', ({ url }) => {
            if (randomLoader) randomLoader.style.display = 'block';
            handleStartPlayback(randomVideoElement, url);
        });

        socket.on('no-random-stream-found', () => { if (randomLoader) randomLoader.querySelector('p').textContent = 'Nessun altro stream trovato.'; });
        originalPlaybackVideo.addEventListener('canplay', () => originalLoader.style.display = 'none');
        originalPlaybackVideo.addEventListener('playing', () => originalLoader.style.display = 'none');
        originalPlaybackVideo.addEventListener('waiting', () => originalLoader.style.display = 'block');
        updateBtn.addEventListener('click', handleUpdateParams);
        cameraButton.addEventListener('click', toggleVideoSource);
        promptInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !updateBtn.disabled) { e.preventDefault(); handleUpdateParams(); } });

        document.addEventListener('usermessageinterpolation', (e) => {

            if (socket) socket.emit('share-user-message', { sessionId, text: e.detail.text, interpolation: e.detail.interpolation });
            promptInput.value = e.detail.interpolation;
            updateBtn.click();

        });
        setTimeout(() => {
            const canvasStream = fluidCanvas.captureStream();
            startLivepeerStream(canvasStream);

        }, 2000);
    }
    init();

});