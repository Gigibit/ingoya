// --- IMPORTAZIONI E SETUP INIZIALE ---
import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import lunaRouter from './luna.router.js';

// Importa sia il setup che le nuove funzioni di query
import { 
    setupDatabase, 
    createSession,
    getSessionForWhip,
    saveWhipDetails,
    saveWhepUrlDetails,
    updateDbParticipantCount,
    getRandomActiveStream
} from './database.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.PORT || 3000;
const API_KEY = "sk_iK9uX4DPSmmGekB8McXnJGEKB3wWWozjtKKjUKa3WBVirYxMtXL5GLrZiTJZQ8Pb";
const API_BASE_URL = "https://api.daydream.live";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error('missing OPENAI_API_KEY')
}
let db;
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.json());
app.use(express.static("public"));

// --- ENDPOINT REST ---

app.post('/stream-session', async (req, res) => {
    const { sessionId, pipeline_params } = req.body;
    if (!sessionId || !pipeline_params) {
        return res.status(400).json({ error: "sessionId e pipeline_params sono obbligatori." });
    }
    try {
        await createSession(db, sessionId);
        const existingSession = await getSessionForWhip(db, sessionId);

        if (existingSession) {
            console.log(`✅ Trovata sessione WHIP esistente per ${sessionId}.`);
            return res.json(existingSession);
        }

        console.log(`🆕 Creazione nuovo stream su Livepeer per ${sessionId}...`);
        const createStreamResponse = await fetch(`${API_BASE_URL}/v1/streams`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: `stream-${sessionId}`, ...pipeline_params })
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

        await saveWhipDetails(db, sessionId, streamId, whipUrl);
        res.json({ streamId, whipUrl });

    } catch (error) {
        console.error(`❌ Errore API /stream-session:`, error);
        res.status(500).json({ error: "Errore durante la creazione dello stream." });
    }
});

app.post('/update-whep-url', async (req, res) => {
    const { sessionId, whepUrl } = req.body;
    if (!sessionId || !whepUrl) {
        return res.status(400).json({ error: "sessionId e whepUrl sono obbligatori." });
    }
    try {
        await saveWhepUrlDetails(db, sessionId, whepUrl);
        res.status(200).json({ message: "URL WHEP aggiornato con successo." });
    } catch (error){
        console.error(`❌ Errore API /update-whep-url:`, error);
        res.status(500).json({ error: "Errore durante il salvataggio dell'URL WHEP." });
    }
});

app.get('/random-stream', async (req, res) => {
    const { excludeSessionId } = req.query;
    if (!excludeSessionId) {
        return res.status(400).json({ error: "Il parametro excludeSessionId è obbligatorio." });
    }
    try {
        const randomSession = await getRandomActiveStream(db, excludeSessionId);
        if (randomSession && randomSession.whepUrl) {
            res.json({ sessionId: randomSession.sessionId, url: randomSession.whepUrl });
        } else {
            res.status(404).json({ message: "Nessun altro stream attivo trovato." });
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
        console.log(`📞 Richiesta di chiamata da ${socket.id} verso la sessione ${streamerSessionId}`);
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
app.get('/self-drawing', (_, res) => res.sendFile(path.join(__dirname, 'public', 'self_drawing.html')));
app.get('/paint', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/draw', (_, res) => res.sendFile(path.join(__dirname, "public", "draw.html")));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, "public", "summarize.html")));
app.post("/interpret", async (req, res) => {
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
// --- ENDPOINT PER LUNA E OPENAI ---
app.use(lunaRouter);

// --- FUNZIONE DI AVVIO SERVER ---
async function startServer() {
  db = await setupDatabase();
  httpServer.listen(PORT, () => console.log(`🚀 Server avviato su http://localhost:${PORT}`));
}

startServer();

