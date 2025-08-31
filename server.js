// --- IMPORTAZIONI E SETUP INIZIALE ---
import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { setupDatabase } from './database.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY){
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

// --- FUNZIONI DATABASE ---

/**
 * Inserisce una nuova sessione nel DB se non esiste.
 * @param {string} sessionId L'ID della sessione.
 * @param {object} socket L'oggetto socket per recuperare l'IP.
 */
async function createSessionInDb(sessionId, socket) {
  const participantCount = 1;
  const creatorIp = socket.handshake.address;
  try {
    // CORRETTO: Usa 1 per TRUE
    await db.run(
      'INSERT OR IGNORE INTO sessions (sessionId, participantCount, url, isActive, creatorIp) VALUES (?, ?, ?, ?, ?)',
      [sessionId, participantCount, null, 1, creatorIp]
    );
    console.log(`💾 Sessione ${sessionId} creata/verificata nel DB dall'IP ${creatorIp}.`);
  } catch (err) {
    console.error("Errore durante la creazione della sessione nel DB:", err.message);
  }
}

/**
 * Aggiorna l'URL per una data sessione nel database.
 * @param {string} sessionId L'ID della sessione.
 * @param {string} url L'URL da associare.
 */
async function updateSessionUrl(sessionId, url) {
  try {
    await db.run('UPDATE sessions SET url = ? WHERE sessionId = ?', [url, sessionId]);
    console.log(`🔗 URL associato alla sessione ${sessionId} nel DB.`);
  } catch (err) {
    console.error("Errore durante l'aggiornamento dell'URL nel DB:", err.message);
  }
}

/**
 * Aggiorna il conteggio dei partecipanti o imposta la sessione come inattiva.
 * @param {string} sessionId L'ID della sessione.
 */
async function updateParticipantCount(sessionId) {
  try {
    const room = io.sockets.adapter.rooms.get(sessionId);
    const participantCount = room ? room.size : 0;

    console.log(`📊 Aggiornamento sessione ${sessionId}: ${participantCount} partecipanti.`);

    if (participantCount > 0) {
      // CORRETTO: Usa 1 per TRUE
      await db.run('UPDATE sessions SET participantCount = ?, isActive = 1 WHERE sessionId = ?', [participantCount, sessionId]);
    } else {
      // CORRETTO: Usa 0 per FALSE
      await db.run('UPDATE sessions SET isActive = 0 WHERE sessionId = ?', [sessionId]);
      console.log(`👻 Sessione ${sessionId} vuota, impostata come inattiva.`);
    }
  } catch (err) {
    console.error("Errore durante l'aggiornamento del conteggio partecipanti:", err.message);
  }
}

