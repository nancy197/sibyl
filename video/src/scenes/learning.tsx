import React from 'react';
import { AbsoluteFill, interpolate, random, useCurrentFrame } from 'remotion';
import { Background, Counter, GlitchText, Panel, Sfx, TypeText, usePop } from '../components/fx';
import { C, cue, F, glow } from '../theme';
import { Stamp, Tag } from './council';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = (x: number) => 1 - (1 - x) ** 3;

// ---------- 5. Score: settle, score, re-weight ----------

const VOICES = [
  { name: 'DeepBook', p: 0.68, brier: 0.102, w: 0.34, color: C.cyan },
  { name: 'Kalshi', p: 0.63, brier: 0.137, w: 0.3, color: C.pink },
  { name: 'Random-walk', p: 0.64, brier: 0.13, w: 0.14, color: C.yellow },
  { name: 'Momentum', p: 0.61, brier: 0.152, w: 0.12, color: C.yellow },
  { name: 'Mean-rev', p: 0.58, brier: 0.176, w: 0.1, color: C.yellow },
];

export const Score: React.FC = () => {
  const frame = useCurrentFrame();
  const settles = cue('score', 'settles');
  const scores = cue('score', 'scores');
  const condition = cue('score', 'condition');
  const shifts = cue('score', 'shifts');
  const tickerPop = usePop(settles - 6);
  const ctxPop = usePop(condition - 4);
  const move = interpolate(frame, [shifts, shifts + 30], [0, 1], { ...clamp, easing: ease });
  return (
    <AbsoluteFill>
      <Background hue={C.green} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 70, textAlign: 'center', transform: `scale(${tickerPop})` }}>
        <span style={{ fontFamily: F.mono, fontSize: 30, color: C.muted, letterSpacing: 4 }}>ORACLE SETTLED </span>
        <span style={{ fontFamily: F.display, fontSize: 64, color: C.green, textShadow: glow(C.green, 18) }}>$75,812.21 ▲ UP</span>
      </div>
      <div style={{ position: 'absolute', left: 1330, top: 190, transform: `scale(${ctxPop})` }}>
        <Tag color={C.pink}>CONTEXT 15m · low vol · asia</Tag>
      </div>
      <Panel style={{ left: 230, top: 260, width: 1460, height: 520 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '220px 140px 200px 1fr 110px', fontFamily: F.mono, color: C.muted, fontSize: 20, letterSpacing: 2, marginBottom: 18 }}>
          <span>VOICE</span>
          <span>SAID</span>
          <span>ERROR</span>
          <span>TRUST</span>
          <span />
        </div>
        {VOICES.map((v, i) => {
          const scored = frame >= scores + i * 5;
          const w = 0.2 + (v.w - 0.2) * move;
          return (
            <div key={v.name} style={{ display: 'grid', gridTemplateColumns: '220px 140px 200px 1fr 110px', alignItems: 'center', height: 84 }}>
              <span style={{ fontFamily: F.display, fontSize: 26, color: v.color, textShadow: glow(v.color, 8) }}>{v.name}</span>
              <span style={{ fontFamily: F.mono, fontSize: 30, color: C.text }}>{Math.round(v.p * 100)}%</span>
              <span style={{ fontFamily: F.mono, fontSize: 30, color: scored ? (v.brier < 0.14 ? C.green : C.red) : C.muted }}>
                {scored ? v.brier.toFixed(3) : '···'}
              </span>
              <div style={{ height: 22, background: 'rgba(255,255,255,0.05)', borderRadius: 11, overflow: 'hidden', marginRight: 24 }}>
                <div style={{ width: `${w * 250}%`, height: '100%', background: v.color, boxShadow: glow(v.color, 12), borderRadius: 11 }} />
              </div>
              <span style={{ fontFamily: F.mono, fontSize: 30, color: C.text }}>{Math.round(w * 100)}%</span>
            </div>
          );
        })}
      </Panel>
      {frame >= shifts && (
        <div style={{ position: 'absolute', left: 230, top: 800, fontFamily: F.mono, fontSize: 26, color: C.cyan, opacity: move }}>
          Hedge update: w ← w · e^(−η · error) · per context · memory stored in Walrus
        </div>
      )}
    </AbsoluteFill>
  );
};

// ---------- 6. Lessons: tested, then applied ----------

const HYPOTHESES = [
  ['beats(deepbook, momentum)', '15m/high/eu', 0.21],
  ['bias(kalshi)', '5m/low/asia', 0.44],
  ['overconfident(randomwalk)', '1m/low/asia', 0.09],
  ['beats(momentum, meanrev)', '15m/mid/us', 0.63],
  ['bias(meanrev)', '15m/mid/us', 0.18],
  ['beats(kalshi, deepbook)', '5m/mid/us', 0.37],
  ['overconfident(momentum)', '15m/mid/us', 0.052],
  ['beats(randomwalk, kalshi)', '15m/high/asia', 0.33],
] as const;

