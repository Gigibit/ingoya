// o gioia, ch'io conobbi, esser amato amando!

class AppController {
    // --- Inizializzazione della Classe ---

    constructor() {
        // Stato dell'applicazione
        this.socket = null;
        this.sessionId = this._generateSessionId();
        this.currentAudioPartnerSocketId = null;
        this.isSliderViewActive = false;
        this.canExplore = false;
        this.isTransitioning = false;
        this.pendingRemoteAudioStream = null;
        // Connessioni WebRTC
        this.livepeerConnection = null;
        this.p2pAudioConnection = null;

        // Media Streams
        this.localStream = null;
        this.localAudioSubStream = null;

        // Riferimenti al DOM
        this.originalPlaybackVideo = document.getElementById('playback-video');
        this.localPreviewOverlay = document.getElementById('local-preview-overlay');
        this.updateBtn = document.getElementById('update-params-btn');
        this.promptInput = document.getElementById('prompt');
        this.cameraButton = document.getElementById('camera-button');

        // Avvio
        this._init();
    }

    /**
     * Metodo principale di inizializzazione che avvia l'applicazione.
     */
    _init() {
        this._setupSocket();
        this._setupEventListeners();

        // Avvia automaticamente il processo dopo un breve ritardo
        setTimeout(() => this.cameraButton.click(), 1000);
    }

    // --- Metodi Privati di Setup ---

