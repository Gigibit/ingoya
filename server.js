import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';

import lunaRouter from './luna.router.js';
import createAuthRouter from './auth.router.js';
import { protectRoute } from './auth.middleware.js';

import {
  setupDatabase,
  createSession,
  getSessionForWhip,
  getSessionForWhep,
  saveWhipDetails,
  saveWhepUrlDetails,
  findOrCreateRequest,
  getStreamIdBySessionId,
  updateDbParticipantCount,
  getRandomActiveStream,
  closeEverySession,
  getOrCreateTheiaSession
} from './database.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3000;
const DAYDREAM_API_KEY = process.env.DAYDREAM_API_KEY;
const DAYDREAM_API_BASE_URL = 'https://api.daydream.live';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PIPELINE_ID = 'pip_SDXL-turbo';

const DEFAULT_PIPELINE_PARAMS = {
  seed: 42,
  delta: 0.55,
  width: 512,
  height: 512,
  prompt: 'morgan freeman',
  model_id: 'stabilityai/sdxl-turbo',
  lora_dict: null,
  ip_adapter: {
    type: 'regular',
    scale: 1,
    enabled: false
  },
  controlnets: [
    {
      enabled: true,
      model_id: 'xinsir/controlnet-depth-sdxl-1.0',
      preprocessor: 'depth_tensorrt',
      conditioning_scale: 0.46,
      preprocessor_params: {}
    },
    {
      enabled: true,
      model_id: 'xinsir/controlnet-canny-sdxl-1.0',
      preprocessor: 'canny',
      conditioning_scale: 0,
      preprocessor_params: {
        low_threshold: 100,
        high_threshold: 200
      }
    },
    {
      enabled: true,
      model_id: 'xinsir/controlnet-tile-sdxl-1.0',
      preprocessor: 'feedback',
      conditioning_scale: 0.2,
      preprocessor_params: {
        feedback_strength: 0.5
      }
    }
  ],
  acceleration: 'tensorrt',
  do_add_noise: true,
  t_index_list: [15, 15, 15],
  use_lcm_lora: true,
  guidance_scale: 0.9,
  negative_prompt: 'blurry, low quality, flat, 2d',
  num_inference_steps: 50,
  use_denoising_batch: true,
  normalize_seed_weights: true,
  normalize_prompt_weights: true,
  seed_interpolation_method: 'linear',
  ip_adapter_style_image_url:
    'https://storage.googleapis.com/thom-vod-testing/style-presets/default_preset.png',
  enable_similar_image_filter: false,
  prompt_interpolation_method: 'linear',
  similar_image_filter_threshold: 0.98,
  similar_image_filter_max_skip_frame: 10
};

