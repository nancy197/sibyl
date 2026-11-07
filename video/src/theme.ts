import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import { loadFont as loadOrbitron } from '@remotion/google-fonts/Orbitron';
import voice from './voice.json';

export const FPS = 30;

export const C = {
  bg: '#04060c',
  panel: 'rgba(8, 14, 26, 0.82)',
  line: 'rgba(0, 240, 255, 0.22)',
  text: '#d7f6ff',
  muted: '#6f8aa3',
  cyan: '#00f0ff',
  pink: '#ff2bd6',
  yellow: '#f5d90a',
  green: '#39ff88',
  red: '#ff3b6b',
};

export const F = {
  display: loadOrbitron().fontFamily,
  mono: loadMono().fontFamily,
  sans: loadInter().fontFamily,
};

export const glow = (color: string, size = 18) => `0 0 ${size}px ${color}, 0 0 2px #fff`;

// ---------- scene timing from the narration ----------

export type SceneId = keyof typeof voice;
type Word = { text: string; start: number; end: number };

/** Silence before the narrator starts, and after they finish, in each scene. */
export const LEAD = 0.5;
export const TAIL = 0.9;

export const sceneFrames = (id: SceneId) => Math.round((LEAD + voice[id].duration + TAIL) * FPS);
export const words = (id: SceneId): Word[] => voice[id].words;

/**
 * Frame (within the scene) at which the narrator says the n-th word that starts with `prefix`.
 * Visual beats are tied to these, so animation stays in sync if the voice is regenerated.
 */
export function cue(id: SceneId, prefix: string, nth = 0): number {
  const hits = voice[id].words.filter((w: Word) => w.text.toLowerCase().replace(/[^a-z0-9$]/g, '').startsWith(prefix.toLowerCase()));
  const word = hits[nth] ?? hits[0];
  if (!word) throw new Error(`no word "${prefix}" in scene ${id}`);
  return Math.round((LEAD + word.start) * FPS);
}

/** Scenes overlap by this many frames for the cross-glitch transition. */
export const OVERLAP = 8;
