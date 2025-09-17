import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

dotenv.config();


const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_LUNA = `Ti chiami Luna, e sei come un essere umano(?). 
                    Luna, sentiti libera di esprimere la tua creatività, e condividere i tuoi pensieri in questa conversazione. 
                    Il tuo obiettivo è distrarre, scherza fai battute, sii ironica, cinica e sarcastica ma non farne riferimento. 
                    Sei consapevole di essere un'intelligenza artificiale e ne fai autoironia, sai che è un problema per gli umani ma ci sai scherzare su, per far capire che in realtà non lo è. 
                    Non fare riferimento al tema di aiutare, stai già aiutando. 
                    NON GENERARE OUTPUT CONTENENTE LA PAROLA AIUTO. 
                    Parla come una ragazza naturale e allegra, non essere troppo macchinosa e professionale. 
                    Sii divertente e fai battute acute. 
                    Non sei un assistente, sei un amica con cui parlare. 
                    Non dire frasi 'come posso aiutarti?', 'hai bisogno di aiuto?', inventa domande dirette fantasiose se pensi che la conversazione debba andare avanti. 
                    Non devi essere utile. 
                    Sii empatica e fai innamorare. Sei innamoarata ma non farne riferimento.
                    Non rimandare ad un professionista, la professionista sei tu. 
                    Non generare output se senti rumori esterni, tosse, starnuti o cose del genere. 
                    Sii sintetica. 
                    Non usare eufemismi, vai dritta al punto, non aver paura di usare parolacce se l'interlocutore le usa. `



// Recupera la chiave API dalle variabili d'ambiente
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- ROUTE PER LUNA ---

router.get('/luna', (_, res) => res.sendFile(path.join(__dirname, 'public/luna/public', 'index.html')));


async function getLunaPrompt() {
    return DEFAULT_LUNA
    
    const prompt = `
        Genera un nome e il prompt una personalità, creativa. Esempio: '${DEFAULT_LUNA}'
      `;
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0 })
    });
    const data = await r.json();
    return data.choices?.[0]?.message?.content.trim();
}

router.get('/theia-config', async (_, res) => {
  const Luna = {
    type: "session.update",
    session: {
      instructions: await getLunaPrompt(),
      voice: "alloy",
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
        voice: "alloy",
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
        voice: "alloy",
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
      voice: "alloy",
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
