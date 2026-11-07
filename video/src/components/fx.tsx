import React from 'react';
import { AbsoluteFill, Audio, interpolate, random, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, F, glow } from '../theme';

/** Scrolling perspective grid, drifting particles, scanlines and vignette. */
export const Background: React.FC<{ hue?: string }> = ({ hue = C.cyan }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(900px 500px at 75% 10%, ${hue}22, transparent 60%), radial-gradient(800px 500px at 10% 30%, ${C.pink}18, transparent 60%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '-50%',
          width: '200%',
          bottom: -200,
          height: 700,
          transform: 'perspective(500px) rotateX(62deg)',
          backgroundImage: `linear-gradient(${hue}44 1px, transparent 1px), linear-gradient(90deg, ${hue}44 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
          backgroundPosition: `0 ${(frame * 2) % 60}px`,
          maskImage: 'linear-gradient(to top, black, transparent 85%)',
          WebkitMaskImage: 'linear-gradient(to top, black, transparent 85%)',
        }}
      />
      {Array.from({ length: 40 }, (_, i) => {
        const x = random(`px${i}`) * 1920;
        const speed = 0.3 + random(`ps${i}`) * 0.8;
        const y = (random(`py${i}`) * 1080 - frame * speed * 2 + 1080 * 4) % 1080;
        const size = 1 + random(`pz${i}`) * 2.5;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: '50%',
              background: i % 3 ? hue : C.pink,
              opacity: 0.35 + random(`po${i}`) * 0.4,
              boxShadow: `0 0 8px ${hue}`,
            }}
          />
        );
      })}
      <AbsoluteFill
        style={{
          background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.25) 0 1px, transparent 1px 3px)',
          mixBlendMode: 'multiply',
        }}
      />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.75))' }} />
    </AbsoluteFill>
  );
};

/** Text with an RGB-split glitch that settles over `settle` frames from `from`. */
export const GlitchText: React.FC<{
  text: string;
  from?: number;
  settle?: number;
  size: number;
  color?: string;
  font?: string;
  style?: React.CSSProperties;
}> = ({ text, from = 0, settle = 14, size, color = C.cyan, font = F.display, style }) => {
  const frame = useCurrentFrame();
  const t = frame - from;
  if (t < 0) return null;
  const k = Math.max(0, 1 - t / settle);
  const jitter = (seed: string) => (random(`${seed}${Math.floor(t / 2)}`) - 0.5) * 30 * k;
  const visible = text.slice(0, Math.ceil(text.length * Math.min(1, t / (settle * 0.6) + 0.15)));
  const base: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    fontFamily: font,
    fontSize: size,
    fontWeight: 800,
    letterSpacing: size * 0.06,
    whiteSpace: 'nowrap',
  };
  return (
    <div style={{ position: 'relative', fontFamily: font, fontSize: size, fontWeight: 800, letterSpacing: size * 0.06, whiteSpace: 'nowrap', ...style }}>
      <span style={{ visibility: 'hidden' }}>{text}</span>
      <span style={{ ...base, color: C.pink, transform: `translate(${jitter('a') - 4 * k}px, ${jitter('b')}px)`, opacity: 0.8 * k }}>{visible}</span>
      <span style={{ ...base, color: C.cyan, transform: `translate(${jitter('c') + 4 * k}px, ${jitter('d')}px)`, opacity: 0.8 * k }}>{visible}</span>
      <span style={{ ...base, color, textShadow: glow(color, size / 4) }}>{visible}</span>
    </div>
  );
};

/** Characters appear one by one from `from`, with a blinking block cursor. */
export const TypeText: React.FC<{ text: string; from?: number; cps?: number; style?: React.CSSProperties }> = ({
  text,
  from = 0,
  cps = 40,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const n = Math.max(0, Math.floor(((frame - from) / fps) * cps));
  const done = n >= text.length;
  return (
    <span style={{ fontFamily: F.mono, ...style }}>
      {text.slice(0, n)}
      <span style={{ opacity: done && Math.floor(frame / 15) % 2 ? 0 : 1, color: C.cyan }}>▌</span>
    </span>
  );
};

/** Pop-in scale for elements, driven by a spring from `from`. */
export function usePop(from: number, damping = 12) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - from, fps, config: { damping, mass: 0.6 } });
}

/** A HUD panel with neon corners. */
export const Panel: React.FC<{ style?: React.CSSProperties; color?: string; children: React.ReactNode }> = ({
  style,
  color = C.cyan,
  children,
}) => {
  const corner = (pos: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute',
    width: 22,
    height: 22,
    borderColor: color,
    borderStyle: 'solid',
    borderWidth: 0,
    ...pos,
  });
  return (
    <div
      style={{
        position: 'absolute',
        background: C.panel,
        border: `1px solid ${color}33`,
        boxShadow: `0 0 30px ${color}22, inset 0 0 30px ${color}11`,
        borderRadius: 6,
        padding: 24,
        ...style,
      }}
    >
      <div style={corner({ left: -1, top: -1, borderLeftWidth: 3, borderTopWidth: 3 })} />
      <div style={corner({ right: -1, top: -1, borderRightWidth: 3, borderTopWidth: 3 })} />
      <div style={corner({ left: -1, bottom: -1, borderLeftWidth: 3, borderBottomWidth: 3 })} />
      <div style={corner({ right: -1, bottom: -1, borderRightWidth: 3, borderBottomWidth: 3 })} />
      {children}
    </div>
  );
};

/** Counts up from 0 to `to` between `from` and `from + frames`. */
export const Counter: React.FC<{ to: number; from: number; frames?: number; decimals?: number; prefix?: string; suffix?: string; style?: React.CSSProperties }> = ({
  to,
  from,
  frames = 30,
  decimals = 0,
  prefix = '',
  suffix = '',
  style,
}) => {
  const frame = useCurrentFrame();
  const v = interpolate(frame, [from, from + frames], [0, to], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: (x) => 1 - (1 - x) ** 3 });
  return <span style={{ fontFamily: F.mono, ...style }}>{prefix + v.toFixed(decimals) + suffix}</span>;
};

/** Random hex string that scrambles until `settleAt`. */
export const Hash: React.FC<{ seed: string; len?: number; settleAt: number; style?: React.CSSProperties }> = ({ seed, len = 10, settleAt, style }) => {
  const frame = useCurrentFrame();
  const chars = '0123456789abcdef';
  const final = Array.from({ length: len }, (_, i) => chars[Math.floor(random(`${seed}${i}`) * 16)]).join('');
  const shown =
    frame >= settleAt ? final : Array.from({ length: len }, (_, i) => chars[Math.floor(random(`${seed}${i}${frame}`) * 16)]).join('');
  return <span style={{ fontFamily: F.mono, ...style }}>0x{shown}</span>;
};

/** A short sound effect at frame `at` of the current scene. */
export const Sfx: React.FC<{ at: number; name?: 'blip' | 'swoosh'; volume?: number }> = ({ at, name = 'blip', volume = 0.5 }) => (
  <Sequence from={Math.max(0, at)} durationInFrames={45}>
    <Audio src={staticFile(`sfx/${name}.mp3`)} volume={volume} />
  </Sequence>
);