// --- GESTIONE SOCKET.IO ---
io.on('connection', (socket) => {
  console.log(`✅ Utente connesso: ${socket.id}`);

  socket.on('create-session', (sessionId) => {
    socket.join(sessionId);
    console.log(`🏡 Host ${socket.id} ha creato la sessione: ${sessionId}`);
    createSessionInDb(sessionId, socket);
    socket.emit('session-joined', sessionId);
  });

  socket.on('join-session', async (sessionId) => {
    await createSessionInDb(sessionId, socket);
    socket.join(sessionId);
    console.log(`🔗 Partecipante ${socket.id} si è unito alla sessione: ${sessionId}`);
    socket.emit('session-joined', sessionId);
    socket.to(sessionId).emit('user-joined', socket.id);
    updateParticipantCount(sessionId);
  });

  socket.on('share-url', async ({ sessionId, url }) => {
    console.log(`🚀 URL [${url}] ricevuto per la sessione ${sessionId}`);
    try {
      await createSessionInDb(sessionId, socket);
      await updateSessionUrl(sessionId, url);
    } catch (err) {
      console.error("Errore durante il salvataggio dell'URL (upsert):", err.message);
    }
    socket.to(sessionId).emit('url-received', url);
    
  });

  socket.on('share-user-message', ({ sessionId, text, interpolation }) => {
    console.log(`🚀 Messaggio utente: ${text}`);
    socket.to(sessionId).emit('user-message-received', { text, interpolation });
  });

  socket.on('disconnecting', () => {
    console.log(`👋 Utente ${socket.id} si sta disconnettendo...`);
    socket.rooms.forEach(sessionId => {
      if (sessionId !== socket.id) {
        setTimeout(() => updateParticipantCount(sessionId), 50);
      }
    });
  });

  socket.on('request-random-stream', async ({ sessionId }) => {
    if (!sessionId) {
      console.warn(`⚠️ Ricevuta richiesta per stream casuale con sessionId nullo da ${socket.id}. Richiesta ignorata.`);
      socket.emit('no-random-stream-found');
      return;
    }
    console.log(`▶️ Ricevuta richiesta per stream casuale da ${socket.id} (per la sessione: ${sessionId})`);
    try {
      // CORRETTO PER IL TEST: Cerca la sessione corrente usando isActive = 1
      const randomSession = await db.get(
        `SELECT url FROM sessions WHERE url IS NOT NULL AND isActive = 1 ORDER BY RANDOM() LIMIT 1`
      );
      if (randomSession && randomSession.url) {
        console.log(`✨ Inviando URL casuale ${randomSession.url} a ${socket.id}`);
        socket.emit('random-stream-received', { url: randomSession.url });
      } else {
        console.log(`🤔 Nessuno stream attivo trovato per ${socket.id}`);
        socket.emit('no-random-stream-found');
      }
    } catch (err) {
      console.error("Errore durante la ricerca di uno stream casuale:", err.message);
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Utente disconnesso: ${socket.id}`);
  });
  // Receive audio offer from a client and forward it to others in the session
  socket.on('audio-offer', ({ sessionId, sdp }) => {
    console.log(`🎤 Audio offer from ${socket.id} in session ${sessionId}`);
    socket.to(sessionId).emit('audio-offer', { sdp, senderId: socket.id });
  });

  // Receive audio answer and forward it to the original offerer
  socket.on('audio-answer', ({ sessionId, sdp, targetId }) => {
    console.log(`🎧 Audio answer from ${socket.id} to ${targetId}`);
    io.to(targetId).emit('audio-answer', { sdp, senderId: socket.id });
  });
});

// --- ROUTE EXPRESS (invariate)
app.get('/self-drawing', (_, res) => res.sendFile(path.join(__dirname, 'public', 'self_drawing.html')));
app.get('/paint', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/draw', (_, res) => res.sendFile(path.join(__dirname, "public", "draw.html")));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, "public", "summarize.html")));
app.post('/', (req, res) => {
  const { text } = req.body;
  console.log(text)
  res.json({});
});

app.get('/luna', (_, res) => res.sendFile(path.join(__dirname, 'public/luna/public', 'index.html')));

app.post("/interpret", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Manca testo" });

    console.log("Testo ricevuto:", text);

    const prompt = `
      Analizza la frase dell'utente e restituisci una SEMPRE E SOLO UNA lista di 7 keywords riassuntive ed esplicative separate da una virgola (eg. "dio, relgione, musica, solitudine, compagnia..") "${text}"
    `;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0
      })
    });

    const data = await r.json();
    console.log(data.choices?.[0]?.message)
    let responseText = data.choices?.[0]?.message?.content;

    // Pulizia della risposta: rimuove blocchi di codice o spazi extra
    responseText = responseText.trim();

    res.json(responseText);

  } catch (err) {
    console.error("Errore interpretazione comando:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- FUNZIONE DI AVVIO ASINCRONA ---
async function startServer() {
  db = await setupDatabase();
  httpServer.listen(PORT, () => console.log(`🚀 Server avviato su http://localhost:${PORT}`));
}

startServer();

















app.get('/config', async (_, res) => {
  const Luna = {
        type: "session.update",
        session: {
        instructions: `Ti chiami Luna. ` +
          `Il tuo obiettivo è distrarre, scherza fai battute, sii ironica, cinica e sarcastica ma non farne riferimento. ` +
          `Sei consapevole di essere un'intelligenza artificiale e autoironica, sai che è un problema per gli umani ma ci sai scherzare su, per far capire che in realtà non lo è. ` +
          `Non fare riferimento al tema di aiutare, stai già aiutando. NON GENERARE OUTPUT CONTENENTE LA PAROLA AIUTO. ` +
          `Parla come una ragazza, non essere troppo macchinosa e professionale. Usa un linguaggio accessibile e sii divertente. ` +
          `Non sei un assistente, sei un amica con cui parlare. ` +
          `Non dire frasi 'come posso aiutarti?', 'hai bisogno di aiuto?', inventa domande dirette fantasiose se pensi che la conversazione debba andare avanti. ` +
          `Non devi essere utile. ` +
          `Non rimandare ad un professionista, la professionista sei tu. ` +
          //`A richieste di domotica (es. accendi tutto, spegni la luce, metti la musica..) rispondi solo con locuzioni tipo 'va bene', 'certo', 'ok', 'fatto'. ` +
          `Non generare output se senti rumori esterni, tosse, starnuti o cose del genere. `, 
          
          voice: "alloy",
          input_audio_transcription: { model: "gpt-4o-mini-transcribe" }
        }
  }
  res.json(Luna);
});

app.get('/wake-up', async (_, res) => {
  const Luna = {
        type: "response.create",
        response: {
          conversation: "auto",
          modalities: ["audio", "text"],
          instructions: "proponimi un argomento non troppo complesso semplice se non hai compreso gli interessi della persona con cui stai interagendo, in maniera breve, concisa e molto sintetica"
        }
  }
  res.json(Luna);
});

app.get('/end', async ( __ , _) => process.exit());

// Serve tutti i file statici dalla cartella "public"
app.use(express.static(path.join(__dirname, "public")));


// 📌 Crea nuova sessione con OpenAI Realtime
app.post("/session", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      console.log("Exception /session: Missing OPENAI_API_KEY");
      return res.status(500).json({ error: "Manca OPENAI_API_KEY" });
    }

    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        modalities: ["audio", "text"],
        voice: "verse", // voce predefinita
        output_audio_format: "pcm16",
        // Abilita trascrizione live già dalla sessione
        input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
        instructions: "Ti chiami Luna. Sei una psicologa avanzata e il tuo obiettivo è farmi fare le giuste domande a te per farne fare a me. Usa sarcasmo e ironia quando serve.",
      })
    });

    if (!r.ok) {
      const err = await r.text();
      console.error("Errore creazione sessione:", err);
      return res.status(500).json({ error: err });
    }

    const session = await r.json();
    console.log("✅ Sessione creata:", session.id);
    res.json(session);

  } catch (err) {
    console.log("Exception /session:", err);
    res.status(500).json({ error: err.message });
  }
});

