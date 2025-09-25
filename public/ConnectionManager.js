// o gioia, ch'io conobbi, esser amato amando!
import { Theia } from './Theia.js';

export class ConnectionManager {
    constructor(MOCK, socialLayer) {
        this.MOCK = MOCK;
        this.sessionId = this._generateSessionId();
        this.socialLayer = socialLayer;
        
        // MODIFICA: Traccia lo stream che l'utente sta guardando
        this.currentViewingSessionId = null;

        this.MOCK_RESPONSES = {
            '/random-stream': { ok: true, status: 200, json: () => Promise.resolve({ sessionId: 'Z12345', whepUrl: 'mockWhepUrl' }) },
            '/stream-session': { ok: true, status: 200, json: () => Promise.resolve({ whipUrl: 'mockWhipUrl' }) },
            '/update-stream-params': { ok: true, status: 200 },
        };

        this.uiController = null;
        this.theiaInstance = null;
        this.currentAudioPartnerSocketId = null;
        this.isTransitioning = false;
        this.theiaRunning = false;
        this.livepeerConnection = null;
        this.p2pAudioConnection = null;
        this.localStream = null;
        this.localAudioSubStream = null;
        this.audioContext = null;
        this.audioSource = null;
        this.delayNode = null;
        this.loader = document.getElementById('loader');
        this.theiaSlide = document.getElementById('theia-slide');
        
        this.fetch = this.MOCK ? (url, options) => {
            const path = url.split('?')[0];
            const response = this.MOCK_RESPONSES[path];
            if (response) {
                return new Promise(resolve => setTimeout(() => {
                    resolve({
                        ok: response.ok,
                        status: response.status,
                        json: response.json,
                        text: () => Promise.resolve('dummySdp'),
                        headers: new Headers({ 'livepeer-playback-url': 'mockWhepUrl' })
                    });
                }, 500));
            }
            return Promise.reject(new Error(`Mock response not found for ${path}`));
        } : window.fetch.bind(window);
    }
    
    async verifyAuthentication() {
        try {
            const response = await this.fetch('/random-stream?excludeSessionId=auth-check', { redirect: 'manual' });
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
    
    async toggleVideoSource() {
        const isCameraActive = this.uiController.isCameraActive();
        const canvasContainer = document.getElementById('theia-canvas-container');
        try {
            if (this.localStream) this.localStream.getTracks().forEach(track => track.stop());

            const hasCamera = await this._hasVideoInput();
            
            if (isCameraActive && !hasCamera) {
                console.warn("L'accesso alla fotocamera è stato richiesto, ma non è stato trovato nessun dispositivo video. Verrà usata la modalità canvas/audio.");
                this.uiController.setCameraState(false);
            }

            if (isCameraActive && hasCamera) {
                this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                this.localAudioSubStream = new MediaStream(this.localStream.getAudioTracks());
                this.uiController.setLocalPreviewStream(this.localStream);
                if (canvasContainer) canvasContainer.style.opacity = '0';
            } else {
                this.localAudioSubStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (canvasContainer) canvasContainer.style.display = '1';
                const fluidCanvas = document.getElementById('theia-canvas');
                const canvasStream = fluidCanvas.captureStream();
                this.localStream = new MediaStream([...canvasStream.getVideoTracks(), ...this.localAudioSubStream.getAudioTracks()]);
                this.uiController.setLocalPreviewStream(this.localStream);
            }
            if(!localStorage.getItem('platformExplained')){
                this._preloadTheia()
                this.theiaInstance.unmute()
                this.theiaRunning = true
            }
        } catch (err) {
            console.error("Accesso ai dispositivi multimediali fallito:", err);
            this.uiController.alert("Impossibile accedere al microfono o alla fotocamera. Controlla i permessi del browser.");
            this.uiController.setCameraState(false);
        }
    }

    _generateSessionId(length = 6) {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('sessionId')) return urlParams.get('sessionId');
        const chars = 'Z0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
    
    async _hasVideoInput() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return false;
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.some(device => device.kind === 'videoinput');
        } catch (e) {
            console.error("Errore nel verificare i dispositivi video:", e);
            return false;
        }
    }
    
