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

function normalizeStreamId(rawStreamReference) {
  const value = String(rawStreamReference || "").trim();
  if (!value) return "";

  if (!value.includes("://")) return value;

  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const idCandidate = segments[segments.length - 1] || "";
    return decodeURIComponent(idCandidate);
  } catch (error) {
    logger.error("Stream reference non valido, uso valore raw", {
      value,
      details: error?.message,
    });
    return value;
  }
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

  if (!apiKey) {
    return sendError(res, 500, "Configurazione stream mancante: DAYDREAM_API_KEY", {
      route: "/stream-session",
    });
  }

  const {
    prompt = "describe human beings.",
    negativePrompt = "blurry, low quality, flat, 2d",
    modelId = "stabilityai/sd-turbo",
    pipelineId: bodyPipelineId,
    pipelineParams,
  } = req.body ?? {};

  const resolvedPipelineId = bodyPipelineId || pipelineId;
  if (!resolvedPipelineId) {
    return sendError(res, 500, "Configurazione stream mancante: DAYDREAM_PIPELINE_ID", {
      route: "/stream-session",
      body: req.body,
    });
  }

  const resolvedPipelineParams = {
    model_id: modelId,
    prompt,
    negative_prompt: negativePrompt,
    num_inference_steps: 50,
    seed: 42,
    t_index_list: [2, 4, 6],
    ...(pipelineParams && typeof pipelineParams === "object" ? pipelineParams : {}),
  };

  const initPayload = {
    name: "theia-stream-session",
    pipeline_id: resolvedPipelineId,
    pipeline_params: resolvedPipelineParams,
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

  const { streamId, params, pipeline, sessionId } = req.body ?? {};
  const resolvedStreamId = normalizeStreamId(streamId || sessionId || "");

  if (!apiKey) {
    return sendError(res, 500, "Configurazione stream mancante: DAYDREAM_API_KEY", {
      route: "/luna-update-stream-params",
    });
  }

  if (!resolvedStreamId) {
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

  const primaryEndpoint = `${apiBaseUrl}/v1/streams/${encodeURIComponent(resolvedStreamId)}`;
  const normalizedParams = {
    ...(params || {}),
    ...(typeof req.body?.prompt === "string" ? { prompt: req.body.prompt } : {}),
  };
  const payload = {
    ...(pipeline ? { pipeline } : {}),
    params: normalizedParams,
  };

  try {
    const attempts = [
      { endpoint: primaryEndpoint, method: "PATCH" },
      { endpoint: `${primaryEndpoint}/params`, method: "PATCH" },
      { endpoint: `${primaryEndpoint}/params`, method: "POST" },
      { endpoint: `${primaryEndpoint}/pipeline_params`, method: "PATCH" },
      { endpoint: `${primaryEndpoint}/pipeline_params`, method: "POST" },
    ];

    let lastFailure = null;
    for (const attempt of attempts) {
      const response = await fetch(attempt.endpoint, {
        method: attempt.method,
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
        logger.info("Aggiornamento stream riuscito", {
          route: "/luna-update-stream-params",
          endpoint: attempt.endpoint,
          method: attempt.method,
          streamId: resolvedStreamId,
        });
        return res.json({
          ok: true,
          endpoint: attempt.endpoint,
          method: attempt.method,
          payload,
          providerBody,
        });
      }

      lastFailure = {
        route: "/luna-update-stream-params",
        endpoint: attempt.endpoint,
        method: attempt.method,
        streamId: resolvedStreamId,
        status: response.status,
        statusText: response.statusText,
        providerBody,
        payload,
      };

      if (response.status !== 404) {
        return sendError(res, 502, "Errore provider durante aggiornamento stream", lastFailure);
      }
    }

    return sendError(
      res,
      502,
      "API Update Error: stream non trovato sul provider. Verifica di usare l'id stream upstream (non un sessionId locale).",
      {
        ...lastFailure,
        fallbackTried: attempts.map(({ method, endpoint }) => `${method} ${endpoint}`),
      },
    );
  } catch (error) {
    return sendError(res, 500, "Errore interno chiamata provider aggiornamento stream", {
      route: "/luna-update-stream-params",
      endpoint: primaryEndpoint,
      method: "PATCH+fallback",
      streamId: resolvedStreamId,
      payload,
      details: error?.message,
    });
  }
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
