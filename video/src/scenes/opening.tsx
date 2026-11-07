import React from 'react';
import { AbsoluteFill, interpolate, random, useCurrentFrame } from 'remotion';
import { Background, GlitchText, TypeText, usePop } from '../components/fx';
import { C, cue, F, glow } from '../theme';

// ---------- 1. Hook: everybody disagrees ----------

const CHIPS = [
  'MARKET', 'BOT', 'AI AGENT', 'KALSHI', 'ANALYST', 'ORACLE', 'BOT', 'AGENT', 'EXCHANGE', 'SIGNAL', 'BOT', 'MODEL', 'AGENT', 'FUND',
];

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const beats = [cue('hook', 'markets'), cue('hook', 'bots'), cue('hook', 'ai')];
  const who = cue('hook', 'who');
  const scatter = interpolate(frame, [who - 4, who + 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const lines = ['MARKETS DISAGREE.', 'BOTS DISAGREE.', 'AI AGENTS DISAGREE.'];
  return (
    <AbsoluteFill>
      <Background hue={C.pink} />
      {CHIPS.map((label, i) => {
        const appear = Math.round(i * 4);
        const pop = usePop(appear, 9);
        const x = 160 + random(`cx${i}`) * 1500;
        const y = 120 + random(`cy${i}`) * 640;
        const p = Math.round(15 + random(`cp${i}${Math.floor(frame / 5)}`) * 75);
        const dx = (x - 960) * scatter * 1.5;
        const dy = (y - 450) * scatter * 1.5;
        const shake = (random(`sh${i}${frame}`) - 0.5) * 6;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x + dx + shake,
              top: y + dy,
              transform: `scale(${pop})`,
              opacity: 1 - scatter,
              padding: '10px 18px',
              border: `1px solid ${i % 2 ? C.pink : C.cyan}`,
              background: 'rgba(4,6,12,0.8)',
              borderRadius: 6,
              fontFamily: F.mono,
              color: i % 2 ? C.pink : C.cyan,
              fontSize: 26,
              boxShadow: `0 0 18px ${i % 2 ? C.pink : C.cyan}55`,
            }}
          >
            {label} <b style={{ color: C.text }}>{p}%</b>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: 120, top: 330 }}>
        {lines.map((text, i) =>
          frame >= beats[i] && frame < who ? (
            <div key={text} style={{ marginBottom: 16 }}>
              <GlitchText text={text} from={beats[i]} size={i === lines.findLastIndex((_, j) => frame >= beats[j]) ? 96 : 60} color={C.text} />
            </div>
          ) : null,
        )}
      </div>
      {frame >= who && (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 100 }}>
          <GlitchText text="WHO DO YOU TRUST?" from={who} size={120} color={C.cyan} settle={18} />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

// ---------- 2. Intro: Sibyl ----------

const Rings: React.FC<{ from: number }> = ({ from }) => {
  const frame = useCurrentFrame();
  const pop = usePop(from, 14);
  return (
    <svg width={900} height={900} style={{ position: 'absolute', left: 510, top: 40, transform: `scale(${pop})` }}>
      {[400, 340, 280].map((r, i) => (
        <circle
          key={r}
          cx={450}
          cy={450}
          r={r}
          fill="none"
          stroke={i === 1 ? C.pink : C.cyan}
          strokeWidth={i === 0 ? 2 : 4}
          strokeDasharray={i === 0 ? '4 14' : i === 1 ? '120 40 20 40' : '300 80'}
          opacity={0.7}
          transform={`rotate(${(i % 2 ? -1 : 1) * frame * (1.2 + i * 0.5)} 450 450)`}
          style={{ filter: `drop-shadow(0 0 8px ${i === 1 ? C.pink : C.cyan})` }}
        />
      ))}
    </svg>
  );
};

export const Intro: React.FC = () => {
  const name = cue('intro', 'sibyl');
  const tagline = cue('intro', 'a');
  return (
    <AbsoluteFill>
      <Background />
      <Rings from={cue('intro', 'meet') - 6} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 130 }}>
        <GlitchText text="SIBYL" from={name - 4} size={230} settle={20} />
        <div style={{ marginTop: 40, fontSize: 38, color: C.pink, letterSpacing: 6, textShadow: glow(C.pink, 10), minHeight: 50 }}>
          <TypeText text="THE FORECASTER THAT REMEMBERS WHO WAS RIGHT" from={tagline} cps={34} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------- 10. Outro ----------

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const built = cue('outro', 'built');
  const badges = [
    { name: 'WALRUS MEMORY', note: 'beliefs, lessons, episodes', color: C.cyan, at: cue('outro', 'walrus') },
    { name: 'SUI', note: 'markets, commitments, payments', color: C.pink, at: cue('outro', 'sui') },
    { name: 'TATUM', note: 'gRPC + checkpoint streams', color: C.yellow, at: cue('outro', 'tatum') },
  ];
  return (
    <AbsoluteFill>
      <Background />
      <Rings from={0} />
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 230 }}>
        <GlitchText text="SIBYL" from={2} size={200} settle={18} />
        <div style={{ marginTop: 30, fontSize: 34, color: C.pink, letterSpacing: 6, textShadow: glow(C.pink, 10) }}>
          <TypeText text="THE FORECASTER THAT REMEMBERS WHO WAS RIGHT" from={cue('outro', 'the')} cps={36} />
        </div>
        <div style={{ display: 'flex', gap: 36, marginTop: 70, opacity: frame >= built - 6 ? 1 : 0 }}>
          {badges.map((b) => (
            <Badge key={b.name} {...b} />
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Badge: React.FC<{ name: string; note: string; color: string; at: number }> = ({ name, note, color, at }) => {
  const pop = usePop(at - 4, 10);
  return (
    <div
      style={{
        transform: `scale(${pop})`,
        border: `2px solid ${color}`,
        borderRadius: 8,
        padding: '18px 34px',
        background: 'rgba(4,6,12,0.8)',
        boxShadow: `0 0 30px ${color}55`,
        textAlign: 'center',
      }}
    >
      <div style={{ fontFamily: F.display, fontSize: 34, color, textShadow: glow(color, 10), letterSpacing: 3 }}>{name}</div>
      <div style={{ fontFamily: F.mono, fontSize: 18, color: C.muted, marginTop: 6 }}>{note}</div>
    </div>
  );
};
