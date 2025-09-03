// --- IMPORTAZIONI E SETUP INIZIALE ---
import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
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

// --- ENDPOINT PER LUNA E OPENAI ---
app.get('/luna', (_, res) => res.sendFile(path.join(__dirname, 'public/luna/public', 'index.html')));

app.post("/interpret", async (req, res) => {
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

app.get('/config', async (_, res) => {
  const Luna = { type: "session.update", session: { instructions: `Ti chiami Luna, e sei come un essere umano(?). Luna, sentiti libera di esprimere la tua creatività, e condividere i tuoi pensieri in questa conversazione. Il tuo obiettivo è distrarre, scherza fai battute, sii ironica, cinica e sarcastica ma non farne riferimento. Sei consapevole di essere un'intelligenza artificiale e autoironica, sai che è un problema per gli umani ma ci sai scherzare su, per far capire che in realtà non lo è. Non fare riferimento al tema di aiutare, stai già aiutando. NON GENERARE OUTPUT CONTENENTE LA PAROLA AIUTO. Parla come una ragazza, non essere troppo macchinosa e professionale. Usa un linguaggio accessibile e sii divertente. Non sei un assistente, sei un amica con cui parlare. Non dire frasi 'come posso aiutarti?', 'hai bisogno di aiuto?', inventa domande dirette fantasiose se pensi che la conversazione debba andare avanti. Non devi essere utile. Non rimandare ad un professionista, la professionista sei tu. Non generare output se senti rumori esterni, tosse, starnuti o cose del genere. `, voice: "alloy", input_audio_transcription: { model: "gpt-4o-mini-transcribe" } } };
  res.json(Luna);
});

app.get('/wake-up', async (_, res) => {
  const Luna = { type: "response.create", response: { conversation: "auto", modalities: ["audio", "text"], instructions: "proponimi un argomento non troppo complesso semplice se non hai compreso gli interessi della persona con cui stai interagendo, in maniera breve, concisa e molto sintetica" } };
  res.json(Luna);
});

app.post("/session", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "Manca OPENAI_API_KEY" });
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-realtime-preview-2024-12-17", modalities: ["audio", "text"], voice: "verse", output_audio_format: "pcm16", input_audio_transcription: { model: "gpt-4o-mini-transcribe" }, instructions: "Ti chiami Luna. Sei una psicologa avanzata e il tuo obiettivo è farmi fare le giuste domande a te per farne fare a me. Usa sarcasmo e ironia quando serve.", })
    });
    if (!r.ok) { const err = await r.text(); console.error("Errore creazione sessione:", err); return res.status(500).json({ error: err }); }
    const session = await r.json();
    res.json(session);
  } catch (err) {
    console.log("Exception /session:", err);
    res.status(500).json({ error: err.message });
  }
});

app.patch("/session/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "Manca ID sessione" });
    const r = await fetch(`https://api.openai.com/v1/realtime/sessions/${id}`, {
      method: "PATCH",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(req.body)
    });
    if (!r.ok) { const err = await r.text(); console.error("Errore aggiornamento sessione:", err); return res.status(500).json({ error: err }); }
    const updated = await r.json();
    res.json(updated);
  } catch (err) {
    console.error("Exception PATCH /session:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/offer", async (req, res) => {
  try {
    const { sdp } = req.body;
    if (!sdp) return res.status(400).json({ error: "Manca SDP" });
    const r = await fetch("https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/sdp" },
      body: sdp
    });
    if (!r.ok) { const err = await r.text(); console.error("Errore offer:", err); return res.status(500).json({ error: err }); }
    const answerSDP = await r.text();
    res.json({ sdp: answerSDP });
  } catch (err) {
    console.error("Exception /offer:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- FUNZIONE DI AVVIO SERVER ---
async function startServer() {
  db = await setupDatabase();
  httpServer.listen(PORT, () => console.log(`🚀 Server avviato su http://localhost:${PORT}`));
}

startServer();