if (!OPENAI_API_KEY) {
  throw new Error('missing OPENAI_API_KEY');
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

let db;
const viewersBySession = {};

function generateSessionId(length = 6) {
  const chars = 'Z0123456789';
  let result = '';

  for (let i = 0; i < length; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return result;
}

function getSense() {
  return 'moon, lips, tongue';
}

function absoluteUrl(req, localPath) {
  return `${req.protocol}://${req.get('host')}${localPath}`;
}

app.use(express.text({ type: ['application/sdp', 'text/plain'] }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

app.use(async (req, _res, next) => {
  try {
    const currentDb = req.app.get('db');
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    await findOrCreateRequest(currentDb, ip);
  } catch (err) {
    console.error('Errore conteggio IP:', err);
  }
  next();
});

app.post('/stream-session', async (req, res) => {
  let { sessionId } = req.body;

  if (!sessionId) {
    sessionId = generateSessionId(6);
  }

  try {
    await createSession(db, sessionId);

    const existingSession = await getSessionForWhip(db, sessionId);
    if (existingSession?.whipUrl) {
      return res.json({
        sessionId,
        whipUrl: `/whip/${sessionId}`
      });
    }

    const createStreamResponse = await fetch(`${DAYDREAM_API_BASE_URL}/v1/streams`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DAYDREAM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `stream-${sessionId}`,
        pipeline_id: PIPELINE_ID,
        pipeline_params: DEFAULT_PIPELINE_PARAMS
      })
    });

    const streamData = await createStreamResponse.json();

    if (!createStreamResponse.ok) {
      throw new Error(
        `API Error Livepeer/Daydream: ${createStreamResponse.status} - ${streamData.error || 'Errore sconosciuto'}`
      );
    }

    const { id: streamId, whip_url: whipUrl } = streamData;

    if (!whipUrl) {
      throw new Error('whip_url mancante nella risposta upstream.');
    }

    await saveWhipDetails(db, sessionId, streamId, whipUrl);

    return res.json({
      streamId,
      sessionId,
      whipUrl: `/whip/${sessionId}`
    });
  } catch (error) {
    console.error('❌ Errore API /stream-session POST:', error);
    return res.status(500).json({
      error: 'Errore durante la creazione dello stream.'
    });
  }
});

app.get('/stream-session', async (req, res) => {
  const { sessionId } = req.query;

  if (!sessionId) {
    return res.status(400).json({
      error: "Il parametro 'sessionId' è obbligatorio."
    });
  }

  try {
    const session = await getSessionForWhep(db, sessionId);

    if (!session || !session.whepUrl) {
      return res.status(404).json({
        error: 'Nessuna sessione di streaming attiva trovata con questo ID.'
      });
    }

    return res.json({
      sessionId,
      whepUrl: `/whep/${sessionId}`
    });
  } catch (error) {
    console.error('❌ Errore API /stream-session GET:', error);
    return res.status(500).json({
      error: 'Errore durante il recupero dello stream.'
    });
  }
});

app.post('/update-whep-url', async (req, res) => {
  const { sessionId, whepUrl } = req.body;

  if (!sessionId || !whepUrl) {
    return res.status(400).json({
      error: 'sessionId e whepUrl sono obbligatori.'
    });
  }

  try {
    await saveWhepUrlDetails(db, sessionId, whepUrl);
    return res.status(200).json({
      message: 'URL WHEP aggiornato con successo.'
    });
  } catch (error) {
    console.error('❌ Errore API /update-whep-url:', error);
    return res.status(500).json({
      error: "Errore durante il salvataggio dell'URL WHEP."
    });
  }
});

app.post('/whip/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const session = await getSessionForWhip(db, sessionId);

    if (!session?.whipUrl) {
      return res.status(404).send('WHIP URL non trovato per questa sessione');
    }

    const upstream = await fetch(session.whipUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp'
      },
      body: req.body
    });

    const answerSdp = await upstream.text();

    const playbackUrl =
      upstream.headers.get('livepeer-playback-url') ||
      upstream.headers.get('Livepeer-Playback-Url');

    if (playbackUrl) {
      await saveWhepUrlDetails(db, sessionId, playbackUrl);
      res.setHeader('livepeer-playback-url', `/whep/${sessionId}`);
    }

    res.status(upstream.status);
    res.type('application/sdp');
    return res.send(answerSdp);
  } catch (err) {
    console.error('❌ Errore proxy WHIP:', err);
    return res.status(500).send('Errore proxy WHIP');
  }
});

app.post('/whep/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const session = await getSessionForWhep(db, sessionId);

    if (!session?.whepUrl) {
      return res.status(404).send('WHEP URL non trovato');
    }

    const upstream = await fetch(session.whepUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp'
      },
      body: req.body
    });

    const answerSdp = await upstream.text();
    const location = upstream.headers.get('location');

    if (location) {
      res.setHeader('location', absoluteUrl(req, `/whep/${sessionId}/resource`));
    }

    res.status(upstream.status);
    res.type('application/sdp');
    return res.send(answerSdp);
  } catch (err) {
    console.error('❌ Errore proxy WHEP POST:', err);
    return res.status(500).send('Errore proxy WHEP');
  }
});

app.patch('/whep/:sessionId/resource', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const session = await getSessionForWhep(db, sessionId);

    if (!session?.whepUrl) {
      return res.status(404).send('WHEP URL non trovato');
    }

    const upstream = await fetch(session.whepUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/trickle-ice-sdpfrag'
      },
      body: req.body
    });

    const body = await upstream.text();
    res.status(upstream.status);

    const contentType = upstream.headers.get('content-type');
    if (contentType) {
      res.setHeader('content-type', contentType);
    }

    return res.send(body);
  } catch (err) {
    console.error('❌ Errore proxy WHEP PATCH:', err);
    return res.status(500).send('Errore proxy WHEP PATCH');
  }
});

app.delete('/whep/:sessionId/resource', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const session = await getSessionForWhep(db, sessionId);

    if (!session?.whepUrl) {
      return res.status(404).send('WHEP URL non trovato');
    }

    const upstream = await fetch(session.whepUrl, {
      method: 'DELETE'
    });

    const body = await upstream.text();
    res.status(upstream.status);
    return res.send(body);
  } catch (err) {
    console.error('❌ Errore proxy WHEP DELETE:', err);
    return res.status(500).send('Errore proxy WHEP DELETE');
  }
});