export const Lessons: React.FC = () => {
  const frame = useCurrentFrame();
  const patterns = cue('lessons', 'patterns');
  const kalshi = cue('lessons', 'kalshi');
  const there = cue('lessons', 'there');
  const cardPop = usePop(kalshi - 6, 11);
  const shown = Math.floor(interpolate(frame, [patterns, kalshi - 10], [0, HYPOTHESES.length], clamp));
  return (
    <AbsoluteFill>
      <Background />
      <Panel style={{ left: 120, top: 110, width: 820, height: 690 }}>
        <div style={{ fontFamily: F.mono, fontSize: 20, color: C.pink, letterSpacing: 3, marginBottom: 16 }}>
          &gt; testing 34 hypotheses · n ≥ 30 · Bonferroni
        </div>
        {HYPOTHESES.slice(0, shown).map(([h, ctx, p], i) => (
          <div key={i} style={{ fontFamily: F.mono, fontSize: 22, color: C.muted, height: 58, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: C.text }}>{h}</span>
            <span>{ctx}</span>
            <span style={{ color: C.red }}>p={p} ✗</span>
          </div>
        ))}
      </Panel>
      {frame >= kalshi - 6 && (
        <div style={{ position: 'absolute', left: 1000, top: 170, width: 800, transform: `scale(${cardPop})` }}>
          <Panel color={C.green} style={{ position: 'relative' }}>
            <div style={{ fontFamily: F.display, fontSize: 24, color: C.green, letterSpacing: 4 }}>LESSON PROMOTED</div>
            <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 44, color: C.text, marginTop: 14, lineHeight: 1.2 }}>
              “Kalshi beats the mean-reversion analyst in 15m / mid-vol / US hours”
            </div>
            <div style={{ display: 'flex', gap: 30, marginTop: 20, fontFamily: F.mono, fontSize: 26, color: C.cyan }}>
              <span>ΔBrier 0.0517</span>
              <span>p = 0.0014</span>
              <span>n = 45</span>
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 24, color: C.muted, marginTop: 20, minHeight: 34 }}>
              {frame >= there - 4 && <TypeText text="effect → leave mean-rev out of bets here, stop buying it" from={there - 4} cps={45} />}
            </div>
          </Panel>
        </div>
      )}
      {frame >= there + 10 && <Stamp at={there + 10} text="EXCLUDED HERE" x={1150} y={640} color={C.red} />}
      <Sfx at={kalshi - 6} />
      <Sfx at={there + 10} name="swoosh" volume={0.4} />
    </AbsoluteFill>
  );
};

// ---------- 7. Recall: Walrus Memory ----------

const MATCHES = [
  ['15m · low vol · asia · council far above market', true],
  ['15m · mid vol · asia · council far above market', true],
  ['15m · low vol · asia · council slightly above', true],
  ['15m · high vol · asia · council far above market', true],
  ['15m · mid vol · asia · council slightly above', false],
  ['15m · low vol · asia · council far above market', true],
] as const;

const Hex: React.FC<{ x: number; y: number; size: number; lit: number }> = ({ x, y, size, lit }) => (
  <div
    style={{
      position: 'absolute',
      left: x,
      top: y,
      width: size,
      height: size * 1.15,
      clipPath: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)',
      background: `rgba(0, 240, 255, ${0.08 + lit * 0.7})`,
      boxShadow: lit > 0.5 ? `0 0 20px ${C.cyan}` : 'none',
    }}
  />
);

