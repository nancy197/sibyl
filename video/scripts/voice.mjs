/**
 * Narration with ElevenLabs: one MP3 per scene plus word timings for the captions.
 * Writes public/voice/<id>.mp3 and src/voice.json. Keys come from video/.env (never printed).
 *   pnpm voice            # skips scenes that already have audio
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => {
      const [key, ...rest] = line.split('=');
      return [key.trim(), rest.join('=').trim().replace(/^"|"$/g, '')];
    }),
);
const keys = [env.ELEVENLABS_API_KEY_2, env.ELEVENLABS_API_KEY, env.ELEVENLABS_API_KEY_3].filter(Boolean);

const VOICE_ID = 'nPczCjzI2devNBz1zQrb'; // Brian: deep, resonant narrator
const MODEL = 'eleven_multilingual_v2';
const settings = { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true };

const script = JSON.parse(readFileSync(new URL('../src/script.json', import.meta.url), 'utf8'));
const outDir = new URL('../public/voice/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const manifestPath = new URL('../src/voice.json', import.meta.url);
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

/** Group character timings into words. */
function words(alignment) {
  const out = [];
  let current = null;
  alignment.characters.forEach((ch, i) => {
    const start = alignment.character_start_times_seconds[i];
    const end = alignment.character_end_times_seconds[i];
    if (/\s/.test(ch)) {
      if (current) out.push(current);
      current = null;
    } else if (!current) current = { text: ch, start, end };
    else {
      current.text += ch;
      current.end = end;
    }
  });
  if (current) out.push(current);
  return out;
}

async function speak(text) {
  for (const key of keys) {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ text, model_id: MODEL, voice_settings: settings }),
      },
    );
    if (response.ok) return response.json();
    console.warn(`key rejected (${response.status}): ${(await response.text()).slice(0, 120)}`);
  }
  throw new Error('no ElevenLabs key could synthesize this line');
}

for (const scene of script) {
  const file = new URL(`${scene.id}.mp3`, outDir);
  if (existsSync(file) && manifest[scene.id]?.text === scene.text) {
    console.log(`skip ${scene.id}`);
    continue;
  }
  const result = await speak(scene.text);
  writeFileSync(file, Buffer.from(result.audio_base64, 'base64'));
  const w = words(result.alignment);
  manifest[scene.id] = { text: scene.text, duration: w.at(-1).end, words: w };
  console.log(`${scene.id}: ${w.at(-1).end.toFixed(2)}s, ${w.length} words`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}
