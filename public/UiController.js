// o gioia, ch'io conobbi, esser amato amando!
export class UiController {
    constructor(connectionManager) {
        this.connectionManager = connectionManager;
        this.sessionId = null;
        
        this.isSliderViewActive = false;
        this.isConfigOverlayActive = false;
        this.canExplore = false;

        // Riferimenti ai moduli esterni
        this.socialLayer = null;

        // Elementi DOM
        this.originalPlaybackVideo = document.getElementById('playback-video');
        this.localPreviewOverlay = document.getElementById('local-preview-overlay');
        this.controlsSection = document.getElementById('controls-section');
        this.promptInput = document.getElementById('prompt');
        this.updateBtn = document.getElementById('update-params-btn');
        this.cameraButton = document.getElementById('camera-button');
        this.muteBtn = document.getElementById('mute-btn');
        this.fullscreenBtn = document.getElementById('fullscreen-btn');
        this.dialpadOverlay = document.getElementById('dialpad-overlay');
        this.dialpadInput = document.getElementById('dialpad-input');
        this.mainTitle = document.getElementById('main-title');
        this.theiaSlide = document.getElementById('theia-slide');
    }
    
    setSessionId(sessionId) {
        this.sessionId = sessionId;
        if (this.socialLayer) {
            this.socialLayer.setupLikesListener(sessionId);
        }
    }