    async handleUpdateParams(promptText) {
        const prompt = promptText;
        if (!prompt) return;
        this.uiController.setUpdateBtnState(true);
        try {
            this.uiController.clearPromptInput();
            const response = await this.fetch('/update-stream-params', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.sessionId, prompt })
            });
            if (!response.ok) throw new Error(`Errore dal server: ${response.statusText}`);
            this.uiController.dispatchEventToPromptInput();
        } catch (error) {
            console.error('Errore aggiornamento parametri:', error);
        } finally {
            this.uiController.setUpdateBtnState(false);
        }
    }
    
    setupSocket() {
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
        
        this.socket.on('participants-list', (participants) => {
            if (this.uiController) {
                this.uiController.updateParticipantsList(participants);
            }
        });
    }

    async main() {
        if (this.localStream) return;
        
        const hasCamera = await this._hasVideoInput();
        if (hasCamera) {
            try {
                const testStream = await navigator.mediaDevices.getUserMedia({ video: true });
                testStream.getTracks().forEach(track => track.stop());
                this.uiController.setCameraState(true);
            } catch (err) {
                this.uiController.setCameraState(false);
            }
        } else {
            this.uiController.setCameraState(false);
        }
        await this.toggleVideoSource();
        
        this.uiController.setMainTitleOpacity(0);
        if (this.localStream) {
            await this.getOrCreateStreamSession(this.localStream);
        }
    }
    
    // MODIFICA: Funzione per notificare al server i cambi di visualizzazione
    _updateViewingStatus(newlyViewedSessionId) {
        if (this.socket) {
            // Notifica al server che non stiamo più guardando il vecchio stream (se ce n'era uno)
            if (this.currentViewingSessionId) {
                this.socket.emit('stop-watching', { wasViewingSessionId: this.currentViewingSessionId });
            }
            // Notifica il nuovo stream
            this.socket.emit('start-watching', { viewingSessionId: newlyViewedSessionId });
        }
        this.currentViewingSessionId = newlyViewedSessionId;
    }

    async findNextExperience(sessionId) {
        if (this.isTransitioning) return;
        this.isTransitioning = true;
        this.hangUp();
        this.uiController.setLoader(true);
    
        try {
            const url = sessionId ? `/stream-session?sessionId=${sessionId}` : `/random-stream?excludeSessionId=${this.sessionId}`;
            const response = await this.fetch(url);
    
            if (!response.ok) {
                throw new Error("Nessun utente trovato o errore server");
            }
            const data = await response.json();
            
            // MODIFICA: Aggiorna lo stato di visualizzazione
            this._updateViewingStatus(data.sessionId);

            if (data.sessionId.endsWith('_THEIA')) {
                this.uiController.transitionToSlide(this.theiaSlide);
                if (this.theiaInstance) this.theiaInstance.unmute();
                this.theiaRunning = true;
            } else {
                const userSlide = this.uiController.createSlideForStream(data.sessionId, data.whepUrl);
                this.uiController.transitionToSlide(userSlide);
                if (this.theiaInstance) this.theiaInstance.mute();
                this.theiaRunning = false;
            }
            this.socialLayer.setupLikesListener(data.sessionId);
        } catch (err) {
            console.warn(err.message + ", mostro Theia.");
            
            // MODIFICA: Aggiorna lo stato anche in caso di fallback a Theia
            const theiaSessionId = `${this.sessionId}_THEIA`;
            this._updateViewingStatus(theiaSessionId);

            this.uiController.transitionToSlide(this.uiController.theiaSlide);
            if (!this.theiaRunning) {
                if (this.theiaInstance) this.theiaInstance.unmute();
            }
            this.theiaRunning = true;
        }
    }
    
    connectToSession(sessionId) {
        if (!sessionId || sessionId.length !== 6) {
            console.error("ID sessione non valido.");
            return;
        }
        this.uiController._hideDialpad();
        this.uiController.switchToSliderView();
        this.findNextExperience(sessionId); // La logica di notifica è già in findNextExperience
    }
    
    async getOrCreateStreamSession(sourceStream) {
        if (!sourceStream) return console.error("Source stream non fornito.");
        try {
            const response = await this.fetch('/stream-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.sessionId })
            });
            if (!response.ok) throw new Error(`Errore dal server: ${response.statusText}`);
            const sessionData = await response.json();
            if (this.livepeerConnection) this.livepeerConnection.close();
            this.livepeerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] });
            sourceStream.getTracks().forEach(track => this.livepeerConnection.addTrack(track, sourceStream));
            const offer = await this.livepeerConnection.createOffer();
            await this.livepeerConnection.setLocalDescription(offer);
            const whipResponse = await this.fetch(sessionData.whipUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/sdp' },
                body: this.livepeerConnection.localDescription.sdp
            });
            if (whipResponse.status !== 201) throw new Error(`Connessione WHIP fallita: ${whipResponse.statusText}`);

            const whepUrl = whipResponse.headers.get('livepeer-playback-url').replace('fra-ai-mediamtx-0.livepeer.com', 'ai.livepeer.com');
            if (!whepUrl) throw new Error('Header livepeer-playback-url mancante.');

            await this.fetch('/update-whep-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.sessionId, whepUrl })
            });
            const answerSdp = await whipResponse.text();
            await this.livepeerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
            this.uiController.setUpdateBtnState(false);
            this.uiController.handleStartPlayback(this.uiController.originalPlaybackVideo, whepUrl);
            this.socialLayer.setupLikesListener(this.sessionId);
            this._preloadTheia();
            this.uiController.enableExploreMode();

        } catch (error) {
            console.error('Errore getOrCreateStreamSession:', error);
        }
    }
    
    setupAudioPeerConnection() {
        if (this.p2pAudioConnection) this.p2pAudioConnection.close();
        this.p2pAudioConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        this.localAudioSubStream.getTracks().forEach(track => {
            this.p2pAudioConnection.addTrack(track, this.localAudioSubStream);
        });
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        this.p2pAudioConnection.ontrack = (event) => {
            if (event.track.kind === 'audio') {
                this.audioSource = this.audioContext.createMediaStreamSource(event.streams[0]);
                this.delayNode = this.audioContext.createDelay(3.0); 
                this.delayNode.delayTime.value = 0.5;
                this.audioSource.connect(this.delayNode);
                this.delayNode.connect(this.audioContext.destination);
            }
        };
        this.p2pAudioConnection.onicecandidate = (event) => {
            if (event.candidate && this.currentAudioPartnerSocketId) {
                this.socket.emit('audio-ice-candidate', { candidate: event.candidate, targetSocketId: this.currentAudioPartnerSocketId });
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
        if (this.audioSource) {
            this.audioSource.disconnect();
            this.audioSource = null;
        }
        if (this.delayNode) {
            this.delayNode.disconnect();
            this.delayNode = null;
        }
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close().then(() => this.audioContext = null);
        }
        const remoteAudioEl = document.getElementById('remote-audio');
        if (remoteAudioEl) remoteAudioEl.remove();
        this.currentAudioPartnerSocketId = null;
    }
    
    _preloadTheia() {
        if (this.theiaInstance || !this.localAudioSubStream) return;
        this.theiaSlide.dataset.sessionId = `${this.sessionId}_THEIA`;
        this.theiaInstance = new Theia(this.sessionId);
        const theiaVideoEl = this.theiaSlide.querySelector('.playback-video');
        this.theiaInstance.start(this.localAudioSubStream, theiaVideoEl);
    }
}