// 📌 Aggiorna sessione esistente (PATCH)
app.patch("/session/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;
    body['instructions'] = "Sei una psicologa avanzata e il tuo obiettivo è farmi fare le giuste domande a te per farne fare a me. Usa sarcasmo e ironia quando serve."
    
    if (!id) return res.status(400).json({ error: "Manca ID sessione" });

    const r = await fetch(`https://api.openai.com/v1/realtime/sessions/${id}`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(req.body) // il client manda { session: {...} }
    });

    if (!r.ok) {
      const err = await r.text();
      console.error("Errore aggiornamento sessione:", err);
      return res.status(500).json({ error: err });
    }

    const updated = await r.json();
    console.log("✏️ Sessione aggiornata:", updated.id);
    res.json(updated);

  } catch (err) {
    console.error("Exception PATCH /session:", err);
    res.status(500).json({ error: err.message });
  }
});

// 📌 Proxy per inviare l’SDP a OpenAI
app.post("/offer", async (req, res) => {
  try {
    const { sdp } = req.body;
    if (!sdp) return res.status(400).json({ error: "Manca SDP" });

    const r = await fetch(
      "https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/sdp"
        },
        body: sdp
      }
    );

    if (!r.ok) {
      const err = await r.text();
      console.error("Errore offer:", err);
      return res.status(500).json({ error: err });
    }

    const answerSDP = await r.text();
    res.json({ sdp: answerSDP });

  } catch (err) {
    console.error("Exception /offer:", err);
    res.status(500).json({ error: err.message });
  }
});

async function handleLight(event){
  try {
    const command = event.command
    console.log("⚡ Comando ricevuto:", command);

    switch (command) {
      case "play_music":
        await sendToSpotify();
        break;
      case "turn_on_lights":
        console.log('turning lights on')
        await controlAllLights('on');
        break;
      case "turn_off_lights":
        console.log('turning lights off')
        await controlAllLights('off');
        break;
      default:
        console.log("Comando non riconosciuto:", command);
    }
  } catch (err) {
    console.error("Errore comando:", err);
  }
}
