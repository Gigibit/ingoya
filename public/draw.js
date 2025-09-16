// o gioia, ch'io conobbi, esser amato amando!
import { Theia } from './theia.js';

class AppController {
    constructor() {
        this.initialized = false;
        this.socket = null;
        this.sessionId = this._generateSessionId();
        this.currentAudioPartnerSocketId = null;
        this.isSliderViewActive = false;
        this.isConfigOverlayActive = false;
        this.canExplore = false;
        this.isTransitioning = false;
        this.theiaInstance = null;
        this.livepeerConnection = null;
        this.p2pAudioConnection = null;
        this.localStream = null;
        this.localAudioSubStream = null;
        this.originalPlaybackVideo = document.getElementById('playback-video');
        this.localPreviewOverlay = document.getElementById('local-preview-overlay');
        this.updateBtn = document.getElementById('update-params-btn');
        this.promptInput = document.getElementById('prompt');
        this.cameraButton = document.getElementById('camera-button');
        this.controlsSection = document.getElementById('controls-section');
        this._init();
        document.getElementById('main-title').style.opacity = '0';
    }

    async _init() {
        const isAuthenticated = await this._verifyAuthentication();
        if (!isAuthenticated) {
            console.log("Verifica fallita. Inizializzazione dell'app interrotta.");
            return;
        }
        console.log("✅ Autenticazione riuscita. Avvio dell'applicazione...");
        this._setupSocket();
        this._setupEventListeners();
        this.main();
    }

    _generateSessionId(length = 6) {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('sessionId')) return urlParams.get('sessionId');
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    async _verifyAuthentication() {
        try {
            const response = await fetch('/random-stream?excludeSessionId=auth-check', { redirect: 'manual' });
            if (response.type === 'opaqueredirect' || response.status === 401) {
                window.location.href = '/';
                return false;
            }
            if (!response.ok && response.status !== 404) {
                throw new Error('Errore del server durante la verifica del token.');
            }
            return true;
        } catch (error) {
            console.error("Errore durante la verifica dell'autenticazione:", error);
            window.location.href = '/';
            return false;
        }
    }

