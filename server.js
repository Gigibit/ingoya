// Per usare la sintassi 'import', aggiungi "type": "module" al tuo file package.json

// --- IMPORTAZIONI ESISTENTI E NUOVE ---
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

// --- SETUP INIZIALE ---
// Assicurati di aver installato i pacchetti necessari:
// npm install express socket.io dotenv openai @google/generative-ai multer
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Per lo sviluppo, altrimenti specifica il tuo dominio client
        methods: ["GET", "POST"]
    }
});

// Middleware per leggere il JSON e servire file statici
app.use(express.json());
app.use(express.static("public"));

// Configurazione per salvare i file audio temporaneamente
const upload = multer({ dest: 'uploads/' });

// --- CONFIGURAZIONE API KEYS ---
// Assicurati che queste chiavi siano nel tuo file .env
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);


// --- FUNZIONI DI TRASCRIZIONE ---

async function transcribeWithOpenAI(filePath) {
    const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: "whisper-1",
    });
    return transcription.text;
}

async function transcribeWithGemini(filePath) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const audioBytes = fs.readFileSync(filePath).toString('base64');
    
    const audioPart = {
      inlineData: {
        mimeType: 'audio/webm', // Assicurati che il mimeType corrisponda a quello inviato dal client
        data: audioBytes,
      },
    };

    const result = await model.generateContent(["Trascrivi questo audio:", audioPart]);
    return result.response.text();
}


app.post("/interpret", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Manca testo" });

    console.log("Testo ricevuto:", text);

    const prompt = `
      Analizza la frase dell'utente e restituisci una SEMPRE E SOLO UNA lista di keyword chiave esplicative e rappresentative del prompt separate da virgola (eg. "dio, relgione, musica, solitudine, compagnia..") "${text}"
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


app.get('/self-drawing', (_, res) => res.sendFile(path.join(__dirname, 'public', 'self_drawing.html')));
app.get('/paint', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/draw', (_, res) => res.sendFile(path.join(__dirname, "public", "draw.html")));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, "public", "summarize.html")));

io.on('connection', (socket) => {
  console.log(`✅ Utente connesso: ${socket.id}`);

  socket.on('create-session', (sessionId) => {
    socket.join(sessionId);
    console.log(`🏡 Host ${socket.id} ha creato la sessione: ${sessionId}`);
  });

  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    console.log(`🔗 Partecipante ${socket.id} si è unito alla sessione: ${sessionId}`);
    
    socket.emit('session-joined', sessionId);
    socket.to(sessionId).emit('user-joined', socket.id);
  });

  socket.on('share-url', ({ sessionId, url }) => {
    console.log(`🚀 URL [${url}] ricevuto per la sessione ${sessionId}`);
    socket.to(sessionId).emit('url-received', url);
  });

  socket.on('share-user-message', ({ sessionId, text, interpolation }) => {
    console.log(`🚀 si chiacchiera pure qui: ${text}`);
    socket.to(sessionId).emit('user-message-received', { text, interpolation });
  });

  socket.on('disconnect', () => console.log(`❌ Utente disconnesso: ${socket.id}`));
});

httpServer.listen(PORT, () => console.log(`🚀 Server avviato su http://localhost:${PORT}`));
