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

import {
  setupDatabase,
  createSession,
  getSessionForWhip,
  getSessionForWhep,
  saveWhipDetails,
  saveWhepUrlDetails,
  findOrCreateRequest,
  getStreamIdBySessionId,
  updateDbParticipantCount,
  getRandomActiveStream,
  getOrCreateTheiaSession
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


if (!OPENAI_API_KEY) throw new Error('missing OPENAI_API_KEY');

let db;
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// MODIFICA: Oggetto in-memory per tracciare gli spettatori in tempo reale
// Struttura: { streamerSessionId: Set('viewerSessionId1', 'viewerSessionId2') }
const viewersBySession = {};


function generateSessionId(length = 6) {
  const chars = 'Z0123456789';
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
    return 'moon, lips, tongue'
}

// --- ENDPOINT REST ( invariati ) ---

app.post('/stream-session', async (req, res) => {
  let { sessionId } = req.body;
  if (!sessionId) sessionId = generateSessionId(6)
  try {
    await createSession(db, sessionId);
    const existingSession = await getSessionForWhip(db, sessionId);

    if (existingSession) {
      return res.json(existingSession);
    }

    const createStreamResponse = await fetch(`${DAYDREAM_API_BASE_URL}/v1/streams`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${DAYDREAM_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `stream-${sessionId}`, pipeline_id: PIPELINE_ID, pipeline_params: DEFAULT_PIPELINE_PARAMS })
    });

    const streamData = await createStreamResponse.json();
    if (!createStreamResponse.ok) throw new Error(`API Error Livepeer: ${createStreamResponse.status} - ${streamData.error || 'Errore sconosciuto'}`);

    const { id: streamId, whip_url: whipUrl } = streamData;
    if (!whipUrl) throw new Error('whip_url mancante nella risposta di Livepeer.');

    await saveWhipDetails(db, sessionId, streamId, whipUrl);
    res.json({ streamId, sessionId, whipUrl });
  } catch (error) {
    console.error(`❌ Errore API /stream-session:`, error);
    res.status(500).json({ error: "Errore durante la creazione dello stream." });
  }
});
app.get('/stream-session', async (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: "Il parametro 'sessionId' è obbligatorio." });
  try {
    const session = await getSessionForWhep(db, sessionId); 
    if (!session || !session.whepUrl) {
      return res.status(404).json({ error: "Nessuna sessione di streaming attiva trovata con questo ID." });
    }
    res.json({ sessionId, whepUrl: session.whepUrl });
  } catch (error) {
    console.error(`❌ Errore API /stream-session GET:`, error);
    res.status(500).json({ error: "Errore durante il recupero dello stream." });
  }
});
app.post('/update-whep-url', async (req, res) => {
  const { sessionId, whepUrl } = req.body;
  if (!sessionId || !whepUrl) return res.status(400).json({ error: "sessionId e whepUrl sono obbligatori." });
  try {
    await saveWhepUrlDetails(db, sessionId, whepUrl);
    res.status(200).json({ message: "URL WHEP aggiornato con successo." });
  } catch (error) {
    console.error(`❌ Errore API /update-whep-url:`, error);
    res.status(500).json({ error: "Errore durante il salvataggio dell'URL WHEP." });
  }
});
app.post('/update-stream-params', async (req, res) => {
    const { sessionId, prompt } = req.body;
    if (!sessionId || !prompt) return res.status(400).json({ error: "sessionId e prompt sono obbligatori." });
    try {
        const streamId = await getStreamIdBySessionId(db, sessionId);
        if (!streamId) return res.status(404).json({ error: "Nessun streamId attivo trovato per questa sessione." });
        const paramsPayload = { "params": { "prompt": 'Mouth. Real Representation. ' + prompt + '. REAL, NOT drawn, NOT blurry, NOT low quality, NOT flat, NOT 2d"' } };
        const response = await fetch(`${DAYDREAM_API_BASE_URL}/v1/streams/${streamId}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${DAYDREAM_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(paramsPayload)
        });
        if (!response.ok) throw new Error(`API Update Error: ${response.statusText}`);
        res.status(200).json({ message: "Parametri dello stream aggiornati con successo." });
    } catch (error) {
        console.error(`❌ Errore API /update-stream-params:`, error);
        res.status(500).json({ error: "Errore durante l'aggiornamento dei parametri dello stream." });
    }
});
app.post('/theia-update-stream-params', async (req, res) => {
    const { sessionId, prompt } = req.body;
    if (!sessionId || !prompt) return res.status(400).json({ error: "sessionId e prompt sono obbligatori." });
    const lighter = `Sei il generatore di prompt di una pipeline di Stream Diffusion...: "${prompt}"`;
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: lighter }], temperature: 0 })
    });
    const data = await r.json();
    let advancedPrompt = data.choices?.[0]?.message?.content + `, ${getSense()}`
    try {
        const streamId = await getStreamIdBySessionId(db, sessionId);
        if (!streamId) return res.status(404).json({ error: "Nessun streamId attivo." });
        const paramsPayload = { "params": { "prompt": advancedPrompt  } };
        const response = await fetch(`${DAYDREAM_API_BASE_URL}/v1/streams/${streamId}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${DAYDREAM_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(paramsPayload)
        });
        if (!response.ok) throw new Error(`API Update Error: ${response.statusText}`);
        res.status(200).json({ message: "Parametri aggiornati." });
    } catch (error) {
        console.error(`❌ Errore API /theia-update-stream-params:`, error);
        res.status(500).json({ error: "Errore aggiornamento parametri." });
    }
});
app.use(async (req, _, next) => {
  const db = req.app.get('db'); 
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    await findOrCreateRequest(db, ip);
  } catch (err) {
    console.error("Errore conteggio IP:", err);
  }
  next();
});
app.get('/stats', async (req, res) => {
  const db = req.app.get('db');
  try {
    const allRequests = await db.all('SELECT * FROM requests ORDER BY lastRequestAt DESC');
    res.json(allRequests);
  } catch (err) { res.status(500).send("Impossibile recuperare le statistiche"); }
});
app.get('/random-stream', protectRoute, async (req, res) => {
  const { excludeSessionId } = req.query;
  if (!excludeSessionId) return res.status(400).json({ error: "excludeSessionId è obbligatorio." });
  try {
    let randomSession = await getRandomActiveStream(db, excludeSessionId);
    if (!randomSession) {
      const userTheiaSessionId = `${excludeSessionId}_THEIA`;
      randomSession = await getOrCreateTheiaSession(db, userTheiaSessionId);
    }
    if (randomSession && randomSession.whepUrl) {
      res.json({ sessionId: randomSession.sessionId, whepUrl: randomSession.whepUrl });
    } else {
      res.status(404).json({ message: "Nessun altro stream attivo trovato." });
    }
  } catch (err) {
    res.status(500).json({ error: "Errore interno del server." });
  }
});


