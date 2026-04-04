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

const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
};

function sendError(res, statusCode, message, context = {}) {
  logger.error(message, context);
  return res.status(statusCode).json({ error: message });
}

app.post("/interpret", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return sendError(res, 400, "Manca testo", { route: "/interpret" });
    }

    logger.info("Testo ricevuto:", text);

    const prompt = `
      Analizza la frase dell'utente e restituisci una SEMPRE E SOLO UNA lista di 7 keywords riassuntive ed esplicative separate da una virgola (eg. "dio, relgione, musica, solitudine, compagnia..") "${text}"
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
    logger.info("Risposta OpenAI ricevuta.", { hasChoices: Boolean(data.choices?.length) });
    if (!r.ok) {
      return sendError(res, 502, "Errore dal provider OpenAI", {
        route: "/interpret",
        providerStatus: r.status,
        providerBody: data,
      });
    }

    let responseText = data.choices?.[0]?.message?.content;

    // Pulizia della risposta: rimuove blocchi di codice o spazi extra
    responseText = responseText?.trim();
    if (!responseText) {
      return sendError(res, 502, "Risposta OpenAI non valida o vuota", {
        route: "/interpret",
        providerBody: data,
      });
    }

    res.json(responseText);

  } catch (err) {
    sendError(res, 500, "Errore interpretazione comando", {
      route: "/interpret",
      details: err?.message,
    });
  }
});

app.post("/stream-session", async (req, res) => {
  const apiKey = process.env.DAYDREAM_API_KEY || process.env.LIVEPEER_API_KEY;
  const apiBaseUrl = process.env.DAYDREAM_API_BASE_URL || "https://api.daydream.live";
  const pipelineId = process.env.DAYDREAM_PIPELINE_ID || process.env.LIVEPEER_PIPELINE_ID;

  if (!apiKey || !pipelineId) {
    return sendError(res, 500, "Configurazione stream mancante: DAYDREAM_API_KEY o DAYDREAM_PIPELINE_ID", {
      route: "/stream-session",
    });
  }

  const {
    prompt = "describe human beings.",
    negativePrompt = "blurry, low quality, flat, 2d",
    modelId = "stabilityai/sd-turbo",
  } = req.body ?? {};

  const initPayload = {
    name: "theia-stream-session",
    pipeline_id: pipelineId,
    pipeline_params: {
      model_id: modelId,
      prompt,
      negative_prompt: negativePrompt,
      num_inference_steps: 50,
      seed: 42,
      t_index_list: [2, 4, 6],
    },
  };

  try {
    const createStreamResponse = await fetch(`${apiBaseUrl}/v1/streams`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(initPayload),
    });

    const providerBody = await createStreamResponse.json();
    if (!createStreamResponse.ok) {
      return sendError(res, 502, "Errore provider durante la creazione stream", {
        route: "/stream-session",
        providerStatus: createStreamResponse.status,
        providerBody,
      });
    }

    if (!providerBody?.id || !providerBody?.whip_url) {
      return sendError(res, 502, "Risposta provider stream incompleta", {
        route: "/stream-session",
        providerBody,
      });
    }

    return res.json({
      streamId: providerBody.id,
      whipUrl: providerBody.whip_url,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    return sendError(res, 500, "Errore interno creazione stream-session", {
      route: "/stream-session",
      details: error?.message,
    });
  }
});


app.post("/luna-update-stream-params", async (req, res) => {
  const apiKey = process.env.DAYDREAM_API_KEY || process.env.LIVEPEER_API_KEY;
  const apiBaseUrl = process.env.DAYDREAM_API_BASE_URL || "https://api.daydream.live";

  const { streamId, params } = req.body ?? {};

  if (!apiKey) {
    return sendError(res, 500, "Configurazione stream mancante: DAYDREAM_API_KEY", {
      route: "/luna-update-stream-params",
    });
  }

  if (!streamId || typeof streamId !== "string") {
    return sendError(res, 400, "Parametro obbligatorio mancante: streamId", {
      route: "/luna-update-stream-params",
      body: req.body,
    });
  }

  if (!params || typeof params !== "object") {
    return sendError(res, 400, "Parametro obbligatorio mancante: params", {
      route: "/luna-update-stream-params",
      body: req.body,
    });
  }

  const payloadCandidates = [
    { params },
    { pipeline_params: params },
    params,
  ];
  const candidateEndpoints = [
    `${apiBaseUrl}/v1/streams/${encodeURIComponent(streamId)}`,
    `${apiBaseUrl}/v1/stream/${encodeURIComponent(streamId)}`,
    `${apiBaseUrl}/v1/streams/${encodeURIComponent(streamId)}/params`,
    `${apiBaseUrl}/v1/streams/${encodeURIComponent(streamId)}/update`,
    `${apiBaseUrl}/v1/streams/${encodeURIComponent(streamId)}/pipeline_params`,
  ];
  const candidateMethods = ["PATCH", "PUT"];

  const errors = [];

  for (const endpoint of candidateEndpoints) {
    for (const method of candidateMethods) {
      for (const payload of payloadCandidates) {
        try {
          const response = await fetch(endpoint, {
            method,
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "x-client-source": "streamdiffusion-web",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });

          let providerBody = null;
          try {
            providerBody = await response.json();
          } catch {
            providerBody = await response.text();
          }

          if (response.ok) {
            logger.info("Aggiornamento stream riuscito", { endpoint, method, payload });
            return res.json({ ok: true, endpoint, method, payload, providerBody });
          }

          const attemptError = {
            endpoint,
            method,
            payload,
            status: response.status,
            statusText: response.statusText,
            providerBody,
          };

          errors.push(attemptError);

          if (response.status !== 404) {
            return sendError(res, 502, "Errore provider durante aggiornamento stream", {
              route: "/luna-update-stream-params",
              ...attemptError,
            });
          }
        } catch (error) {
          return sendError(res, 500, "Errore interno chiamata provider aggiornamento stream", {
            route: "/luna-update-stream-params",
            endpoint,
            method,
            payload,
            details: error?.message,
          });
        }
      }
    }
  }

  return sendError(res, 502, "API Update Error: Not Found", {
    route: "/luna-update-stream-params",
    streamId,
    attempts: errors,
  });
});

app.get('/self-drawing', (_, res) => res.sendFile(path.join(__dirname, 'public', 'self_drawing.html')));
app.get('/paint', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/draw', (_, res) => res.sendFile(path.join(__dirname, "public", "draw.html")));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, "public", "summarize.html")));

app.use((req, res) => {
  return sendError(res, 404, "Route non trovata", {
    route: req.originalUrl,
    method: req.method,
  });
});

app.use((err, req, res, _next) => {
  return sendError(res, 500, "Errore interno server", {
    route: req.originalUrl,
    method: req.method,
    details: err?.message,
  });
});

io.on('connection', (socket) => {
  logger.info(`✅ Utente connesso: ${socket.id}`);

  socket.on('create-session', (sessionId) => {
    socket.join(sessionId);
    logger.info(`🏡 Host ${socket.id} ha creato la sessione: ${sessionId}`);
  });

  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    logger.info(`🔗 Partecipante ${socket.id} si è unito alla sessione: ${sessionId}`);
    
    socket.emit('session-joined', sessionId);
    socket.to(sessionId).emit('user-joined', socket.id);
  });

  socket.on('share-url', ({ sessionId, url }) => {
    logger.info(`🚀 URL [${url}] ricevuto per la sessione ${sessionId}`);
    socket.to(sessionId).emit('url-received', url);
  });

  socket.on('share-user-message', ({ sessionId, text, interpolation }) => {
    logger.info(`🚀 si chiacchiera pure qui: ${text}`);
    socket.to(sessionId).emit('user-message-received', { text, interpolation });
  });

  socket.on('disconnect', () => logger.info(`❌ Utente disconnesso: ${socket.id}`));
});

httpServer.listen(PORT, () => logger.info(`🚀 Server avviato su http://localhost:${PORT}`));
