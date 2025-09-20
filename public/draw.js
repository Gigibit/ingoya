// o gioia, ch'io conobbi, esser amato amando!
import { Theia } from './theia.js';

class AppController {
    constructor() {
        this.socket = null;
        this.sessionId = this._generateSessionId();
        this.currentAudioPartnerSocketId = null;
        this.isSliderViewActive = false;
        this.isConfigOverlayActive = false;
        this.canExplore = false;
        this.isTransitioning = false;
        this.theiaInstance = null;
        this.theiaAudioFader = null; // Per gestire l'intervallo del fade
        this.streamContainer = null;

        this.livepeerConnection = null;
        this.p2pAudioConnection = null;
        this.localStream = null;
        this.localAudioSubStream = null;
        // Elementi DOM
        this.originalPlaybackVideo = document.getElementById('playback-video');
        this.localPreviewOverlay = document.getElementById('local-preview-overlay');
        this.updateBtn = document.getElementById('update-params-btn');
        this.promptInput = document.getElementById('prompt');
        this.cameraButton = document.getElementById('camera-button');
        this.controlsSection = document.getElementById('controls-section');
        this.loader = document.getElementById('loader');
        this.muteBtn = document.getElementById('mute-btn');
        this.fullscreenBtn = document.getElementById('fullscreen-btn');
        this.theiaSlide = document.getElementById('theia-slide');
        this.title = document.getElementById('main-title');

        this._init();
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

    _fadeAudio(shouldFadeOut) {
        if (!this.theiaInstance || !this.theiaInstance.remoteAudioElement) return;

        clearInterval(this.theiaAudioFader);
        const audioEl = this.theiaInstance.remoteAudioElement;
        const fadeDuration = 500;
        const intervalTime = 25;
        const steps = fadeDuration / intervalTime;
        let currentStep = 0;

        if (shouldFadeOut) {
            let startVolume = audioEl.volume;
            this.theiaAudioFader = setInterval(() => {
                currentStep++;
                const newVolume = startVolume * (1 - (currentStep / steps));
                if (newVolume <= 0.05 || currentStep > steps) {
                    audioEl.volume = 0;
                    clearInterval(this.theiaAudioFader);
                } else {
                    audioEl.volume = newVolume;
                }
            }, intervalTime);
        } else { // Fade In
            let startVolume = audioEl.volume;
            this.theiaAudioFader = setInterval(() => {
                currentStep++;
                const newVolume = startVolume + ((1 - startVolume) * (currentStep / steps));
                if (newVolume >= 0.95 || currentStep > steps) {
                    audioEl.volume = 1;
                    clearInterval(this.theiaAudioFader);
                } else {
                    audioEl.volume = newVolume;
                }
            }, intervalTime);
        }
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
                window.location.href = '/'; return false;
            }
            if (!response.ok && response.status !== 404) {
                throw new Error('Errore del server durante la verifica del token.');
            }
            return true;
        } catch (error) {
            console.error("Errore durante la verifica dell'autenticazione:", error);
            window.location.href = '/'; return false;
        }
    }

    _setupEventListeners() {
        this.cameraButton.addEventListener('click', () => this.main());
        this.updateBtn.addEventListener('click', () => this.handleUpdateParams());
        this.originalPlaybackVideo.addEventListener('click', () => {
            if (this.isSliderViewActive) {
                this.toggleConfigOverlay();
                const userInteraction = new CustomEvent("userInteraction", {
                    detail: { type: 'onToggleConfigOverlay', isActive: !this.isConfigOverlayActive }
                });
                document.dispatchEvent(userInteraction);
            }
        });
        this.promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !this.updateBtn.disabled) {
                e.preventDefault(); this.handleUpdateParams();
            }
        });
        this.promptInput.addEventListener('input', () => {
            this.updateBtn.classList.toggle('has-text', this.promptInput.value.trim()!== '');
        });
        document.addEventListener('usermessageinterpolation', (e) => {
            if (this.socket) {
                this.socket.emit('share-user-message', { sessionId: this.sessionId, text: e.detail.text, interpolation: e.detail.interpolation });
            }
            this.handleUpdateParams(e.detail.interpolation);
        });
        if (this.fullscreenBtn) {
            this.fullscreenBtn.addEventListener('click', this._toggleFullScreen.bind(this));
        }
        if (this.muteBtn) {
            this.muteBtn.addEventListener('click', () => this._toggleMute());
        }
        document.addEventListener('fullscreenchange', this._handleFullscreenChange.bind(this));
    }

    _toggleMute() {
        const isCurrentlyUnmuted = document.body.classList.contains('audio-unmuted');
        const newMutedState = isCurrentlyUnmuted;

        const mediaElements = document.querySelectorAll('video, #remote-audio');
        mediaElements.forEach(el => {
            if (el.id !== 'local-preview-overlay') {
                el.muted = newMutedState;
            }
        });

        document.body.classList.toggle('audio-unmuted');
    }

    _handleFullscreenChange() {
        if (document.fullscreenElement) {
            document.body.classList.add('fullscreen-active');
        } else {
            document.body.classList.remove('fullscreen-active');
        }
    }

    _toggleFullScreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
            });
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
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
        if (this.localStream) return;
        await this.toggleVideoSource();
        if (this.localStream) {
            await this.getOrCreateStreamSession(this.localStream);
        }
        this.title.style.opacity = '0';
    }

    _preloadTheia() {
        if (this.theiaInstance || !this.localAudioSubStream) return;
        console.log("🤖 Pre-caricamento di Theia in background...");
        this.theiaSlide.dataset.sessionId = `${this.sessionId}_THEIA`;
        this.theiaInstance = new Theia(this.sessionId);
        const theiaVideoEl = this.theiaSlide.querySelector('.playback-video');
        this.theiaInstance.startConversation(this.localAudioSubStream, theiaVideoEl);
    }


    async toggleVideoSource() {
        this.cameraButton.classList.toggle('camera-enabled');
        const isCameraActive = this.cameraButton.classList.contains('camera-enabled');
        const canvasContainer = document.getElementById('canvas-container');
        try {
            if (this.localStream) this.localStream.getTracks().forEach(track => track.stop());

            if (isCameraActive) {
                this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                this.localAudioSubStream = new MediaStream(this.localStream.getAudioTracks());
                this.localPreviewOverlay.srcObject = this.localStream;
                this.localPreviewOverlay.play().catch(e => { });
                this.localPreviewOverlay.style.opacity = '1';
                if (canvasContainer) canvasContainer.style.display = 'none';
            } else {
                this.localAudioSubStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (canvasContainer) canvasContainer.style.display = 'block';
                const fluidCanvas = document.getElementById('fluidCanvas');
                const canvasStream = fluidCanvas.captureStream();
                this.localStream = new MediaStream([...canvasStream.getVideoTracks(), ...this.localAudioSubStream.getAudioTracks()]);
                this.localPreviewOverlay.srcObject = this.localStream;
                this.localPreviewOverlay.play().catch(e => { });
                this.localPreviewOverlay.style.opacity = '1';
            }
        } catch (err) {
            console.error("Accesso a media fallito:", err);
        }
    }

    switchToSliderView() {
        if (this.isSliderViewActive) return;
        this.isSliderViewActive = true;
        document.body.classList.add('slider-view-active');

        this.streamContainer = document.createElement('div');
        this.streamContainer.id = 'stream-container';
        document.body.appendChild(this.streamContainer);

        this.originalPlaybackVideo.classList.add('mini-video');
        document.body.appendChild(this.originalPlaybackVideo);
        this.controlsSection.style.opacity = '0';
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
        
        // Unica funzione gestore per tutti gli eventi di esplorazione
        const exploreHandler = () => {
            // La prima volta, cambia la vista e poi cerca un utente
            if (!this.isSliderViewActive) {
                this.switchToSliderView();
            }
            // Su tutte le chiamate (inclusa la prima), cerca il prossimo utente
            this.findNextExperience();
        };

        // Aggiungi i listener una sola volta
        let touchStartY = 0;
        window.addEventListener('wheel', (event) => {
            if (event.deltaY > 0) exploreHandler();
        }, { passive: true });
        window.addEventListener('touchstart', (e) => {
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });
        window.addEventListener('touchend', (e) => {
            if (touchStartY - e.changedTouches[0].screenY > 50) exploreHandler();
        }, { passive: true });
    }

    async findNextExperience() {
        if (this.isTransitioning) return;
        this.isTransitioning = true;
        this.hangUp();
        this.loader.style.display = 'flex';

        try {
            const response = await fetch(`/random-stream?excludeSessionId=${this.sessionId}`);
            if (!response.ok) {
                 throw new Error("Nessun utente trovato o errore server");
            }
            const data = await response.json();

            if (data.sessionId.endsWith('_THEIA')) {
                this.transitionToSlide(this.theiaSlide);
            } else {
                const userSlide = this._createSlideForStream(data.sessionId, data.whepUrl);
                this.transitionToSlide(userSlide);
            }
        } catch (err) {
            console.warn(err.message + ", mostro Theia.");
            this.transitionToSlide(this.theiaSlide);
        }
    }

    _createSlideForStream(sessionId, whepUrl) {
        const slide = document.createElement('div');
        slide.className = 'slide';
        slide.dataset.sessionId = sessionId;
        slide.innerHTML = `<video class="playback-video" autoplay playsinline muted></video>`;
        this.streamContainer.appendChild(slide);

        const videoEl = slide.querySelector('.playback-video');
        this.handleStartPlayback(videoEl, whepUrl);
        return slide;
    }

    transitionToSlide(nextSlide) {
        const currentSlide = this.streamContainer.querySelector('.is-visible');

        if (currentSlide === nextSlide) {
            this.loader.style.display = 'none';
            setTimeout(() => {
                this.isTransitioning = false;
            }, 2000);
            return;
        }

        if (nextSlide === this.theiaSlide) {
            this.loader.style.display = 'none';
        }

        if (nextSlide.dataset.sessionId === `${this.sessionId}_THEIA`) {
            this._fadeAudio(false);
        } else if (currentSlide && currentSlide.dataset.sessionId.endsWith('_THEIA')) {
            this._fadeAudio(true);
        }

        if (nextSlide.parentElement !== this.streamContainer) {
            this.streamContainer.appendChild(nextSlide);
        }
        nextSlide.style.display = 'block';

        requestAnimationFrame(() => {
            nextSlide.classList.add('is-visible');
            if (currentSlide) {
                currentSlide.classList.remove('is-visible');
                currentSlide.addEventListener('transitionend', () => {
                    if (currentSlide !== this.theiaSlide) {
                        currentSlide.remove();
                    } else {
                        currentSlide.style.display = 'none';
                    }
                }, { once: true });
            }
            
            setTimeout(() => {
                this.isTransitioning = false;
                const streamerSessionId = nextSlide.dataset.sessionId;
                if (!streamerSessionId.endsWith('_THEIA') && this.localAudioSubStream) {
                    this.socket.emit('request-audio-call', { streamerSessionId });
                }
            }, 2000);
        });
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
            this.handleStartPlayback(this.originalPlaybackVideo, whepUrl);

            this._preloadTheia();
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
                    this.loader.style.display = 'none';

                    if (targetVideoElement.id === 'playback-video') {
                        this.localPreviewOverlay.style.opacity = '0';
                        this.localPreviewOverlay.addEventListener('transitionend', () => this.localPreviewOverlay.remove(), { once: true });
                    }
                    if (targetVideoElement.srcObject !== event.streams[0]) {
                        targetVideoElement.srcObject = event.streams[0];
                    }
                    if (targetVideoElement.reconnectTimeoutId) { clearTimeout(targetVideoElement.reconnectTimeoutId); targetVideoElement.reconnectTimeoutId = null; }
                };
                const offer = await playbackPeerConnection.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
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
        this.p2pAudioConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        this.localAudioSubStream.getTracks().forEach(track => {
            this.p2pAudioConnection.addTrack(track, this.localAudioSubStream);
        });
        this.p2pAudioConnection.ontrack = (event) => {
            let remoteAudioEl = document.getElementById('remote-audio');
            if (!remoteAudioEl) {
                remoteAudioEl = document.createElement('audio');
                remoteAudioEl.id = 'remote-audio';
                remoteAudioEl.autoplay = true;
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
        const remoteAudioEl = document.getElementById('remote-audio');
        if (remoteAudioEl) remoteAudioEl.remove();
        this.currentAudioPartnerSocketId = null;
    }
}

window.addEventListener('DOMContentLoaded', () => new AppController());

