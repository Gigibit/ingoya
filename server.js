// Importazioni esistenti e nuove
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Importazioni per la logica AI
import dotenv from 'dotenv';
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

    const tempVideoPath = path.join(os.tmpdir(), `video-${Date.now()}.mp4`);
    const CLIP_DURATION = 20; // 20 secondi per ogni clip

    try {
        // --- PASSO 1: Ottieni la durata del video con play-dl ---
        console.log("ℹ️  Recupero informazioni video...");
        const info = await play.video_info(youtubeUrl);
        const duration = info.video_details.durationInSec;
        console.log(`⏱️  Durata totale: ${duration} secondi.`);

        // --- PASSO 2: Ottieni gli URL degli stream con yt-dlp ---
        console.log("🔗 Ottenendo URL degli stream...");
        const streamInfo = await ytdlp(youtubeUrl, {
            dumpSingleJson: true,
            format: 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]', // best video + best audio
        });
        const videoUrl = streamInfo.url; // URL diretto al video

        // --- PASSO 3: Usa FFmpeg per tagliare e unire le clip ---
        console.log("✂️  Elaborazione con FFmpeg per estrarre 3 clip da 20s...");
        const middle_start = Math.max(0, (duration / 2) - (CLIP_DURATION / 2));
        const end_start = Math.max(0, duration - CLIP_DURATION);

        await new Promise((resolve, reject) => {
            ffmpeg(videoUrl) // Diamo a FFmpeg l'URL diretto dello stream
                .complexFilter([
                    // Trimma la clip iniziale
                    `[0:v]trim=start=0:end=${CLIP_DURATION},setpts=PTS-STARTPTS[v0]`,
                    `[0:a]atrim=start=0:end=${CLIP_DURATION},asetpts=PTS-STARTPTS[a0]`,
                    // Trimma la clip centrale
                    `[0:v]trim=start=${middle_start}:end=${middle_start + CLIP_DURATION},setpts=PTS-STARTPTS[v1]`,
                    `[0:a]atrim=start=${middle_start}:end=${middle_start + CLIP_DURATION},asetpts=PTS-STARTPTS[a1]`,
                    // Trimma la clip finale
                    `[0:v]trim=start=${end_start}:end=${duration},setpts=PTS-STARTPTS[v2]`,
                    `[0:a]atrim=start=${end_start}:end=${duration},asetpts=PTS-STARTPTS[a2]`,
                    // Concatena le 3 clip (video e audio)
                    '[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[outv][outa]'
                ])
                .map(['[outv]', '[outa]']) // Mappa l'output del filtro
                .save(tempVideoPath)
                .on('end', resolve)
                .on('error', reject);
        });

        console.log(`✅ Clip finale di ${CLIP_DURATION * 3}s salvata in: ${tempVideoPath}`);

        // --- PASSO 4 & 5: Prepara il file e invialo a Gemini (invariato) ---
        console.log("📤 Preparazione file per Gemini...");
        const videoFile = {
            inlineData: {
                data: Buffer.from(fs.readFileSync(tempVideoPath)).toString("base64"),
                mimeType: "video/mp4",
            },
        };

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
        const prompt = "Analizza attentamente queste tre clip (inizio, centro e fine di un video) e riassumi il contenuto visivo, l'atmosfera e la narrazione dell'intero video in esattamente tre parole in italiano.";

        console.log("🤖 Invio clip a Gemini per l'analisi...");
        const result = await model.generateContent([prompt, videoFile]);
        const summary = result.response.text();
        
        console.log(`✨ Sintesi video finale: ${summary}`);
        res.json({ summary: summary.trim() });

    } catch (error) {
        console.error("ERRORE NEL PROCESSO VIDEO:", error);
        res.status(500).json({ error: error.message || "Impossibile processare la richiesta video." });
    } finally {
        if (fs.existsSync(tempVideoPath)) {
            fs.unlinkSync(tempVideoPath);
            console.log("🗑️  File video temporaneo rimosso.");
        }
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