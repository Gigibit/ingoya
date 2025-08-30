// Per usare la sintassi 'import', aggiungi "type": "module" al tuo file package.json

// --- IMPORTAZIONI ---
import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import multer from 'multer';
import fs from 'fs';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { setupDatabase } from './database.js';

// --- SETUP INIZIALE ---
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.PORT || 3000;
let db;

const app = express();
const httpServer = createServer(app); // Corretto: passa 'app' a createServer
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.json());
app.use(express.static("public"));

// --- NUOVE FUNZIONI SPECIFICHE PER IL DATABASE ---

/**
 * Inserisce una nuova sessione nel DB quando viene creata.
 * @param {string} sessionId L'ID della sessione.
 */
async function createSessionInDb(sessionId) {
  const participantCount = 1; // La sessione inizia con 1 partecipante (l'host)
  try {
    // 'INSERT OR IGNORE' non fa nulla se la sessione esiste già, evitando errori.
    await db.run(
      'INSERT OR IGNORE INTO sessions (sessionId, participantCount, url) VALUES (?, ?, ?)',
      [sessionId, participantCount, null] // L'URL è nullo all'inizio
    );
    console.log(`💾 Sessione ${sessionId} creata nel DB.`);
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
 * Aggiorna il numero di partecipanti per una data sessione nel database.
 * Se la sessione non ha più partecipanti, la rimuove.
 * @param {string} sessionId L'ID della sessione da aggiornare.
 */
async function updateParticipantCount(sessionId) {
  try {
    const room = io.sockets.adapter.rooms.get(sessionId);
    const participantCount = room ? room.size : 0;

    console.log(`📊 Aggiornamento sessione ${sessionId}: ${participantCount} partecipanti.`);

    if (participantCount > 0) {
      await db.run(
        'UPDATE sessions SET participantCount = ? WHERE sessionId = ?',
        [participantCount, sessionId]
      );
    } else {
      await db.run('DELETE FROM sessions WHERE sessionId = ?', sessionId);
      console.log(`🧹 Sessione ${sessionId} vuota, rimossa dal DB.`);
    }
  } catch (err) {
    console.error("Errore durante l'aggiornamento del conteggio partecipanti:", err.message);
  }
}

// --- GESTIONE ROUTE EXPRESS (invariata) ---
app.post("/interpret", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Manca testo" });

    const prompt = `
      Sei un'analizzatore sonoro collegato ad un sistema di Stream Diffusion alla camera dell'utente.
      L'utente può diventare quello che dice.
      Se è un personaggio ritorna il personaggio, eventualmente con caratteristiche o descrizione caratteriale.
      Dovresti creare una lista di 3 elementi separati da una virgola che descrivano con un'immagine visiva con il contenuto del seguente messaggio "${text}".
      La lista deve essere separata da una virgola (e.g. "Elon Musk, spazio, ride", "Trump, America, Governo longevo", "Gigibit, tanti soldi, felice", "Un gatto che balla, sole, aria"...). 
      Se non capisci o non è possibile rappresentare visivamente il messaggio rispondi col carattere '.'.
    `;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0
      })
    });

    const data = await r.json();
    let responseText = data.choices?.[0]?.message?.content;
    responseText = responseText.trim();
    res.json(responseText);

  } catch (err) {
    console.error("Errore interpretazione comando:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/self-drawing', (_, res) => res.sendFile(path.join(__dirname, 'public', 'self_drawing.html')));
app.get('/paint', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/draw', (_, res) => res.sendFile(path.join(__dirname, "public", "draw.html")));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, "public", "summarize.html")));

app.post('/', (req, res) => {
    const { text } = req.body;
    console.log(text)
    res.json({});
});

// --- GESTIONE SOCKET.IO (modificata) ---
io.on('connection', (socket) => {
  console.log(`✅ Utente connesso: ${socket.id}`);

  socket.on('create-session', (sessionId) => {
    socket.join(sessionId);
    console.log(`🏡 Host ${socket.id} ha creato la sessione: ${sessionId}`);
    // --- MODIFICATO: Crea la riga nel DB ---
    createSessionInDb(sessionId);
  });

  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    console.log(`🔗 Partecipante ${socket.id} si è unito alla sessione: ${sessionId}`);
    
    socket.emit('session-joined', sessionId);
    socket.to(sessionId).emit('user-joined', socket.id);
    
    // --- MODIFICATO: Aggiorna il conteggio dei partecipanti ---
    updateParticipantCount(sessionId);
  });

  socket.on('share-url', ({ sessionId, url }) => {
    console.log(`🚀 URL [${url}] ricevuto per la sessione ${sessionId}`);
    // --- NUOVA LOGICA: Salva l'URL nel DB ---
    updateSessionUrl(sessionId, url);
    socket.to(sessionId).emit('url-received', url);
  });

  socket.on('share-user-message', ({ sessionId, text, interpolation }) => {
    console.log(`🚀 si chiacchiera pure qui: ${text}`);
    socket.to(sessionId).emit('user-message-received', { text, interpolation });
  });

  socket.on('disconnecting', () => {
    console.log(`👋 Utente ${socket.id} si sta disconnettendo...`);
    socket.rooms.forEach(sessionId => {
      if (sessionId !== socket.id) {
        // Diamo un piccolo ritardo per assicurarci che il socket abbia lasciato
        // la stanza prima di ricalcolare il numero di partecipanti.
        setTimeout(() => updateParticipantCount(sessionId), 50);
      }
    });
  });

  socket.on('disconnect', () => {
    console.log(`❌ Utente disconnesso: ${socket.id}`);
  });
});

// --- FUNZIONE DI AVVIO ASINCRONA ---
async function startServer() {
  db = await setupDatabase();
  httpServer.listen(PORT, () => console.log(`🚀 Server avviato su http://localhost:${PORT}`));
}

startServer();