export const Recall: React.FC = () => {
  const frame = useCurrentFrame();
  const walrus = cue('recall', 'walrus');
  const recalls = cue('recall', 'recalls');
  const asks = cue('recall', 'asks');
  const right = cue('recall', 'right');
  const memPop = usePop(walrus - 10);
  const resultPop = usePop(right + 4);
  return (
    <AbsoluteFill>
      <Background />
      <div style={{ position: 'absolute', left: 90, top: 120, width: 640, height: 620, transform: `scale(${memPop})` }}>
        {Array.from({ length: 48 }, (_, i) => {
          const row = Math.floor(i / 6);
          const col = i % 6;
          const lit = random(`h${i}${Math.floor(frame / 8)}`) > 0.75 ? 1 : 0.1;
          return <Hex key={i} x={col * 100 + (row % 2) * 50} y={row * 74} size={90} lit={lit} />;
        })}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 250, textAlign: 'center' }}>
          <div style={{ fontFamily: F.display, fontSize: 44, color: C.text, textShadow: glow(C.cyan, 16), letterSpacing: 3 }}>WALRUS MEMORY</div>
          <Counter to={900} from={walrus} frames={40} suffix=" memories · mainnet" style={{ fontSize: 26, color: C.cyan }} />
        </div>
      </div>
      {frame >= recalls - 6 && (
        <Panel style={{ left: 820, top: 110, width: 1010, height: 110 }}>
          <div style={{ fontFamily: F.mono, fontSize: 18, color: C.pink, letterSpacing: 3 }}>RECALL (SEMANTIC SEARCH)</div>
          <div style={{ fontSize: 24, color: C.text, marginTop: 6 }}>
            <TypeText text="15m BTC, low volatility, asia session: council far above the market" from={recalls - 4} cps={60} />
          </div>
        </Panel>
      )}
      {MATCHES.map(([text, ok], i) => {
        const at = asks + i * 5;
        const fly = interpolate(frame, [at, at + 14], [0, 1], { ...clamp, easing: ease });
        if (fly === 0) return null;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: interpolate(fly, [0, 1], [400, 860]),
              top: interpolate(fly, [0, 1], [430, 260 + i * 72]),
              opacity: fly,
              width: 930,
              fontFamily: F.mono,
              fontSize: 22,
              color: C.text,
              padding: '12px 18px',
              border: `1px solid ${ok ? C.green : C.red}`,
              borderRadius: 6,
              background: 'rgba(4,6,12,0.88)',
              boxShadow: `0 0 14px ${ok ? C.green : C.red}44`,
            }}
          >
            <span style={{ color: ok ? C.green : C.red, marginRight: 14 }}>{ok ? '✓ SIBYL RIGHT' : '✗ MARKET RIGHT'}</span>
            {text}
          </div>
        );
      })}
      <Sfx at={right + 4} />
      {frame >= right + 4 && (
        <div style={{ position: 'absolute', left: 860, top: 720, transform: `scale(${resultPop})`, transformOrigin: 'left' }}>
          <span style={{ fontFamily: F.display, fontSize: 52, color: C.green, textShadow: glow(C.green, 16) }}>9 / 10 RIGHT</span>
          <span style={{ fontFamily: F.mono, fontSize: 30, color: C.text, marginLeft: 24 }}>→ edge needed −2.0pt</span>
        </div>
      )}
    </AbsoluteFill>
  );
};

// ---------- 8. Amnesia: wipe and rebuild ----------

export const Amnesia: React.FC = () => {
  const frame = useCurrentFrame();
  const wipe = cue('amnesia', 'wipe');
  const rebuilds = cue('amnesia', 'rebuilds');
  const exact = cue('amnesia', 'exact');
  const passPop = usePop(exact - 2);
  const cells = 8 * 5;
  const restored = interpolate(frame, [rebuilds, exact], [0, cells], clamp);
  const wiped = frame >= wipe + 4;
  return (
    <AbsoluteFill>
      <Background hue={wiped && frame < rebuilds ? C.red : C.cyan} />
      <div style={{ position: 'absolute', left: 560, top: 150, width: 800 }}>
        <div style={{ fontFamily: F.mono, fontSize: 22, color: C.muted, letterSpacing: 4, marginBottom: 14, textAlign: 'center' }}>
          SIBYL'S BRAIN · TRUST · LESSONS · POLICY
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 8 }}>
          {Array.from({ length: cells }, (_, i) => {
            const w = random(`w${i}`);
            const back = !wiped || i < restored;
            const noise = random(`n${i}${frame}`);
            return (
              <div
                key={i}
                style={{
                  height: 70,
                  borderRadius: 6,
                  background: back ? `rgba(0,240,255,${0.15 + w * 0.7})` : `rgba(255,59,107,${noise * 0.35})`,
                  boxShadow: back && w > 0.7 ? `0 0 14px ${C.cyan}` : 'none',
                  fontFamily: F.mono,
                  fontSize: 18,
                  color: '#012',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                {back ? Math.round(w * 60) : ''}
              </div>
            );
          })}
        </div>
      </div>
      <Sfx at={wipe + 4} name="swoosh" volume={0.6} />
      <Sfx at={exact - 2} />
      {wiped && frame < rebuilds && (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 140 }}>
          <GlitchText text="BRAIN WIPED" from={wipe + 4} size={130} color={C.red} settle={30} />
        </AbsoluteFill>
      )}
      {frame >= rebuilds &&
        Array.from({ length: 30 }, (_, i) => {
          const t = ((frame - rebuilds) / 25 + random(`s${i}`)) % 1;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: 120 + t * 700,
                top: 300 + random(`sy${i}`) * 350,
                width: 10,
                height: 10,
                borderRadius: 2,
                background: C.cyan,
                boxShadow: glow(C.cyan, 10),
                opacity: frame < exact + 10 ? 1 : 0,
              }}
            />
          );
        })}
      {frame >= rebuilds - 6 && (
        <div style={{ position: 'absolute', left: 90, top: 380, fontFamily: F.display, fontSize: 30, color: C.cyan, textShadow: glow(C.cyan, 12), lineHeight: 1.3 }}>
          WALRUS
          <br />
          MEMORY
        </div>
      )}
      {frame >= exact - 2 && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 700, textAlign: 'center', transform: `scale(${passPop})` }}>
          <span style={{ fontFamily: F.display, fontSize: 52, color: C.green, textShadow: glow(C.green, 16) }}>PASS</span>
          <span style={{ fontFamily: F.mono, fontSize: 28, color: C.text, marginLeft: 22 }}>11 contexts · 15 lessons · identical decisions</span>
        </div>
      )}
    </AbsoluteFill>
  );
};
