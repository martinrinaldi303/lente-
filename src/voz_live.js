// voz_live.js — la voz: el único lugar donde entra una API de afuera.
//
// Gemini Live API: se le manda el audio del micrófono tal cual y devuelve audio
// hablado. Escuchar, pensar y hablar es un solo tramo; no hay transcriptor ni
// sintetizador aparte. Formatos verificados el 1-oct-2026 en ai.google.dev:
//   entra  PCM 16 bits, 16 kHz, mono, little-endian
//   sale   PCM 16 bits, 24 kHz, mono, little-endian
//
// MIIA usa `@google/generative-ai` (class25B.js), que es el SDK anterior y no
// tiene Live. Éste es `@google/genai`.

import { GoogleGenAI, Modality } from '@google/genai';
import { INSTRUCCION } from './instruccion.js';

export async function conectarVoz({ apiKey, modelo, herramientas, ejecutar,
                                    alAudio, alInterrumpir, alDicho, alEstado }) {
  const ai = new GoogleGenAI({ apiKey });
  let sesion = null;

  const alMensaje = async (m) => {
    const sc = m.serverContent;
    if (sc?.interrupted) alInterrumpir();
    for (const parte of sc?.modelTurn?.parts ?? []) {
      if (parte.inlineData?.data) alAudio(Buffer.from(parte.inlineData.data, 'base64'));
    }
    if (sc?.inputTranscription?.text)  alDicho('yo', sc.inputTranscription.text);
    if (sc?.outputTranscription?.text) alDicho('miia', sc.outputTranscription.text);

    const llamadas = m.toolCall?.functionCalls ?? [];
    if (llamadas.length) {
      // Una herramienta puede tardar (identificar_dispositivo consulta a otro modelo).
      const functionResponses = await Promise.all(llamadas.map(async fc => {
        let response;
        try { response = await ejecutar(fc.name, fc.args ?? {}); }
        catch (e) { response = { ok: false, motivo: e.message }; }
        return { id: fc.id, name: fc.name, response };
      }));
      sesion?.sendToolResponse({ functionResponses });
    }
  };

  sesion = await ai.live.connect({
    model: modelo,
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: INSTRUCCION,
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      tools: [{ functionDeclarations: herramientas }],
    },
    callbacks: {
      onopen:    () => alEstado('lista'),
      onmessage: (m) => { alMensaje(m).catch(e => alEstado('error', e.message)); },
      onerror:   (e) => alEstado('error', e?.message ?? 'error de la Live API'),
      onclose:   (e) => alEstado('cerrada', e?.reason),
    },
  });

  return {
    audio(pcm)  { sesion.sendRealtimeInput({ audio: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=16000' } }); },
    frame(jpeg) { sesion.sendRealtimeInput({ video: { data: jpeg.toString('base64'), mimeType: 'image/jpeg' } }); },
    texto(t)    { sesion.sendRealtimeInput({ text: t }); },
    cerrar()    { try { sesion.close(); } catch { /* ya estaba cerrada */ } },
  };
}
