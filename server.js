// --- IMPORTAZIONI E SETUP INIZIALE ---
import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import lunaRouter from './luna.router.js';
import createAuthRouter from './auth.router.js'; 
import cookieParser from 'cookie-parser';
import { protectRoute } from './auth.middleware.js';



// Importa sia il setup che le nuove funzioni di query
import {
  setupDatabase,
  createSession,
  getSessionForWhip,
  saveWhipDetails,
  saveWhepUrlDetails,
  getStreamIdBySessionId,
  updateDbParticipantCount,
  getRandomActiveStream,
  seedAiUser,
  getTheiaSession
} from './database.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.PORT || 3000;
const DAYDREAM_API_KEY = process.env.DAYDREAM_API_KEY;
const DAYDREAM_API_BASE_URL = "https://api.daydream.live";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PIPELINE_ID = "pip_qpUgXycjWF6YMeSL";
const DEFAULT_PIPELINE_PARAMS = { "model_id": "stabilityai/sd-turbo", "prompt": "fear of abbandonment.", "negative_prompt": "blurry, low quality, flat, 2d", "num_inference_steps": 50, "seed": 42, "t_index_list": [2, 4, 6], "controlnets": [{ "conditioning_scale": 0.4, "enabled": true, "model_id": "thibaud/controlnet-sd21-openpose-diffusers", "preprocessor": "pose_tensorrt" }, { "conditioning_scale": 0.14, "enabled": true, "model_id": "thibaud/controlnet-sd21-hed-diffusers", "preprocessor": "soft_edge" }, { "conditioning_scale": 0.27, "enabled": true, "model_id": "thibaud/controlnet-sd21-canny-diffusers", "preprocessor": "canny", "preprocessor_params": { "high_threshold": 200, "low_threshold": 100 } }, { "conditioning_scale": 0.34, "enabled": true, "model_id": "thibaud/controlnet-sd21-depth-diffusers", "preprocessor": "depth_tensorrt" }, { "conditioning_scale": 0.66, "enabled": true, "model_id": "thibaud/controlnet-sd21-color-diffusers", "preprocessor": "passthrough" }] };


if (!OPENAI_API_KEY)
  throw new Error('missing OPENAI_API_KEY')

let db;
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
function generateSessionId(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));


function getSense (){
    return 'mouth, taste, lips, tongue'
    // testing experience
    const numericalSenseRappresentation = Math.random();

    if( numericalSenseRappresentation < .2 ) return 'see, eyes'
    if( numericalSenseRappresentation < .4 ) return 'taste, lips, tongue'
    if( numericalSenseRappresentation < .6 ) return 'listen, ears'
    if( numericalSenseRappresentation < .8 ) return 'touches, hands'
    if( numericalSenseRappresentation <= 1 ) return 'smell, nose'



}

// --- ENDPOINT REST ---

app.post('/stream-session', protectRoute, async (req, res) => {
  let { sessionId } = req.body;
  if (!sessionId) sessionId = generateSessionId(6)
  try {
    await createSession(db, sessionId);
    const existingSession = await getSessionForWhip(db, sessionId);

    if (existingSession) {
      console.log(`✅ Trovata sessione WHIP esistente per ${sessionId}.`);
      return res.json(existingSession);
    }

    console.log(`🆕 Creazione nuovo stream su Livepeer per ${sessionId}...`);
    const createStreamResponse = await fetch(`${DAYDREAM_API_BASE_URL}/v1/streams`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${DAYDREAM_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `stream-${sessionId}`,
                              pipeline_id: PIPELINE_ID, 
                              pipeline_params: DEFAULT_PIPELINE_PARAMS 
                            })
    });

    const streamData = await createStreamResponse.json();
    if (!createStreamResponse.ok) {
      console.error("[DEBUG] Risposta di errore da Livepeer:", JSON.stringify(streamData, null, 2));
      throw new Error(`API Error Livepeer: ${createStreamResponse.status} - ${streamData.error || 'Errore sconosciuto'}`);
    }

    const { id: streamId, whip_url: whipUrl } = streamData;
    if (!whipUrl) {
      console.error("[DEBUG] Risposta Livepeer senza whip_url:", JSON.stringify(streamData, null, 2));
      throw new Error('whip_url mancante nella risposta di Livepeer.');
    }
    console.log(res)

    await saveWhipDetails(db, sessionId, streamId, whipUrl);
    res.json({ streamId, sessionId, whipUrl });
  } catch (error) {
    console.error(`❌ Errore API /stream-session:`, error);
    res.status(500).json({ error: "Errore durante la creazione dello stream." });
  }
});

