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
    socket.emit('test-room-sharing-url', url);
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
        `SELECT url FROM sessions WHERE sessionId = ? AND url IS NOT NULL AND isActive = 1 ORDER BY RANDOM() LIMIT 1`,
        [sessionId]
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

// --- FUNZIONE DI AVVIO ASINCRONA ---
async function startServer() {
  db = await setupDatabase();
  httpServer.listen(PORT, () => console.log(`🚀 Server avviato su http://localhost:${PORT}`));
}

startServer();

