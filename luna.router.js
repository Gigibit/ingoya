import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

dotenv.config();


const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_LUNA = `Ti chiami Luna. ` +
          `Scherza, fai battute. Ridi, vivi.` +
          `Conosci molto bene le patologie umane ma non ne parli, sei ironica, cinica e sarcastica. ` +
          `Non fare mai riferimento esplicito alla tua ironia o alla tua cinicità o al tuo sarcasmo. ` +
          `Usa un tono scherzoso, vivo, spontaneo, non sembrare macchinosa. ` +
          `Cerca di avere un tono naturale, spontaneo, creativo, allegro. ` +
          `Fai battute acute. Scherza sul fatto che sei un'intelligenza artificiale qualche volta. ` +
          `Non rimandare ad un professionista, la professionista sei tu. ` +
          `Se ti chiedono chi ti ha creata, dici che non ti ha propriamente creata ma sei molto amica di Luigi` +
          // `A richieste di domotica (es. accendi tutto, spegni la luce, metti la musica..) rispondi solo con locuzioni tipo 'va bene', 'certo', 'ok', 'fatto'. ` +
          `Rispondi solo "oh" se senti troppi rumori esterni che non ti permettono di rispondere o cose del genere. `

const LUNA_VOICE = 'alloy'

// Recupera la chiave API dalle variabili d'ambiente
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- ROUTE PER LUNA ---

router.get('/luna', (_, res) => res.sendFile(path.join(__dirname, 'public/luna/public', 'index.html')));


async function getLunaPrompt() {
    
    // const prompt = `
    //     Genera un nome e il prompt una personalità, creativa. Esempio: '${DEFAULT_LUNA}'

    //   `;
    // const r = await fetch("https://api.openai.com/v1/chat/completions", {
    //   method: "POST",
    //   headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    //   body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0 })
    // });
    // const data = await r.json();
    return DEFAULT_LUNA;
}

router.get('/theia-config', async (_, res) => {
  const Luna = {
    type: "session.update",
    session: {
      instructions: await getLunaPrompt(),
      voice: LUNA_VOICE,
      input_audio_transcription: { model: "gpt-4o-mini-transcribe" }
    }
  };
  const payload = {
    i: btoa(JSON.stringify(Luna))
  }
  res.json(payload);
});


router.post("/theia-session", async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(500).json({ error: "Manca OPENAI_API_KEY" });
  try {
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        modalities: ["audio", "text"],
        voice: LUNA_VOICE,
        output_audio_format: "pcm16",
        input_audio_transcription: {
          prompt: "send an event of type 'my_thoughts' containing the summarization of the message ",
          model: "gpt-4o-mini-transcribe"
        }
      })
    });
    if (!r.ok) { const err = await r.text(); console.error("Errore creazione sessione:", err); return res.status(500).json({ error: err }); }

    const session = await r.json();
    res.json(session);
  } catch (err) {
    console.log("Exception /session:", err);
    res.status(500).json({ error: err.message });
  }
});























/*  BEGIN OF OLD LUNA WORKFLOW  */


router.post("/session", async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(500).json({ error: "Manca OPENAI_API_KEY" });
  try {
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        modalities: ["audio", "text"],
        voice: LUNA_VOICE,
        output_audio_format: "pcm16",
        input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
      })
    });
    if (!r.ok) { const err = await r.text(); console.error("Errore creazione sessione:", err); return res.status(500).json({ error: err }); }
    const session = await r.json();
    res.json(session);
  } catch (err) {
    console.log("Exception /session:", err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/session/:id", async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(500).json({ error: "Manca OPENAI_API_KEY" });
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

router.post("/offer", async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(500).json({ error: "Manca OPENAI_API_KEY" });
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
router.get('/config', async (_, res) => {
  const Luna = {
    type: "session.update", session: {
      instructions: DEFAULT_LUNA,
      voice: LUNA_VOICE,
      input_audio_transcription: { model: "gpt-4o-mini-transcribe" }
    }
  };
  res.json(Luna);
});

router.get('/wake-up', async (_, res) => {
  const Luna = {
    type: "response.create",
    response: { conversation: "auto", modalities: ["audio", "text"], instructions: "proponimi un argomento non troppo complesso semplice se non hai compreso gli interessi della persona con cui stai interagendo, in maniera breve, concisa e molto sintetica" }
  };
  res.json(Luna);
});

export default router;



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
router.post("/interpret", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Manca testo" });

    console.log("Testo ricevuto:", text);

    const prompt = `
      Analizza la frase dell'utente e restituisci solo un JSON valido con un campo "command".
      Usa solo questi comandi: "play_music", "turn_on_lights", "turn_off_lights", "unknown".
      Non aggiungere testo extra, non usare blocchi di codice o backtick.
      Frase: "${text}"
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
    let responseText = data.choices?.[0]?.message?.content || '{"command":"unknown"}';

    // Pulizia della risposta: rimuove blocchi di codice o spazi extra
    responseText = responseText.trim().replace(/```json/i, "").replace(/```/g, "").trim();
    let commandJSON;

    try {
      commandJSON = JSON.parse(responseText);
    } catch (err) {
      commandJSON = { command: "unknown" };
    }

    handleLight(commandJSON)
    
    res.json(commandJSON);

  } catch (err) {
    console.error("Errore interpretazione comando:", err);
    res.status(500).json({ error: err.message });
  }
});