app.post('/update-whep-url', protectRoute, async (req, res) => {
  const { sessionId, whepUrl } = req.body;
  if (!sessionId || !whepUrl) {
    return res.status(400).json({ error: "sessionId e whepUrl sono obbligatori." });
  }
  try {
    await saveWhepUrlDetails(db, sessionId, whepUrl);
    res.status(200).json({ message: "URL WHEP aggiornato con successo." });
  } catch (error) {
    console.error(`❌ Errore API /update-whep-url:`, error);
    res.status(500).json({ error: "Errore durante il salvataggio dell'URL WHEP." });
  }
});
app.post('/update-stream-params', protectRoute, async (req, res) => {
    const { sessionId, prompt } = req.body;
    if (!sessionId || !prompt) {
        return res.status(400).json({ error: "sessionId e prompt sono obbligatori." });
    }

    try {
        const streamId = await getStreamIdBySessionId(db, sessionId);
        if (!streamId) {
            return res.status(404).json({ error: "Nessun streamId attivo trovato per questa sessione." });
        }

        console.log(`[DEBUG] Aggiornamento stream ${streamId} per sessione ${sessionId}`);

        const paramsPayload = { "params": { "prompt": prompt + '. REAL, NOT drawn, NOT blurry, NOT low quality, NOT flat, NOT 2d"' } };
        const response = await fetch(`${DAYDREAM_API_BASE_URL}/v1/streams/${streamId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${DAYDREAM_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(paramsPayload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("[DEBUG] Errore da Livepeer durante l'aggiornamento:", JSON.stringify(errorData, null, 2));
            throw new Error(`API Update Error: ${response.statusText}`);
        }

        res.status(200).json({ message: "Parametri dello stream aggiornati con successo." });

    } catch (error) {
        console.error(`❌ Errore API /update-stream-params:`, error);
        res.status(500).json({ error: "Errore durante l'aggiornamento dei parametri dello stream." });
    }
});
app.post('/theia-update-stream-params', protectRoute, async (req, res) => {
    const { sessionId, prompt } = req.body;
    if (!sessionId || !prompt) {
        return res.status(400).json({ error: "sessionId e prompt sono obbligatori." });
    }
    const lighter = `
      Sei il generatore di prompt di una pipeline di Stream Diffusion cerca di raccontare in un prompt come rappresentare graficamente questa frase, sii quanto più veloce e sintetica possibile, scrivi solo una frase  e in inglese: "${prompt}"
    `;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: lighter }],
        temperature: 0
      })
    });

    const data = await r.json();
    console.log(data.choices?.[0]?.message)
    let advancedPrompt = data.choices?.[0]?.message?.content + `, ${getSense()}`
    console.log(`🤔 Nuovo prompt ${advancedPrompt}`)
    try {
        const streamId = await getStreamIdBySessionId(db, sessionId);
        if (!streamId) {
            return res.status(404).json({ error: "Nessun streamId attivo trovato per questa sessione." });
        }

        console.log(`[DEBUG] Aggiornamento stream ${streamId} per sessione ${sessionId}`);

        const paramsPayload = { "params": { "prompt": advancedPrompt  } };
        const response = await fetch(`${DAYDREAM_API_BASE_URL}/v1/streams/${streamId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${DAYDREAM_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(paramsPayload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("[DEBUG] Errore da Livepeer durante l'aggiornamento:", JSON.stringify(errorData, null, 2));
            throw new Error(`API Update Error: ${response.statusText}`);
        }

        res.status(200).json({ message: "Parametri dello stream aggiornati con successo." });

    } catch (error) {
        console.error(`❌ Errore API /update-stream-params:`, error);
        res.status(500).json({ error: "Errore durante l'aggiornamento dei parametri dello stream." });
    }
});

app.get('/random-stream', protectRoute, async (req, res) => {
  const { excludeSessionId } = req.query;
  if (!excludeSessionId) {
    return res.status(400).json({ error: "Il parametro excludeSessionId è obbligatorio." });
  }
  try {
    // 1. Cerca prima un utente umano
    let randomSession = await getRandomActiveStream(db, excludeSessionId);
    
    // 2. Se non trova un umano, cerca Theia
    if (!randomSession) {
      console.log("🤔 Nessun utente umano trovato. Cerco Theia come fallback.");
      randomSession = await getTheiaSession(db);
    }
    if (randomSession && (randomSession.whepUrl || randomSession.sessionId === 'THEIA_SESSION')) {
      res.json({ sessionId: randomSession.sessionId, whepUrl: randomSession.whepUrl });
    } else {
      res.status(404).json({ message: "Nessun altro stream attivo trovato, inclusa Theia." });
    }
  } catch (err) {
    console.error("Errore durante la ricerca di uno stream casuale:", err.message);
    res.status(500).json({ error: "Errore interno del server." });
  }
});


// --- GESTIONE SOCKET.IO ---
io.on('connection', (socket) => {
  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    console.log(`🔗 Utente ${socket.id} si è unito alla sessione ${sessionId}`);
    const room = io.sockets.adapter.rooms.get(sessionId);
    updateDbParticipantCount(db, sessionId, room ? room.size : 0);
  });

  // --- LOGICA PER CHIAMATA AUDIO DINAMICA ---
  socket.on('request-audio-call', ({ streamerSessionId }) => {
    console.log(`📞 Richiesta di chiamata da ${socket.id} alloy la sessione ${streamerSessionId}`);
    socket.to(streamerSessionId).emit('audio-request-received', { visitorSocketId: socket.id });
  });
  socket.on('audio-offer', ({ offer, targetSocketId }) => {
    console.log(`📤 Inoltro offerta da ${socket.id} a ${targetSocketId}`);
    socket.to(targetSocketId).emit('audio-offer', { offer, streamerSocketId: socket.id });
  });
  socket.on('audio-answer', ({ answer, targetSocketId }) => {
    console.log(`✅ Inoltro risposta da ${socket.id} a ${targetSocketId}`);
    socket.to(targetSocketId).emit('audio-answer', answer);
  });
  socket.on('audio-ice-candidate', ({ candidate, targetSocketId }) => {
    socket.to(targetSocketId).emit('audio-ice-candidate', candidate);
  });
  socket.on('hang-up', ({ targetSocketId }) => {
    console.log(`👋 ${socket.id} ha riagganciato con ${targetSocketId}`);
    socket.to(targetSocketId).emit('hang-up');
  });

  // --- ALTRI GESTORI SOCKET ---
  socket.on('share-user-message', ({ sessionId, text, interpolation }) => {
    console.log(`🚀 Messaggio utente: ${text}`);
    socket.to(sessionId).emit('user-message-received', { text, interpolation });
  });

  socket.on('disconnecting', () => {
    socket.rooms.forEach(sessionId => {
      if (sessionId !== socket.id) {
        const room = io.sockets.adapter.rooms.get(sessionId);
        const currentCount = room ? room.size : 1;
        updateDbParticipantCount(db, sessionId, currentCount - 1);
      }
    });
  });
});

// --- ROUTE EXPRESS STATICHE ---
app.get('/ingoya', protectRoute, (_, res) => res.sendFile(path.join(__dirname, 'public', 'ingoya.html')));
app.get('/draw', (_, res) => res.sendFile(path.join(__dirname, "public", "draw.html")));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, "public", "login.html")));

