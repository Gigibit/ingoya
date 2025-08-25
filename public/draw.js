
const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('sessionId');
const joinContainer = document.getElementById('join-container');
const codeInputContainer = document.getElementById('code-input');
const ___INITIAL_PROMPT_VALUE = "describe Noah.";
const ___INITIAL_NEGATIVE_PROMPT_VALUE = "blurry, low quality, flat, 2d"
// --- ✨ LOGICA JAVASCRIPT INVERTITA ---
if (sessionId || window.selfMode) {
    // Se l'ID è nell'URL, nascondi l'overlay del form di join.

    if(!window.selfMode){

        joinContainer.style.display = 'none';
        // Tutta la logica dell'app può ora partire, sapendo che il canvas è visibile.
        const socket = io();
        socket.on('connect', () => {
            console.log(`Connesso al server. In attesa di join...`);
            socket.emit('join-session', sessionId);
        });

        socket.on('session-joined', (confirmedSessionId) => {
            console.log(`Conferma ricevuta: unito alla sessione ${confirmedSessionId}`);
            // Ora puoi inviare l'URL, ma è meglio farlo dopo aver creato lo stream
        });
    }
    const fluidCanvas = document.getElementById('fluidCanvas');
    const API_KEY = "sk_iK9uX4DPSmmGekB8McXnJGEKB3wWWozjtKKjUKa3WBVirYxMtXL5GLrZiTJZQ8Pb";
    const API_BASE_URL = "https://api.daydream.live";
    const PIPELINE_ID = "pip_qpUgXycjWF6YMeSL";

    let streamId = null, whipUrl = null, playbackId = null, peerConnection = null, canvasStream = null;

    const updateBtn = document.getElementById('update-params-btn');
    const promptInput = document.getElementById('prompt');
    
    async function handleStartStream() {
        try {
            canvasStream = fluidCanvas.captureStream();
            const initPayload = {
                "name": "Stream (Streamdiffusion)",
                "pipeline_id": PIPELINE_ID,
                "pipeline_params": {
                    "model_id": "stabilityai/sd-turbo",
                    "prompt": ___INITIAL_PROMPT_VALUE,
                    "prompt_interpolation_method": "slerp",
                    "normalize_prompt_weights": true,
                    "normalize_seed_weights": true,
                    "negative_prompt": ___INITIAL_NEGATIVE_PROMPT_VALUE,
                    // "num_inference_steps": 50,
                    // "seed": 42,
                    // "t_index_list": [
                    //     2,
                    //     4,
                    //     6
                    // ],
                    // "controlnets": [
                    //     {
                    //         "conditioning_scale": 0,
                    //         "control_guidance_end": 1,
                    //         "control_guidance_start": 0,
                    //         "enabled": true,
                    //         "model_id": "thibaud/controlnet-sd21-openpose-diffusers",
                    //         "preprocessor": "pose_tensorrt",
                    //         "preprocessor_params": {}
                    //     },
                    //     {
                    //         "conditioning_scale": 0,
                    //         "control_guidance_end": 1,
                    //         "control_guidance_start": 0,
                    //         "enabled": true,
                    //         "model_id": "thibaud/controlnet-sd21-hed-diffusers",
                    //         "preprocessor": "soft_edge",
                    //         "preprocessor_params": {}
                    //     },
                    //     {
                    //         "conditioning_scale": 0,
                    //         "control_guidance_end": 1,
                    //         "control_guidance_start": 0,
                    //         "enabled": true,
                    //         "model_id": "thibaud/controlnet-sd21-canny-diffusers",
                    //         "preprocessor": "canny",
                    //         "preprocessor_params": {
                    //             "high_threshold": 200,
                    //             "low_threshold": 100
                    //         }
                    //     },
                    //     {
                    //         "conditioning_scale": 0,
                    //         "control_guidance_end": 1,
                    //         "control_guidance_start": 0,
                    //         "enabled": true,
                    //         "model_id": "thibaud/controlnet-sd21-depth-diffusers",
                    //         "preprocessor": "depth_tensorrt",
                    //         "preprocessor_params": {}
                    //     },
                    //     {
                    //         "conditioning_scale": 0,
                    //         "control_guidance_end": 1,
                    //         "control_guidance_start": 0,
                    //         "enabled": true,
                    //         "model_id": "thibaud/controlnet-sd21-color-diffusers",
                    //         "preprocessor": "passthrough",
                    //         "preprocessor_params": {}
                    //     }
                    // ]
                }

            }
            const createStreamResponse = await fetch(`${API_BASE_URL}/v1/streams`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(initPayload)
            });
            if (!createStreamResponse.ok) throw new Error(`API Error: ${createStreamResponse.statusText}`);
            const streamData = await createStreamResponse.json();
            streamId = streamData.id;
            whipUrl = streamData.whip_url;
            playbackId = streamData.output_playback_id;

            const liveSessionURL = `https://lvpr.tv/?v=${playbackId}&lowLatency=force&controls=none`;
            console.log(`Stream creato, invio URL: ${liveSessionURL}`);
            if(!window.selfMode) socket.emit('share-url', { sessionId: sessionId, url: liveSessionURL });
            else document.getElementById('video-iframe').src = liveSessionURL
            peerConnection = new RTCPeerConnection();
            canvasStream.getTracks().forEach(track => peerConnection.addTrack(track, canvasStream));
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            const whipResponse = await fetch(whipUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/sdp' },
                body: peerConnection.localDescription.sdp
            });
            if (!whipResponse.ok) throw new Error(`WHIP connection failed: ${whipResponse.statusText}`);
            const answerSdp = await whipResponse.text();
            await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
            updateBtn.disabled = false;
        } catch (error) {
            console.error('Error starting stream:', error);
        }
    }

   async function handleUpdateParams() {
    if (!streamId) return;
    updateBtn.disabled = true;

    // Aggiungiamo il negative_prompt anche qui!
    const paramsPayload = { 
        "params": { 
            "prompt": promptInput.value, 
            "negative_prompt": ___INITIAL_NEGATIVE_PROMPT_VALUE, // <-- ✨ RIGA AGGIUNTA
            "model_id": "stabilityai/sd-turbo", 
            "prompt_interpolation_method": "slerp", 
            "normalize_prompt_weights": true, 
            "normalize_seed_weights": true, 
            "num_inference_steps": 50, 
            "seed": 42, 
            "t_index_list": [2, 4, 6]
            // "controlnets": [
            //     // ... (il tuo array di controlnets rimane qui, invariato)
            //     { "conditioning_scale": 0, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-openpose-diffusers", "preprocessor": "pose_tensorrt", "preprocessor_params": {} }, 
            //     { "conditioning_scale": 0, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-hed-diffusers", "preprocessor": "soft_edge", "preprocessor_params": {} }, 
            //     { "conditioning_scale": 0, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-canny-diffusers", "preprocessor": "canny", "preprocessor_params": { "high_threshold": 200, "low_threshold": 100 } }, 
            //     { "conditioning_scale": 0, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-depth-diffusers", "preprocessor": "depth_tensorrt", "preprocessor_params": {} }, 
            //     { "conditioning_scale": 0, "control_guidance_end": 1, "control_guidance_start": 0, "enabled": true, "model_id": "thibaud/controlnet-sd21-color-diffusers", "preprocessor": "passthrough", "preprocessor_params": {} }
            // ] 
        } 
    };
    
    try {
        const response = await fetch(`${API_BASE_URL}/v1/streams/${streamId}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'x-client-source': 'streamdiffusion-web', 'Content-Type': 'application/json' },
            body: JSON.stringify(paramsPayload)
        });
        if (!response.ok) throw new Error(`API Update Error: ${response.statusText}`);
        
        // La pulizia dell'input va bene qui
        promptInput.value = '';

    } catch (error) {
        console.error('Error updating parameters:', error);
    } finally {
        updateBtn.disabled = false;
    }
}
    window.handleUpdateParams = handleUpdateParams
    setTimeout(handleStartStream, 2000);
    updateBtn.addEventListener('click', handleUpdateParams);
    promptInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !updateBtn.disabled) {
            event.preventDefault();
            updateBtn.click();
        }
    });
} else if (!window.selfMode){
    // Se l'ID NON è nell'URL, l'overlay #join-container è già visibile.
    // Aggiungiamo solo la logica al pulsante "Unisciti".
    const joinBtn = document.getElementById('join-btn');
    const codeInput = document.getElementById('code-input');
    joinContainer.style.display = '';
    joinContainer.style.position = 'fixed';

    joinBtn.addEventListener('click', () => {
        const code = codeInput.value.trim().toUpperCase();
        if (code.length === 6) {
            window.location.href = `${window.location.pathname}?sessionId=${code}`;
        } else {
            alert('Il codice deve essere di 6 caratteri.');
        }
    });
    codeInput.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') joinBtn.click();
    });
}