app.post('/update-stream-params', async (req, res) => {
  const { sessionId, prompt } = req.body;

  if (!sessionId || !prompt) {
    return res.status(400).json({
      error: 'sessionId e prompt sono obbligatori.'
    });
  }

  try {
    const streamId = await getStreamIdBySessionId(db, sessionId);

    if (!streamId) {
      return res.status(404).json({
        error: 'Nessun streamId attivo trovato per questa sessione.'
      });
    }

    const paramsPayload = {
      params: {
        prompt: `Mouth. Real Representation. ${prompt}. REAL, NOT drawn, NOT blurry, NOT low quality, NOT flat, NOT 2d`
      }
    };

    const response = await fetch(`${DAYDREAM_API_BASE_URL}/v1/streams/${streamId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${DAYDREAM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(paramsPayload)
    });

    if (!response.ok) {
      throw new Error(`API Update Error: ${response.statusText}`);
    }

    return res.status(200).json({
      message: 'Parametri dello stream aggiornati con successo.'
    });
  } catch (error) {
    console.error('❌ Errore API /update-stream-params:', error);
    return res.status(500).json({
      error: "Errore durante l'aggiornamento dei parametri dello stream."
    });
  }
});

app.post('/theia-update-stream-params', async (req, res) => {
  const { sessionId, prompt } = req.body;

  if (!sessionId || !prompt) {
    return res.status(400).json({
      error: 'sessionId e prompt sono obbligatori.'
    });
  }

  try {
    const lighter = `Sei il generatore di prompt di una pipeline di Stream Diffusion...: "${prompt}"`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: lighter }],
        temperature: 0
      })
    });

    const data = await r.json();
    const advancedPrompt = `${data.choices?.[0]?.message?.content || ''}, ${getSense()}`;

    const streamId = await getStreamIdBySessionId(db, sessionId);
    if (!streamId) {
      return res.status(404).json({ error: 'Nessun streamId attivo.' });
    }

    const paramsPayload = {
      params: { prompt: advancedPrompt }
    };

    const response = await fetch(`${DAYDREAM_API_BASE_URL}/v1/streams/${streamId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${DAYDREAM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(paramsPayload)
    });

    if (!response.ok) {
      throw new Error(`API Update Error: ${response.statusText}`);
    }

    return res.status(200).json({ message: 'Parametri aggiornati.' });
  } catch (error) {
    console.error('❌ Errore API /theia-update-stream-params:', error);
    return res.status(500).json({ error: 'Errore aggiornamento parametri.' });
  }
});

app.post('/luna-update-stream-params', async (req, res) => {
  const { sessionId, prompt } = req.body;

  if (!sessionId || !prompt) {
    return res.status(400).json({
      error: 'sessionId e prompt sono obbligatori.'
    });
  }

  try {
    const lighter = `Capture the central theme and suggest settings and objects that give a visual idea of the topic. Be concise, maximum 20 words: "${prompt}"`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: lighter }],
        temperature: 0
      })
    });

    const data = await r.json();
    const advancedPrompt = `${data.choices?.[0]?.message?.content || ''}, ${getSense()}`;

    const streamId = await getStreamIdBySessionId(db, sessionId);
    if (!streamId) {
      return res.status(404).json({ error: 'Nessun streamId attivo.' });
    }

    const paramsPayload = {
      params: {
        prompt:
          'let the video of the girl in the center of the stream be defined. then ' +
          advancedPrompt +
          ' BEHIND A DEFINED CENTERED FIXED FRONTALLY FACING blonde woman'
      }
    };

    const response = await fetch(`${DAYDREAM_API_BASE_URL}/v1/streams/${streamId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${DAYDREAM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(paramsPayload)
    });

    if (!response.ok) {
      throw new Error(`API Update Error: ${response.statusText}`);
    }

    console.log(`✅ Luna: parametri aggiornati. [${new Date().toLocaleString()}]`);
    return res.status(200).json({ message: 'Parametri aggiornati.' });
  } catch (error) {
    console.log('❌ Errore API /luna-update-stream-params:', error);
    return res.status(500).json({ error: 'Errore aggiornamento parametri.' });
  }
});

app.get('/stats', async (req, res) => {
  try {
    const currentDb = req.app.get('db');
    const allRequests = await currentDb.all('SELECT * FROM requests ORDER BY lastRequestAt DESC');
    return res.json(allRequests);
  } catch {
    return res.status(500).send('Impossibile recuperare le statistiche');
  }
});

app.get('/random-stream', protectRoute, async (req, res) => {
  const { excludeSessionId } = req.query;

  if (!excludeSessionId) {
    return res.status(400).json({
      error: 'excludeSessionId è obbligatorio.'
    });
  }

  try {
    let randomSession = await getRandomActiveStream(db, excludeSessionId);

    if (!randomSession) {
      const userTheiaSessionId = `${excludeSessionId}_THEIA`;
      randomSession = await getOrCreateTheiaSession(db, userTheiaSessionId);
    }

    if (randomSession && randomSession.whepUrl) {
      return res.json({
        sessionId: randomSession.sessionId,
        whepUrl: `/whep/${randomSession.sessionId}`
      });
    }

    return res.status(404).json({
      message: 'Nessun altro stream attivo trovato.'
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Errore interno del server.'
    });
  }
});

io.on('connection', (socket) => {
  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    socket.userSessionId = sessionId;

    const room = io.sockets.adapter.rooms.get(sessionId);
    updateDbParticipantCount(db, sessionId, room ? room.size : 0);
  });

  socket.on('start-watching', ({ viewingSessionId }) => {
    if (!socket.userSessionId || !viewingSessionId) return;

    if (!viewersBySession[viewingSessionId]) {
      viewersBySession[viewingSessionId] = new Set();
    }

    viewersBySession[viewingSessionId].add(socket.userSessionId);
    console.log(`👀 ${socket.userSessionId} ha iniziato a guardare ${viewingSessionId}`);
  });

  socket.on('stop-watching', ({ wasViewingSessionId }) => {
    if (!socket.userSessionId || !wasViewingSessionId) return;

    if (viewersBySession[wasViewingSessionId]) {
      viewersBySession[wasViewingSessionId].delete(socket.userSessionId);
      console.log(`🙈 ${socket.userSessionId} ha smesso di guardare ${wasViewingSessionId}`);
    }
  });

  socket.on('get-participants', (requestingSessionId) => {
    const viewers = viewersBySession[requestingSessionId];
    socket.emit('participants-list', viewers ? Array.from(viewers) : []);
  });

  socket.on('request-audio-call', ({ streamerSessionId }) => {
    socket.to(streamerSessionId).emit('audio-request-received', {
      visitorSocketId: socket.id
    });
  });

  socket.on('audio-offer', ({ offer, targetSocketId }) => {
    socket.to(targetSocketId).emit('audio-offer', {
      offer,
      streamerSocketId: socket.id
    });
  });

  socket.on('audio-answer', ({ answer, targetSocketId }) => {
    socket.to(targetSocketId).emit('audio-answer', answer);
  });

  socket.on('audio-ice-candidate', ({ candidate, targetSocketId }) => {
    socket.to(targetSocketId).emit('audio-ice-candidate', candidate);
  });

  socket.on('hang-up', ({ targetSocketId }) => {
    socket.to(targetSocketId).emit('hang-up');
  });

  socket.on('share-user-message', ({ sessionId, text, interpolation }) => {
    socket.to(sessionId).emit('user-message-received', { text, interpolation });
  });

  socket.on('disconnecting', () => {
    if (socket.userSessionId) {
      for (const streamerSessionId in viewersBySession) {
        if (viewersBySession[streamerSessionId].has(socket.userSessionId)) {
          viewersBySession[streamerSessionId].delete(socket.userSessionId);
          console.log(
            `🔌 ${socket.userSessionId} disconnesso, rimosso dagli spettatori di ${streamerSessionId}`
          );
        }
      }
    }

    socket.rooms.forEach((sessionId) => {
      if (sessionId !== socket.id) {
        const room = io.sockets.adapter.rooms.get(sessionId);
        const newParticipantCount = room ? room.size - 1 : 0;
        updateDbParticipantCount(db, sessionId, newParticipantCount);
      }
    });
  });
});

app.get('/ingoya', protectRoute, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ingoya.html'));
});

app.get('/draw', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'draw.html'));
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/_interpret', protectRoute, async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Manca testo' });
    }

    const prompt = `Analizza il testo dell'utente...: "${text}"`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0
      })
    });

    const data = await r.json();
    const responseText = data.choices?.[0]?.message?.content?.trim() || '';

    return res.json(responseText);
  } catch (err) {
    console.error('Errore interpretazione comando:', err);
    return res.status(500).json({ error: err.message });
  }
});

async function startServer() {
  db = await setupDatabase();
  await closeEverySession(db);
  app.set('db', db);

  const authRouter = createAuthRouter(db);
  app.use('/auth', authRouter);
  app.use(lunaRouter);

  httpServer.listen(PORT, () => {
    console.log(`🚀 Server avviato su http://localhost:${PORT}`);
  });
}

startServer();