    _generateSessionId(length = 6) {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('sessionId')) {
            return urlParams.get('sessionId');
        }
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    _setupEventListeners() {
        this.cameraButton.addEventListener('click', () => this.main());
        this.updateBtn.addEventListener('click', () => this.handleUpdateParams());

        this.promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !this.updateBtn.disabled) {
                e.preventDefault();
                this.handleUpdateParams();
            }
        });

        document.addEventListener('usermessageinterpolation', (e) => {
            if (this.socket) {
                this.socket.emit('share-user-message', { sessionId: this.sessionId, text: e.detail.text, interpolation: e.detail.interpolation });
            }
            this.handleUpdateParams(e.detail.interpolation);
        });
    }

    _setupSocket() {
        this.socket = io();
        this.socket.on('connect', () => {
            console.log(`Connesso con socket ID: ${this.socket.id}. Sessione: ${this.sessionId}`);
            const newUrl = `${window.location.pathname}?sessionId=${this.sessionId}`;
            window.history.replaceState({ path: newUrl }, '', newUrl);
            this.socket.emit('join-session', this.sessionId);
        });
        this._setupSocketListeners();
    }

    _setupSocketListeners() {
        // Listener per la chat audio P2P
        this.socket.on('audio-request-received', async ({ visitorSocketId }) => {
            console.log(`📥 Ricevuta richiesta di chiamata da ${visitorSocketId}`);
            this.hangUp();
            this.currentAudioPartnerSocketId = visitorSocketId;
            this.setupAudioPeerConnection();
            const offer = await this.p2pAudioConnection.createOffer();
            await this.p2pAudioConnection.setLocalDescription(offer);
            this.socket.emit('audio-offer', { offer, targetSocketId: visitorSocketId });
        });

        this.socket.on('audio-offer', async ({ offer, streamerSocketId }) => {
            if (!this.localAudioSubStream) return;
            this.currentAudioPartnerSocketId = streamerSocketId;
            this.setupAudioPeerConnection();
            await this.p2pAudioConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await this.p2pAudioConnection.createAnswer();
            await this.p2pAudioConnection.setLocalDescription(answer);
            this.socket.emit('audio-answer', { answer, targetSocketId: streamerSocketId });
        });

        this.socket.on('audio-answer', async (answer) => {
            if (this.p2pAudioConnection && !this.p2pAudioConnection.currentRemoteDescription) {
                await this.p2pAudioConnection.setRemoteDescription(new RTCSessionDescription(answer));
            }
        });

        this.socket.on('audio-ice-candidate', async (candidate) => {
            if (this.p2pAudioConnection && candidate) {
                try {
                    await this.p2pAudioConnection.addIceCandidate(candidate);
                } catch (e) { console.error('Errore ICE:', e); }
            }
        });

        this.socket.on('hang-up', () => {
            console.log("L'altro utente ha terminato la chiamata.");
            this.hangUp();
        });
    }

    // --- Flusso Principale dell'Applicazione ---

    async main() {
        await this.toggleVideoSource();
        await this.getOrCreateStreamSession(this.localStream);
    }

    async toggleVideoSource() {
        this.cameraButton.classList.toggle('camera-enabled');
        const isCameraActive = this.cameraButton.classList.contains('camera-enabled');
        const canvasContainer = document.getElementById('canvas-container');

        try {
            if (isCameraActive) {
                this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                this.localAudioSubStream = new MediaStream(this.localStream.getAudioTracks());

                // --- MODIFICA CHIAVE: Usa l'overlay per l'anteprima ---
                console.log("Mostrando l'anteprima della camera locale nell'overlay...");
                this.localPreviewOverlay.srcObject = this.localStream;
                this.localPreviewOverlay.play();
                this.localPreviewOverlay.onloadedmetadata = () => {
                    this.localPreviewOverlay.play().catch(err => {
                        console.warn("Autoplay bloccato, in attesa di interazione:", err);
                    });
                    this.localPreviewOverlay.classList.remove('fade-out');
                };
                this.localPreviewOverlay.classList.remove('fade-out'); // Assicura che sia visibile

            } else {
                if (this.localStream) this.localStream.getTracks().forEach(track => track.stop());
                this.localAudioSubStream = await navigator.mediaDevices.getUserMedia({ audio: true });

                if (canvasContainer) canvasContainer.style.display = 'block';
                const fluidCanvas = document.getElementById('fluidCanvas');
                const canvasStream = fluidCanvas.captureStream();
                this.localStream = new MediaStream([...canvasStream.getVideoTracks(), ...this.localAudioSubStream.getAudioTracks()]);
            }
        } catch (err) {
            console.error("Accesso a media fallito:", err);
        }
    }

    // --- Gestione UI ---

    switchToSliderView() {
        if (this.isSliderViewActive) return;
        this.isSliderViewActive = true;
        document.body.classList.add('slider-view-active');
        const streamContainer = document.createElement('div');
        streamContainer.id = 'stream-container';
        const preloadedSlide = document.getElementById('random-stream-slide');
        preloadedSlide.classList.add('is-visible');
        streamContainer.appendChild(preloadedSlide);
        document.body.appendChild(streamContainer);
        this.originalPlaybackVideo.classList.add('mini-video');
        document.getElementById('controls-section').style.display = 'none';
        document.body.appendChild(this.originalPlaybackVideo);
        this.preloadNextStream();

        let touchStartY = 0;
        window.addEventListener('wheel', (event) => { if (event.deltaY > 0) this.transitionToNextStream(); }, { passive: false });
        window.addEventListener('touchstart', (e) => { touchStartY = e.changedTouches[0].screenY; }, { passive: false });
        window.addEventListener('touchend', (e) => {
            if (touchStartY - e.changedTouches[0].screenY > 50) this.transitionToNextStream();
        }, { passive: false });
    }

    enableExploreMode() {
        if (this.canExplore) return;
        this.canExplore = true;

        const handleInitialScroll = (event) => {
            if (this.canExplore && !this.isSliderViewActive && event.deltaY > 0) {
                event.preventDefault();
                window.removeEventListener('wheel', handleInitialScroll);
                window.removeEventListener('touchend', handleInitialTouch); // cleanup
                this.switchToSliderView();
            }
        };

        const handleInitialTouch = (e) => {
            if (!this.canExplore || this.isSliderViewActive) return;
            const touchStartY = e.changedTouches[0].screenY;
            const onTouchEnd = (endEvent) => {
                const deltaY = touchStartY - endEvent.changedTouches[0].screenY;
                if (deltaY > 50) { // swipe verso l’alto
                    window.removeEventListener('touchend', onTouchEnd);
                    window.removeEventListener('wheel', handleInitialScroll);
                    this.switchToSliderView();
                }
            };
            window.addEventListener('touchend', onTouchEnd, { passive: false });
        };

        window.addEventListener('wheel', handleInitialScroll, { passive: false });
        window.addEventListener('touchstart', handleInitialTouch, { passive: false });
    }

