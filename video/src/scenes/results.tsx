import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Background, Counter, usePop } from '../components/fx';
import { C, cue, F, glow } from '../theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const STATS = [
  { word: 'seven', to: 727, label: 'scored calls', decimals: 0, prefix: '', suffix: '', color: C.cyan },
  { word: 'six', to: 6.3, label: 'lower error than no memory · all time', decimals: 1, prefix: '−', suffix: '%', color: C.green },
  { word: 'sixteen', to: 16, label: 'lower error · last 24 hours', decimals: 0, prefix: '−', suffix: '%', color: C.green },
  { word: 'every', to: 900, label: 'memories on Walrus mainnet', decimals: 0, prefix: '', suffix: '', color: C.cyan },
  { word: 'here', to: 204, label: 'forecast commitments on Sui', decimals: 0, prefix: '', suffix: '', color: C.pink },
  { word: 'live', to: 84, label: 'analyst signals paid in USDC', decimals: 0, prefix: '', suffix: '', color: C.yellow },
];

export const Results: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const pan = interpolate(frame, [0, durationInFrames], [0, -520], clamp);
  const tilt = interpolate(frame, [0, durationInFrames], [14, 8], clamp);
  return (
    <AbsoluteFill>
      <Background />
      <div style={{ position: 'absolute', left: 60, top: 70, width: 1080, height: 760, perspective: 1600 }}>
        <div
          style={{
            width: 1080,
            height: 760,
            overflow: 'hidden',
            transform: `rotateY(${tilt}deg) rotateX(4deg)`,
            border: `2px solid ${C.cyan}`,
            borderRadius: 12,
            boxShadow: `0 0 50px ${C.cyan}55`,
          }}
        >
          <Img src={staticFile('shots/live.png')} style={{ width: 1080, transform: `translateY(${pan}px)` }} />
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 18, color: C.muted, marginTop: 14, letterSpacing: 3 }}>LIVE DASHBOARD · localhost:8787</div>
      </div>
      <div style={{ position: 'absolute', left: 1210, top: 80, width: 650 }}>
        {STATS.map((s) => (
          <Stat key={s.label} {...s} at={cue('results', s.word)} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Stat: React.FC<(typeof STATS)[number] & { at: number }> = ({ to, label, decimals, prefix, suffix, color, at }) => {
  const pop = usePop(at - 4, 12);
  return (
    <div style={{ transform: `translateX(${(1 - pop) * 120}px)`, opacity: pop, marginBottom: 18, borderLeft: `4px solid ${color}`, paddingLeft: 20 }}>
      <Counter to={to} from={at - 4} frames={22} decimals={decimals} prefix={prefix} suffix={suffix} style={{ fontSize: 60, fontWeight: 800, color, textShadow: glow(color, 14) }} />
      <div style={{ fontFamily: F.mono, fontSize: 20, color: C.text, letterSpacing: 1 }}>{label}</div>
    </div>
  );
};