// --- GESTIONE SOCKET.IO ---
io.on('connection', (socket) => {
  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    // MODIFICA: Associa il sessionId dell'utente al suo socket
    socket.userSessionId = sessionId;
    const room = io.sockets.adapter.rooms.get(sessionId);
    updateDbParticipantCount(db, sessionId, room ? room.size : 0);
  });
  
  // MODIFICA: Gestori per tracciare chi guarda chi
  socket.on('start-watching', ({ viewingSessionId }) => {
    if (!socket.userSessionId || !viewingSessionId) return;
    if (!viewersBySession[viewingSessionId]) {
      viewersBySession[viewingSessionId] = new Set();
    }
    viewersBySession[viewingSessionId].add(socket.userSessionId);
    console.log(`👀 ${socket.userSessionId} ha iniziato a guardare ${viewingSessionId}`);
  });

  socket.on('stop-watching', ({ wasViewingSessionId }) => {
    if (!socket.userSessionId || !wasViewingSessionId) return;
    if (viewersBySession[wasViewingSessionId]) {
      viewersBySession[wasViewingSessionId].delete(socket.userSessionId);
      console.log(`🙈 ${socket.userSessionId} ha smesso di guardare ${wasViewingSessionId}`);
    }
  });

  socket.on('get-participants', (requestingSessionId) => {
    const viewers = viewersBySession[requestingSessionId];
    if (viewers && viewers.size > 0) {
      socket.emit('participants-list', Array.from(viewers));
    } else {
      socket.emit('participants-list', []);
    }
  });

  socket.on('request-audio-call', ({ streamerSessionId }) => {
    socket.to(streamerSessionId).emit('audio-request-received', { visitorSocketId: socket.id });
  });
  socket.on('audio-offer', ({ offer, targetSocketId }) => {
    socket.to(targetSocketId).emit('audio-offer', { offer, streamerSocketId: socket.id });
  });
  socket.on('audio-answer', ({ answer, targetSocketId }) => {
    socket.to(targetSocketId).emit('audio-answer', answer);
  });
  socket.on('audio-ice-candidate', ({ candidate, targetSocketId }) => {
    socket.to(targetSocketId).emit('audio-ice-candidate', candidate);
  });
  socket.on('hang-up', ({ targetSocketId }) => {
    socket.to(targetSocketId).emit('hang-up');
  });
  socket.on('share-user-message', ({ sessionId, text, interpolation }) => {
    socket.to(sessionId).emit('user-message-received', { text, interpolation });
  });

  socket.on('disconnecting', () => {
    // MODIFICA: Pulisce lo stato di visualizzazione alla disconnessione
    if (socket.userSessionId) {
        for (const streamerSessionId in viewersBySession) {
            if (viewersBySession[streamerSessionId].has(socket.userSessionId)) {
                viewersBySession[streamerSessionId].delete(socket.userSessionId);
                console.log(`🔌 ${socket.userSessionId} disconnesso, rimosso dagli spettatori di ${streamerSessionId}`);
            }
        }
    }

    socket.rooms.forEach(sessionId => {
      if (sessionId !== socket.id) {
        const room = io.sockets.adapter.rooms.get(sessionId);
        const newParticipantCount = room ? room.size - 1 : 0;
        updateDbParticipantCount(db, sessionId, newParticipantCount);
      }
    });
  });
});

// --- ROUTE EXPRESS STATICHE ---
app.get('/ingoya', protectRoute, (_, res) => res.sendFile(path.join(__dirname, 'public', 'ingoya.html')));
app.get('/draw', (_, res) => res.sendFile(path.join(__dirname, "public", "draw.html")));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, "public", "login.html")));

app.post("/_interpret", protectRoute, async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(500).json({ error: "OpenAI API Key non configurata." });
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Manca testo" });
    const prompt = `Analizza il testo dell'utente...: "${text}"`;
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
  app.set('db', db)
  const authRouter = createAuthRouter(db);
  app.use('/auth', authRouter);
  app.use(lunaRouter);
  httpServer.listen(PORT, () => console.log(`🚀 Server avviato su http://localhost:${PORT}`));
}

startServer();