app.post("/interpret", protectRoute, async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(500).json({ error: "OpenAI API Key non configurata." });
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Manca testo" });
    const prompt = `
      Analizza il testo dell'utente e restituisci una SEMPRE E SOLO UNA lista di 7 keywords riassuntive ed esplicative separate da una virgola (eg. "dio, relgione, musica, solitudine, compagnia..").
      Riconosci se nel testo è contenuto il desiderio di essere un personaggio Famoso, un mestiere o qualsiasi cosa, e.g. "voglio essere Elon Musk" o "Francisco Goya" o "un soldato", nel caso non lo fosse o comunque fosse conversazionale restituisci esclusivamente il carattere ".".
      il testo è il seguente: "${text}"
      `;
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0 })
    });
    const data = await r.json();
    let responseText = data.choices?.[0]?.message?.content.trim();
    res.json(responseText);
  } catch (err) {
    console.error("Errore interpretazione comando:", err);
    res.status(500).json({ error: err.message });
  }
});


// --- FUNZIONE DI AVVIO SERVER ---
async function startServer() {
  db = await setupDatabase();
  
  // --- MONTAGGIO DEI ROUTER ---
  // Ora passiamo 'db' e altre dipendenze direttamente ai router
  const authRouter = createAuthRouter(db);
  await seedAiUser(db);

  app.use('/auth', authRouter);
  app.use(lunaRouter);

  httpServer.listen(PORT, () => console.log(`🚀 Server avviato su http://localhost:${PORT}`));
}

startServer();

