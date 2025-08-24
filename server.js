// Importazioni esistenti e nuove
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Importazioni per la logica AI
import dotenv from 'dotenv';
import { YoutubeTranscript } from 'youtube-transcript';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

// Carica le variabili d'ambiente dal file .env
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// Middleware per leggere il JSON dalle richieste POST
app.use(express.json());
app.use(express.static("public"));

// -----------------------------------------------------------------------------
// NUOVO ENDPOINT PER LA SINTESI DEL VIDEO
// -----------------------------------------------------------------------------
app.post('/summarize', async (req, res) => {
    const { youtubeUrl } = req.body;

    if (!youtubeUrl) {
        return res.status(400).json({ error: "URL del video mancante." });
    }

    try {
        console.log(`🔎 Recupero trascrizione per: ${youtubeUrl}`);
        // 1. Ottieni la trascrizione dal video
        const transcriptData = await YoutubeTranscript.fetchTranscript(youtubeUrl);
        if (!transcriptData || transcriptData.length === 0) {
            return res.status(404).json({ error: "Trascrizione non trovata per questo video." });
        }
        const transcript = transcriptData.map(t => t.text).join(' ');
        console.log("✅ Trascrizione ottenuta.");

        // 2. Prepara la richiesta per l'AI
        const prompt = `Fornisci una sintesi in esattamente tre parole, in italiano, per il seguente testo:\n\n"${transcript}"`;
        let summary = '';

        // 3. Esegui la chiamata all'AI scelta (parametrica)
        if (process.env.AI_PROVIDER === 'gemini') {
            console.log("🤖 Chiedo a Gemini...");
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(prompt);
            summary = result.response.text();

        } else if (process.env.AI_PROVIDER === 'openai') {
            console.log("🤖 Chiedo a OpenAI...");
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "Sei un esperto nel sintetizzare testi. Rispondi sempre e solo con tre parole in italiano." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.5,
            });
            summary = response.choices[0].message.content;
        } else {
             return res.status(500).json({ error: "AI Provider non configurato correttamente nel file .env" });
        }
        
        console.log(`✨ Sintesi: ${summary}`);
        res.json({ summary: summary.trim() });

    } catch (error) {
        console.error("ERRORE:", error.message);
        res.status(500).json({ error: "Impossibile processare il video. Potrebbe non avere sottotitoli disponibili o l'URL non è valido." });
    }
});


// -----------------------------------------------------------------------------
// IL TUO CODICE SOCKET.IO ESISTENTE (invariato)
// -----------------------------------------------------------------------------
app.get('/paint', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/draw', (_, res) => res.sendFile(path.join(__dirname, "public", "draw.html")));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, "public", "summarize.html"))); // Modificato per puntare al nuovo file

io.on('connection', (socket) => {
  console.log(`✅ Utente connesso: ${socket.id}`);

  socket.on('create-session', (sessionId) => {
    socket.join(sessionId);
    console.log(`🏡 Host ${socket.id} ha creato la sessione: ${sessionId}`);
  });

  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    console.log(`🔗 Partecipante ${socket.id} si è unito alla sessione: ${sessionId}`);
    
    // ✨ 1. INVIA CONFERMA AL PARTECIPANTE
    // Comunica a draw.html che è stato aggiunto correttamente alla stanza.
    socket.emit('session-joined', sessionId);

    // Notifica all'host che qualcuno è entrato
    socket.to(sessionId).emit('user-joined', socket.id);
  });

  socket.on('share-url', ({ sessionId, url }) => {
    console.log(`🚀 URL [${url}] ricevuto per la sessione ${sessionId}`);
    // Invia l'URL all'host (a tutti nella stanza tranne al mittente)
    socket.to(sessionId).emit('url-received', url);
  });

  socket.on('disconnect', () => console.log(`❌ Utente disconnesso: ${socket.id}`));
});

httpServer.listen(PORT, () => console.log(`🚀 Server avviato su http://localhost:${PORT}`));