    setupEventListeners() {
        this.cameraButton.addEventListener('click', () => this.connectionManager.toggleVideoSource());
        this.updateBtn.addEventListener('click', () => this.connectionManager.handleUpdateParams(this.promptInput.value));
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
                e.preventDefault(); 
                this.connectionManager.handleUpdateParams(this.promptInput.value);
            }
        });
        this.promptInput.addEventListener('input', () => {
            if (this.updateBtn) {
                this.updateBtn.classList.toggle('has-text', this.promptInput.value.trim() !== '');
            }
        });
        document.addEventListener('usermessageinterpolation', (e) => {
            if (this.connectionManager.socket) {
                this.connectionManager.socket.emit('share-user-message', { sessionId: this.sessionId, text: e.detail.text, interpolation: e.detail.interpolation });
            }
            this.connectionManager.handleUpdateParams(e.detail.interpolation);
        });
        if (this.fullscreenBtn) {
            this.fullscreenBtn.addEventListener('click', () => this._toggleFullScreen());
        }
        if (this.muteBtn) {
            this.muteBtn.addEventListener('click', () => this._toggleMute());
        }
        document.addEventListener('fullscreenchange', () => this._handleFullscreenChange());
        
        // Listener per il pulsante di chiamata
        document.getElementById('call-button').addEventListener('click', () => this._showDialpad());
        document.getElementById('dialpad-dismiss').addEventListener('click', () => this._hideDialpad());
        document.getElementById('dialpad-connect').addEventListener('click', () => this.connectionManager.connectToSession(this.dialpadInput.value));
        
        // Listener per i bottoni del tastierino
        document.querySelectorAll('.keypad-button').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const key = button.dataset.key;
                if (key === 'Z' || (key >= '0' && key <= '9')) {
                    if (this.dialpadInput.value.length < 6) {
                        this.dialpadInput.value += key;
                    }
                } else if (key === 'backspace') {
                    this.dialpadInput.value = this.dialpadInput.value.slice(0, -1);
                }
            });
        });

        // Listener per chiudere il tastierino cliccando sull'overlay
        this.dialpadOverlay.addEventListener('click', (e) => {
            if (e.target.id === 'dialpad-overlay') {
                this._hideDialpad();
            }
        });
        this.enableExploreMode();
        this._setupInitialAnimation();
    }
    
    // Gestisce l'animazione iniziale del titolo
    _setupInitialAnimation() {
        if (this.mainTitle) {
            this.mainTitle.classList.add('initial-fade-out');
        }
    }

    toggleConfigOverlay() {
        this.isConfigOverlayActive = !this.isConfigOverlayActive;
        document.body.classList.toggle('config-overlay-active', this.isConfigOverlayActive);
        this.controlsSection.style.opacity = this.isConfigOverlayActive ? '1' : '0';
        if (this.isConfigOverlayActive) this.connectionManager.hangUp();
    }

    enableExploreMode() {
        if (this.canExplore) return;
        this.canExplore = true;

        const exploreHandler = () => {
            if (!this.isSliderViewActive) {
                this.switchToSliderView();
            }
            this.connectionManager.findNextExperience();
        };

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

    switchToSliderView() {
        if (this.isSliderViewActive) return;
        this.isSliderViewActive = true;
        document.body.classList.add('slider-view-active');
        this.connectionManager.streamContainer = document.createElement('div');
        this.connectionManager.streamContainer.id = 'stream-container';
        document.body.appendChild(this.connectionManager.streamContainer);
        this.originalPlaybackVideo.classList.add('mini-video');
        document.body.appendChild(this.originalPlaybackVideo);
        this.controlsSection.style.opacity = '0';
    }

    _showDialpad() {
        this.dialpadOverlay.classList.remove('hidden');
        this.dialpadOverlay.classList.add('visible');
        this.dialpadInput.value = '';
    }

    _hideDialpad() {
        this.dialpadOverlay.classList.remove('visible');
        this.dialpadOverlay.classList.add('hidden');
    }

    _toggleMute() {
        const isCurrentlyUnmuted = document.body.classList.contains('audio-unmuted');
        document.body.classList.toggle('audio-unmuted');
        if (this.connectionManager.theiaInstance) {
             this.connectionManager.theiaInstance[isCurrentlyUnmuted ? 'mute' : 'unmute']();
        }
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
    
    // Metodi aggiunti per la modularizzazione
    setLocalPreviewStream(stream) {
        this.localPreviewOverlay.srcObject = stream;
        this.localPreviewOverlay.play().catch(e => {});
        this.localPreviewOverlay.style.opacity = '1';
    }
    
    alert(message) {
        const alertBox = document.createElement('div');
        alertBox.className = 'custom-alert';
        alertBox.textContent = message;
        document.body.appendChild(alertBox);
        setTimeout(() => {
            alertBox.remove();
        }, 5000);
    }

    setUpdateBtnState(disabled) {
        this.updateBtn.disabled = disabled;
    }

    clearPromptInput() {
        this.promptInput.value = '';
    }

    dispatchEventToPromptInput() {
        this.promptInput.dispatchEvent(new Event('input'));
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
                    this.setLoader(false);

                    if (targetVideoElement.id === 'playback-video') {
                        this.setLocalPreviewOpacity(0);
                        this.removeLocalPreviewOverlay();
                        targetVideoElement.muted = true;
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
    
    setLocalPreviewOpacity(opacity) {
        this.localPreviewOverlay.style.opacity = opacity;
    }

    removeLocalPreviewOverlay() {
        this.localPreviewOverlay.addEventListener('transitionend', () => this.localPreviewOverlay.remove(), { once: true });
    }

    setLoader(show) {
        const loader = document.getElementById('loader');
        if (loader) {
            loader.style.display = show ? 'flex' : 'none';
        }
    }
    
    createSlideForStream(sessionId, whepUrl) {
        const slide = document.createElement('div');
        slide.className = 'slide';
        slide.dataset.sessionId = sessionId;
        slide.innerHTML = `<video class="playback-video" autoplay playsinline muted></video>`;
        document.body.appendChild(slide); // Usa body perché `streamContainer` non è ancora disponibile

        const videoEl = slide.querySelector('.playback-video');
        this.handleStartPlayback(videoEl, whepUrl);
        return slide;
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
    transitionToSlide(nextSlide) {
        const currentSlide = document.querySelector('.slide.is-visible');

        if (currentSlide === nextSlide) {
            this.setLoader(false);
            setTimeout(() => {
                this.connectionManager.isTransitioning = false;
            }, 2000);
            return;
        }
        
        if (nextSlide.dataset.sessionId.endsWith('_THEIA')) {
            this.setLoader(false);
        }

        if (nextSlide.dataset.sessionId === `${this.sessionId}_THEIA`) {
            this._fadeAudio(false);
        } else if (currentSlide && currentSlide.dataset.sessionId.endsWith('_THEIA')) {
            this._fadeAudio(true);
        }

        if (nextSlide.parentElement !== document.body) {
            document.body.appendChild(nextSlide);
        }
        nextSlide.style.display = 'block';

        requestAnimationFrame(() => {
            nextSlide.classList.add('is-visible');
            if (currentSlide) {
                currentSlide.classList.remove('is-visible');
                currentSlide.addEventListener('transitionend', () => {
                    if (currentSlide.id !== 'theia-slide') {
                        currentSlide.remove();
                    } else {
                        currentSlide.style.display = 'none';
                    }
                }, { once: true });
            }

            setTimeout(() => {
                this.connectionManager.isTransitioning = false;
                const streamerSessionId = nextSlide.dataset.sessionId;
                if (!streamerSessionId.endsWith('_THEIA') && this.connectionManager.localAudioSubStream) {
                    this.connectionManager.socket.emit('request-audio-call', { streamerSessionId });
                }
            }, 2000);
        });
    }

    setMainTitleOpacity(opacity) {
        if (this.mainTitle) {
            this.mainTitle.style.opacity = opacity;
        }
    }
    
    isCameraActive() {
        return this.cameraButton.classList.contains('camera-enabled');
    }

    setCameraState(isActive) {
        if (this.cameraButton) {
            this.cameraButton.classList.toggle('camera-enabled', isActive);
        }
    }
}