transitionToNextStream() {
    this.hangUp();
    if (this.isTransitioning) return;

    const currentSlide = document.querySelector('.slide.is-visible');
    const nextSlide = document.querySelector('.slide:not(.is-visible)');
    if (!currentSlide || !nextSlide || !nextSlide.querySelector('video')?.srcObject) {
        return console.warn("Transizione annullata: video non pronto.");
    }

    this.isTransitioning = true;

    nextSlide.style.zIndex = '2';
    nextSlide.classList.add('is-visible');
    nextSlide.addEventListener('transitionend', () => {
        this.removeSmooth(currentSlide);
        setTimeout(() => {
            nextSlide.style.zIndex = '1';
            this.preloadNextStream();
            this.isTransitioning = false;

            // --- Avvia audio solo quando lo slide è visibile ---
            if (this.pendingRemoteAudioStream) {
                let remoteAudio = document.getElementById('remote-audio');
                if (!remoteAudio) {
                    remoteAudio = document.createElement('audio');
                    remoteAudio.id = 'remote-audio';
                    remoteAudio.autoplay = true;
                    remoteAudio.style.display = 'none';
                    document.body.appendChild(remoteAudio);
                }
                remoteAudio.srcObject = this.pendingRemoteAudioStream;
                remoteAudio.play().catch(err => console.warn("Autoplay audio bloccato:", err));
                this.pendingRemoteAudioStream = null;
            }

        }, 400);
    }, { once: true });
}


    removeSmooth(element) {
        const start = performance.now();
        const step = (timestamp) => {
            let progress = (timestamp - start) / 600;
            if (progress > 1) progress = 1;
            element.style.opacity = String(1 - progress);
            element.style.transform = `scale(${1 - 0.05 * progress})`;
            if (progress < 1) requestAnimationFrame(step);
            else element.remove();
        };
        requestAnimationFrame(step);
    }

    // --- Networking e Streaming ---

    async preloadNextStream() {
        try {
            const response = await fetch(`/random-stream?excludeSessionId=${this.sessionId}`);
            if (response.status === 404) return console.log("Nessun altro stream trovato.");
            if (!response.ok) throw new Error(`Errore di rete: ${response.statusText}`);

            const data = await response.json();

            // --- MODIFICA PER DEBUG ---
            console.log("Dati ricevuti da /random-stream:", data); // Logghiamo l'intera risposta

            const nextStreamUrl = data.whepUrl;

            // Aggiungiamo un controllo per assicurarsi che l'URL esista prima di procedere
            if (!nextStreamUrl) {
                console.error("Errore critico: la risposta dal server non contiene un URL valido.", data);
                return; // Interrompiamo l'esecuzione per prevenire l'errore.
            }
            // --- FINE MODIFICA ---

            this.handleNewRandomStream(data.sessionId, nextStreamUrl);
        } catch (err) {
            console.error("Errore preloadNextStream:", err);
        }
    }

    handleNewRandomStream(streamerSessionId, url) {
        this.hangUp();
        const streamContainer = document.getElementById('stream-container');
        const preloadedVideoElement = document.querySelector('#random-stream-slide .playback-video');
        if (this.isSliderViewActive && streamContainer) {
            const newSlide = document.createElement('div');
            newSlide.className = 'slide';
            newSlide.innerHTML = `<video class="playback-video" autoplay playsinline muted></video>`;
            streamContainer.appendChild(newSlide);
            this.handleStartPlayback(newSlide.querySelector('video'), url);
        } else {
            this.handleStartPlayback(preloadedVideoElement, url);
        }
        if (this.localAudioSubStream) {
            this.socket.emit('request-audio-call', { streamerSessionId });
        }
    }

    async getOrCreateStreamSession(sourceStream) {
        if (!sourceStream) return console.error("Source stream non fornito.");
        try {
            const response = await fetch('/stream-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.sessionId })
            });
            if (!response.ok) throw new Error(`Errore dal server: ${response.statusText}`);
            const sessionData = await response.json();

            if (this.livepeerConnection) this.livepeerConnection.close();
            this.livepeerConnection = new RTCPeerConnection();
            sourceStream.getTracks().forEach(track => this.livepeerConnection.addTrack(track, sourceStream));

            const offer = await this.livepeerConnection.createOffer();
            await this.livepeerConnection.setLocalDescription(offer);

            const whipResponse = await fetch(sessionData.whipUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/sdp' },
                body: this.livepeerConnection.localDescription.sdp
            });
            if (whipResponse.status !== 201) throw new Error(`Connessione WHIP fallita: ${whipResponse.statusText}`);

            const whepUrl = whipResponse.headers.get('livepeer-playback-url').replace('fra-ai-mediamtx-0.livepeer.com', 'ai.livepeer.com');
            if (!whepUrl) throw new Error('Header livepeer-playback-url mancante.');

            await fetch('/update-whep-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.sessionId, whepUrl })
            });

            const answerSdp = await whipResponse.text();
            await this.livepeerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });

            this.updateBtn.disabled = false;
            setTimeout(() => {
                this.handleStartPlayback(this.originalPlaybackVideo, whepUrl);
                this.preloadNextStream();
            }, 1500);
            document.dispatchEvent(new CustomEvent('streamAudioReady', {
                detail: { localAudioStream: this.localAudioSubStream, peerConnection: this.livepeerConnection }
            }));
        } catch (error) {
            console.error('Errore getOrCreateStreamSession:', error);
        }
    }

    handleStartPlayback(targetVideoElement, whepUrl) {
        if (!targetVideoElement || !whepUrl) return console.error("handleStartPlayback args invalidi.");
        if (targetVideoElement.reconnectTimeoutId) clearTimeout(targetVideoElement.reconnectTimeoutId);
        if (targetVideoElement.peerConnection) targetVideoElement.peerConnection.close();
        const tryToConnect = async (pollInterval) => {
            try {
                targetVideoElement.reconnectTimeoutId = setTimeout(() => tryToConnect(Math.min(pollInterval + 2000, 30000)), pollInterval);
                const playbackPeerConnection = new RTCPeerConnection();
                targetVideoElement.peerConnection = playbackPeerConnection;
                playbackPeerConnection.ontrack = (event) => {
                    const loader = document.getElementById('loader');
                    if (loader) loader.style.display = 'none';

                    if (targetVideoElement.srcObject !== event.streams[0]) {
                        targetVideoElement.srcObject = event.streams[0];
                    }

                    // --- MODIFICA CHIAVE: Avvia la dissolvenza dell'overlay ---
                    setTimeout(() => this.localPreviewOverlay.classList.add('fade-out'), 2000);

                    if (targetVideoElement.id === 'playback-video') this.enableExploreMode();
                    if (targetVideoElement.reconnectTimeoutId) { clearTimeout(targetVideoElement.reconnectTimeoutId); targetVideoElement.reconnectTimeoutId = null; }
                };
                const offer = await playbackPeerConnection.createOffer({ offerToReceiveVideo: true });
                await playbackPeerConnection.setLocalDescription(offer);
                const whepResponse = await fetch(whepUrl, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: playbackPeerConnection.localDescription.sdp });
                if (!whepResponse.ok) throw new Error(`Connessione WHEP fallita: ${whepResponse.statusText}`);
                const answerSdp = await whepResponse.text();
                await playbackPeerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
            } catch (error) { console.error(`Connessione fallita per ${whepUrl}. Riprovo tra ${pollInterval}ms`); }
        };
        tryToConnect(5000);
    }

    async handleUpdateParams(promptText) {
        const prompt = promptText || this.promptInput.value;
        if (!prompt) return;
        this.updateBtn.disabled = true;
        try {
            const response = await fetch('/update-stream-params', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.sessionId, prompt })
            });
            if (!response.ok) throw new Error(`Errore dal server: ${response.statusText}`);
            this.promptInput.value = '';
            this.promptInput.dispatchEvent(new Event('input'));
        } catch (error) {
            console.error('Errore aggiornamento parametri:', error);
        } finally {
            this.updateBtn.disabled = false;
        }
    }

    // --- Logica Chat P2P ---

    setupAudioPeerConnection() {
        if (this.p2pAudioConnection) this.p2pAudioConnection.close();
        const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        this.p2pAudioConnection = new RTCPeerConnection(configuration);

        this.localAudioSubStream.getTracks().forEach(track => {
            this.p2pAudioConnection.addTrack(track, this.localAudioSubStream);
        });

        this.p2pAudioConnection.ontrack = (event) => {
            // memorizza lo stream ma non lo fai partire
            this.pendingRemoteAudioStream = event.streams[0];
        };

        this.p2pAudioConnection.onicecandidate = (event) => {
            if (event.candidate && this.currentAudioPartnerSocketId) {
                this.socket.emit('audio-ice-candidate', {
                    candidate: event.candidate,
                    targetSocketId: this.currentAudioPartnerSocketId
                });
            }
        };
    }

    hangUp() {
        if (this.p2pAudioConnection) {
            if (this.socket && this.currentAudioPartnerSocketId) {
                this.socket.emit('hang-up', { targetSocketId: this.currentAudioPartnerSocketId });
            }
            this.p2pAudioConnection.close();
            this.p2pAudioConnection = null;
        }
        this.currentAudioPartnerSocketId = null;
    }
}

// Avvia l'applicazione quando il DOM è pronto
window.addEventListener('DOMContentLoaded', () => new AppController());

