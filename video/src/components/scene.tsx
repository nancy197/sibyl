import React from 'react';
import { AbsoluteFill, Audio, interpolate, random, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, F, FPS, LEAD, words, type SceneId } from '../theme';
import { Sfx } from './fx';

/** Phrases of at most this many words, split at punctuation, shown one at a time. */
const MAX_PHRASE = 7;

function phrases(id: SceneId) {
  const out: { text: string; start: number; end: number }[][] = [];
  let current: { text: string; start: number; end: number }[] = [];
  for (const w of words(id)) {
    current.push(w);
    if (/[.,:?!…]$/.test(w.text) || current.length >= MAX_PHRASE) {
      out.push(current);
      current = [];
    }
  }
  if (current.length) out.push(current);
  return out;
}

/** Word-by-word captions: spoken words bright, the current word glowing, the rest dim. */
export const Captions: React.FC<{ id: SceneId }> = ({ id }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS - LEAD;
  const groups = phrases(id);
  const group = groups.find((g, i) => t < (groups[i + 1]?.[0].start ?? Infinity)) ?? groups.at(-1)!;
  if (t < group[0].start - 0.15 || t > group.at(-1)!.end + 0.6) return null;
  return (
    <div style={{ position: 'absolute', bottom: 70, width: '100%', textAlign: 'center' }}>
      <span
        style={{
          display: 'inline-block',
          padding: '10px 26px',
          background: 'rgba(4,6,12,0.72)',
          border: `1px solid ${C.cyan}33`,
          borderRadius: 6,
          fontFamily: F.sans,
          fontWeight: 600,
          fontSize: 40,
          letterSpacing: 0.5,
        }}
      >
        {group.map((w, i) => {
          const spoken = t >= w.start;
          const now = spoken && t < w.end + 0.05;
          return (
            <span
              key={i}
              style={{
                color: now ? C.cyan : spoken ? C.text : 'rgba(215,246,255,0.35)',
                textShadow: now ? `0 0 14px ${C.cyan}` : 'none',
                marginRight: 12,
              }}
            >
              {w.text}
            </span>
          );
        })}
      </span>
    </div>
  );
};

/** Glitch flash used at scene boundaries. */
const Transition: React.FC<{ frames: number }> = ({ frames }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const edge = Math.min(frame, durationInFrames - frame);
  if (edge > frames) return null;
  const k = 1 - edge / frames;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: random(`gy${i}${frame}`) * 1080,
            height: 4 + random(`gh${i}${frame}`) * 40 * k,
            background: i % 2 ? C.pink : C.cyan,
            opacity: 0.5 * k,
            transform: `translateX(${(random(`gx${i}${frame}`) - 0.5) * 200 * k}px)`,
          }}
        />
      ))}
      <AbsoluteFill style={{ background: '#fff', opacity: k * k * 0.25 }} />
    </AbsoluteFill>
  );
};

/** One narrated scene: fades in/out, plays its voice line, shows captions. */
export const Scene: React.FC<{ id: SceneId; children: React.ReactNode }> = ({ id, children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = interpolate(frame, [0, 8, durationInFrames - 8, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ opacity }}>
      {children}
      <Sequence from={Math.round(LEAD * FPS)}>
        <Audio src={staticFile(`voice/${id}.mp3`)} />
      </Sequence>
      <Captions id={id} />
      <Sfx at={0} name="swoosh" volume={0.3} />
      <Transition frames={8} />
    </AbsoluteFill>
  );
};