    _setupEventListeners() {
        this.cameraButton.addEventListener('click', () => this.main());
        this.updateBtn.addEventListener('click', () => this.handleUpdateParams());
        this.originalPlaybackVideo.addEventListener('click', () => {
            if (this.isSliderViewActive) this.toggleConfigOverlay();
        });
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
            const newUrl = `${window.location.pathname}?sessionId=${this.sessionId}`;
            window.history.replaceState({ path: newUrl }, '', newUrl);
            this.socket.emit('join-session', this.sessionId);
        });
        this._setupSocketListeners();
    }

    _setupSocketListeners() {
        this.socket.on('audio-request-received', async ({ visitorSocketId }) => {
            if (this.currentAudioPartnerSocketId === visitorSocketId) return;
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
                try { await this.p2pAudioConnection.addIceCandidate(candidate); }
                catch (e) { console.error('Errore ICE:', e); }
            }
        });
        this.socket.on('hang-up', () => this.hangUp());
    }

    async main() {
        await this.toggleVideoSource();
        if (this.localStream) {
            await this.getOrCreateStreamSession(this.localStream);
        }
    }

    async toggleVideoSource() {
        this.cameraButton.classList.toggle('camera-enabled');
        const isCameraActive = this.cameraButton.classList.contains('camera-enabled');
        const canvasContainer = document.getElementById('canvas-container');
        try {
            if (isCameraActive) {
                this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                this.localAudioSubStream = new MediaStream(this.localStream.getAudioTracks());
                this.localPreviewOverlay.srcObject = this.localStream;
                this.localPreviewOverlay.play().catch(e => {});
                this.localPreviewOverlay.style.opacity = '1';
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
        document.body.appendChild(this.originalPlaybackVideo);
        this.preloadNextStream();
        this.controlsSection.style.opacity = '0';
        let touchStartY = 0;
        window.addEventListener('wheel', (event) => { if (event.deltaY > 0) this.transitionToNextStream(); }, { passive: false });
        window.addEventListener('touchstart', (e) => { touchStartY = e.changedTouches[0].screenY; }, { passive: false });
        window.addEventListener('touchend', (e) => {
            if (touchStartY - e.changedTouches[0].screenY > 50) this.transitionToNextStream();
        }, { passive: false });
    }

    toggleConfigOverlay() {
        this.isConfigOverlayActive = !this.isConfigOverlayActive;
        document.body.classList.toggle('config-overlay-active', this.isConfigOverlayActive);
        this.controlsSection.style.opacity = this.isConfigOverlayActive ? '1' : '0';
        if (this.isConfigOverlayActive) this.hangUp();
    }

    enableExploreMode() {
        if (this.canExplore) return;
        this.canExplore = true;
        const handleInitialScroll = (event) => {
            if (this.canExplore && !this.isSliderViewActive && event.deltaY > 0) {
                event.preventDefault();
                window.removeEventListener('wheel', handleInitialScroll);
                if(this.initialized) return false;
                this.initialized = true
                this.switchToSliderView();
            }
        };
        const handleInitialTouch = (e) => {
            if (!this.canExplore || this.isSliderViewActive) return;
            const touchStartY = e.changedTouches[0].screenY;
            const onTouchEnd = (endEvent) => {
                if (touchStartY - endEvent.changedTouches[0].screenY > 50) {
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
        if (this.isConfigOverlayActive) this.toggleConfigOverlay();
        if (this.isTransitioning) return;

        const currentSlide = document.querySelector('.slide.is-visible');
        const nextSlide = document.querySelector('.slide:not(.is-visible)');
        
        const hasContent = nextSlide && (nextSlide.querySelector('video')?.srcObject || nextSlide.dataset.sessionId === 'THEIA_SESSION');
        if (!currentSlide || !nextSlide || !hasContent) {
            return console.warn("Transizione annullata: contenuto non pronto.");
        }
        
        this.isTransitioning = true;
        this.hangUp(); 
        
        nextSlide.style.zIndex = '2';
        nextSlide.classList.add('is-visible');

        nextSlide.addEventListener('transitionend', () => {
            this.removeSmooth(currentSlide);
            setTimeout(() => {
                nextSlide.style.zIndex = '1';
                this.preloadNextStream();
                this.isTransitioning = false;
                
                const streamerSessionId = nextSlide.dataset.sessionId;
                if (streamerSessionId === 'THEIA_SESSION' ) {
                    // TODO: HANDLE THEIA TRANSITION
                } else if (this.localAudioSubStream) {
                    this.socket.emit('request-audio-call', { streamerSessionId });
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
    
    async preloadNextStream() {
        try {
            const response = await fetch(`/random-stream?excludeSessionId=${this.sessionId}`);
            if (!response.ok) throw new Error(`Errore di rete: ${response.statusText}`);
            const data = await response.json();
            this.handleNewRandomStream(data.sessionId, data.whepUrl);
        } catch (err) {
            console.error("Errore preloadNextStream:", err);
        }
    }

    handleNewRandomStream(streamerSessionId, url) {
        const streamContainer = document.getElementById('stream-container');
        let targetSlide = document.querySelector('.slide:not(.is-visible):not(.is-exiting)');
        if (!targetSlide) {
            targetSlide = document.createElement('div');
            targetSlide.className = 'slide';
            streamContainer.appendChild(targetSlide);
        }
        targetSlide.dataset.sessionId = streamerSessionId;
        targetSlide.innerHTML = `<video class="playback-video" autoplay playsinline muted></video>`;
        const videoEl = targetSlide.querySelector('.playback-video');

        if (streamerSessionId === 'THEIA_SESSION') {
            console.log("🤖 Incontro con Theia. Le passo il controllo del suo video.");
            if (this.localAudioSubStream && !this.theiaInstance) {
                this.theiaInstance = new Theia();
                this.theiaInstance.startConversation(this.localAudioSubStream, videoEl);
            }
        } else {
            this.handleStartPlayback(videoEl, url);
            if (this.localAudioSubStream) {
                this.socket.emit('request-audio-call', { streamerSessionId });
            }
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
            this.livepeerConnection = new RTCPeerConnection({
                    iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    ]
                });
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
            this.handleStartPlayback(this.originalPlaybackVideo, whepUrl);
            this.enableExploreMode();
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
                    this.localPreviewOverlay.style.opacity = '0';
                    this.localPreviewOverlay.addEventListener('transitionend', () => this.localPreviewOverlay.remove(), { once: true });
                    if (targetVideoElement.id === 'playback-video') this.enableExploreMode();
                    if (targetVideoElement.reconnectTimeoutId) { clearTimeout(targetVideoElement.reconnectTimeoutId); targetVideoElement.reconnectTimeoutId = null; }
                };
                const offer = await playbackPeerConnection.createOffer({ offerToReceiveVideo: true });
                await playbackPeerConnection.setLocalDescription(offer);
                const whepResponse = await fetch(whepUrl, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: playbackPeerConnection.localDescription.sdp });
                if (!whepResponse.ok) throw new Error(`Connessione WHEP fallita: ${whepResponse.statusText}`);
                const answerSdp = await whepResponse.text();
                await playbackPeerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
            } catch (error) { console.error(`Connessione Playback fallita per ${whepUrl}. Riprovo tra ${pollInterval}ms`); }
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

    setupAudioPeerConnection() {
        if (this.p2pAudioConnection) this.p2pAudioConnection.close();
        const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        this.p2pAudioConnection = new RTCPeerConnection(configuration);
        this.localAudioSubStream.getTracks().forEach(track => {
            this.p2pAudioConnection.addTrack(track, this.localAudioSubStream);
        });
        this.p2pAudioConnection.ontrack = (event) => {
            let remoteAudioEl = document.getElementById('remote-audio');
            if (!remoteAudioEl) {
                remoteAudioEl = document.createElement('audio');
                remoteAudioEl.id = 'remote-audio';
                remoteAudioEl.autoplay = true;
                remoteAudioEl.style.display = 'none';
                document.body.appendChild(remoteAudioEl);
            }
            if (remoteAudioEl.srcObject !== event.streams[0]) {
                remoteAudioEl.srcObject = event.streams[0];
                remoteAudioEl.play().catch(e => console.warn("Autoplay audio bloccato", e));
            }
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
        if (this.theiaInstance) {
            this.theiaInstance.stopConversation();
            this.theiaInstance = null;
        }
        if (this.theiaLivepeerConnection) {
            this.theiaLivepeerConnection.close();
            this.theiaLivepeerConnection = null;
            console.log("🛑 Stoppato lo streaming pubblico di Theia.");
        }
        if (this.placeholderAudioContext) {
            this.placeholderAudioContext.close();
            this.placeholderAudioContext = null;
        }

        const remoteAudioEl = document.getElementById('remote-audio');
        if (remoteAudioEl) remoteAudioEl.remove();
        this.currentAudioPartnerSocketId = null;
    }
}

window.addEventListener('DOMContentLoaded', () => new AppController());

