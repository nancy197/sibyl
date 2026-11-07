import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Background, Counter, GlitchText, Hash, Panel, Sfx, usePop } from '../components/fx';
import { C, cue, F, glow } from '../theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const CENTER = { x: 960, y: 430 };

type Voice = { id: string; label: string; sub: string; p: number; x: number; y: number; color: string; word: string; paid?: boolean };

// ---------- 3. Council: one question, five voices ----------

export const Council: React.FC = () => {
  const frame = useCurrentFrame();
  const voices: Voice[] = [
    { id: 'db', label: 'DEEPBOOK', sub: 'on-chain market · Sui', p: 68, x: 330, y: 250, color: C.cyan, word: 'deepbook' },
    { id: 'ks', label: 'KALSHI', sub: 'prediction market', p: 63, x: 330, y: 610, color: C.pink, word: 'kalshi' },
    { id: 'mo', label: 'MOMENTUM', sub: 'AI analyst', p: 61, x: 1590, y: 200, color: C.yellow, word: 'three', paid: true },
    { id: 'mr', label: 'MEAN-REV', sub: 'AI analyst', p: 58, x: 1590, y: 430, color: C.yellow, word: 'three', paid: true },
    { id: 'rw', label: 'RANDOM-WALK', sub: 'AI analyst', p: 64, x: 1590, y: 660, color: C.yellow, word: 'three', paid: true },
  ];
  const question = cue('council', 'question');
  const pays = cue('council', 'pays');
  const mpp = cue('council', 'mpp');
  const final = mpp + 20;
  const qPop = usePop(4);
  const mppPop = usePop(mpp - 4);
  const seconds = Math.max(0, 519 - Math.floor(frame / 30));
  return (
    <AbsoluteFill>
      <Background />
      <svg width={1920} height={1080} style={{ position: 'absolute' }}>
        {voices.map((v, i) => {
          const at = cue('council', v.word) + (v.word === 'three' ? (i - 2) * 6 : 0);
          const draw = interpolate(frame, [at, at + 18], [0, 1], clamp);
          const len = Math.hypot(v.x - CENTER.x, v.y - CENTER.y);
          return (
            <g key={v.id}>
              <line
                x1={v.x}
                y1={v.y}
                x2={CENTER.x}
                y2={CENTER.y}
                stroke={v.color}
                strokeWidth={2}
                strokeDasharray={`${len * draw} ${len}`}
                opacity={0.7}
                style={{ filter: `drop-shadow(0 0 6px ${v.color})` }}
              />
              {draw >= 1 &&
                [0, 0.33, 0.66].map((o) => {
                  const k = ((frame / 40 + o) % 1);
                  return <circle key={o} cx={v.x + (CENTER.x - v.x) * k} cy={v.y + (CENTER.y - v.y) * k} r={4} fill={v.color} />;
                })}
            </g>
          );
        })}
      </svg>

      {/* the question */}
      <div style={{ position: 'absolute', left: CENTER.x - 330, top: CENTER.y - 150, width: 660, transform: `scale(${qPop})` }}>
        <Panel style={{ position: 'relative', textAlign: 'center' }}>
          <div style={{ fontFamily: F.mono, color: C.pink, fontSize: 20, letterSpacing: 4 }}>15M CALL · BTC</div>
          <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 40, color: C.text, marginTop: 8 }}>
            Will Bitcoin be above <span style={{ color: C.cyan, fontFamily: F.mono, textShadow: glow(C.cyan, 10) }}>$75,752.06</span> at 11:45?
          </div>
          <div style={{ fontFamily: F.display, fontSize: 64, color: C.cyan, textShadow: glow(C.cyan, 16), marginTop: 12 }}>
            {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}
          </div>
          <div style={{ fontFamily: F.mono, color: C.muted, fontSize: 18, letterSpacing: 3 }}>UNTIL CLOSE</div>
          {frame >= final && (
            <div style={{ marginTop: 14 }}>
              <GlitchText text="SIBYL 66%" from={final} size={56} color={C.green} style={{ display: 'inline-block' }} />
            </div>
          )}
        </Panel>
      </div>

      {voices.map((v, i) => {
        const at = cue('council', v.word) + (v.word === 'three' ? (i - 2) * 6 : 0);
        return <VoiceNode key={v.id} v={v} at={at} paidAt={v.paid ? pays + (i - 2) * 8 : null} />;
      })}

      <Sfx at={pays + 20} volume={0.3} />
      {frame >= mpp - 4 && (
        <div style={{ position: 'absolute', left: 1330, top: 840, transform: `scale(${mppPop})` }}>
          <Tag color={C.green}>HTTP 402 → USDC ON SUI · MPP ✓</Tag>
        </div>
      )}
    </AbsoluteFill>
  );
};


const VoiceNode: React.FC<{ v: Voice; at: number; paidAt: number | null }> = ({ v, at, paidAt }) => {
  const frame = useCurrentFrame();
  const pop = usePop(at - 3, 10);
  const coin = paidAt === null ? 0 : interpolate(frame, [paidAt, paidAt + 22], [0, 1], clamp);
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: v.x - 150,
          top: v.y - 70,
          width: 300,
          transform: `scale(${pop})`,
          border: `2px solid ${v.color}`,
          borderRadius: 10,
          background: 'rgba(4,6,12,0.88)',
          boxShadow: `0 0 26px ${v.color}55`,
          padding: '14px 18px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontFamily: F.display, color: v.color, fontSize: 24, letterSpacing: 2, textShadow: glow(v.color, 8) }}>{v.label}</div>
        <div style={{ fontFamily: F.mono, color: C.muted, fontSize: 15 }}>{v.sub}</div>
        <Counter to={v.p} from={at + 4} frames={18} suffix="%" style={{ fontSize: 46, color: C.text, fontWeight: 700 }} />
        {paidAt !== null && frame >= paidAt + 20 && (
          <div style={{ fontFamily: F.mono, fontSize: 15, color: C.green }}>PAID $0.0065 USDC ✓</div>
        )}
      </div>
      {paidAt !== null && coin > 0 && coin < 1 && (
        <div
          style={{
            position: 'absolute',
            left: CENTER.x + (v.x - CENTER.x) * coin - 22,
            top: CENTER.y + (v.y - CENTER.y) * coin - 22,
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: C.green,
            boxShadow: glow(C.green, 18),
            fontFamily: F.display,
            fontSize: 20,
            display: 'grid',
            placeItems: 'center',
            color: '#012',
          }}
        >
          $
        </div>
      )}
    </>
  );
};

const Tag: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <div
    style={{
      fontFamily: F.mono,
      fontSize: 24,
      color,
      border: `1px solid ${color}`,
      padding: '8px 16px',
      borderRadius: 6,
      background: 'rgba(4,6,12,0.85)',
      boxShadow: `0 0 18px ${color}55`,
      whiteSpace: 'nowrap',
    }}
  >
    {children}
  </div>
);

// ---------- 4. Commit: Merkle tree to Sui ----------

const LEAVES = ['deepbook 68%', 'kalshi 63%', 'momentum 61%', 'mean-rev 58%', 'rand-walk 64%', 'memory 66%', 'baseline 65%', 'ensemble…'];

export const Commit: React.FC = () => {
  const frame = useCurrentFrame();
  const before = cue('commit', 'before');
  const hashed = cue('commit', 'hashed');
  const merkle = cue('commit', 'merkle');
  const committed = cue('commit', 'committed');
  const tatum = cue('commit', 'tatums');
  const seventy = cue('commit', 'seventy');
  const nobody = cue('commit', 'nobody');

  const levels = [8, 4, 2, 1];
  const ys = [760, 600, 450, 300];
  const xs = (n: number, level: number) => Array.from({ length: n }, (_, i) => 120 + ((i + 0.5) * 1100) / n + level * 0);
  const levelAt = (l: number) => (l === 0 ? before : merkle + (l - 1) * 10);
  const fly = interpolate(frame, [committed, committed + 24], [0, 1], { ...clamp, easing: (x) => 1 - (1 - x) ** 3 });
  const rootX = interpolate(fly, [0, 1], [670, 1530]);
  const rootY = interpolate(fly, [0, 1], [300, 420]);
  const tatumPop = usePop(tatum - 4);

  return (
    <AbsoluteFill>
      <Background />
      <svg width={1920} height={1080} style={{ position: 'absolute' }}>
        {levels.slice(1).map((n, l) =>
          xs(n, l + 1).map((x, i) => {
            const at = levelAt(l + 1);
            const draw = interpolate(frame, [at, at + 10], [0, 1], clamp);
            const children = xs(levels[l], l).slice(i * 2, i * 2 + 2);
            return children.map((cx, j) => (
              <line
                key={`${l}-${i}-${j}`}
                x1={cx}
                y1={ys[l] - 30}
                x2={cx + (x - cx) * draw}
                y2={ys[l] - 30 + (ys[l + 1] + 30 - (ys[l] - 30)) * draw}
                stroke={C.cyan}
                strokeWidth={2}
                opacity={0.6}
              />
            ));
          }),
        )}
      </svg>
      {levels.map((n, l) =>
        xs(n, l).map((x, i) => {
          const at = levelAt(l) + i * (l === 0 ? 3 : 2);
          const isRoot = l === 3;
          if (isRoot && frame >= committed) return null;
          return (
            <Node key={`${l}-${i}`} x={x} y={ys[l]} at={at} root={isRoot}>
              {l === 0 ? <div style={{ color: C.text, fontSize: 17 }}>{LEAVES[i]}</div> : null}
              <Hash seed={`n${l}${i}`} len={l === 0 ? 6 : 8} settleAt={l === 0 ? hashed + i * 2 : at + 8} style={{ fontSize: isRoot ? 22 : 15, color: isRoot ? C.green : C.cyan }} />
              {isRoot && <div style={{ fontFamily: F.display, color: C.green, fontSize: 18, letterSpacing: 3 }}>MERKLE ROOT</div>}
            </Node>
          );
        }),
      )}
      {frame >= committed && (
        <Node x={rootX} y={rootY} at={committed - 30} root>
          <Hash seed="n30" len={8} settleAt={0} style={{ fontSize: 22, color: C.green }} />
          <div style={{ fontFamily: F.display, color: C.green, fontSize: 18, letterSpacing: 3 }}>MERKLE ROOT</div>
        </Node>
      )}

      {/* the chain */}
      <Chain from={committed - 20} landed={committed + 24} />
      {frame >= tatum - 4 && (
        <div style={{ position: 'absolute', left: 1360, top: 120, transform: `scale(${tatumPop})` }}>
          <Tag color={C.yellow}>VIA TATUM gRPC · sui::ledger::anchor</Tag>
        </div>
      )}
      {frame >= seventy - 4 && (
        <div style={{ position: 'absolute', left: 1290, top: 690, textAlign: 'center', width: 480 }}>
          <GlitchText text="T−75s" from={seventy - 4} size={100} color={C.pink} style={{ display: 'inline-block' }} />
          <div style={{ fontFamily: F.mono, color: C.muted, fontSize: 22, letterSpacing: 4 }}>COMMITTED BEFORE CLOSE (AVG)</div>
        </div>
      )}
      {frame >= nobody - 2 && <Stamp at={nobody - 2} text="IMMUTABLE ✓" x={250} y={150} />}
      <Sfx at={nobody - 2} />
      <Sfx at={committed + 24} volume={0.3} />
    </AbsoluteFill>
  );
};

const Node: React.FC<{ x: number; y: number; at: number; root?: boolean; children: React.ReactNode }> = ({ x, y, at, root, children }) => {
  const pop = usePop(at, 11);
  const color = root ? C.green : C.cyan;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - (root ? 130 : 75),
        top: y - 30,
        width: root ? 260 : 150,
        transform: `scale(${pop})`,
        border: `1px solid ${color}`,
        borderRadius: 6,
        background: 'rgba(4,6,12,0.9)',
        boxShadow: `0 0 ${root ? 34 : 14}px ${color}66`,
        textAlign: 'center',
        padding: '6px 4px',
        fontFamily: F.mono,
      }}
    >
      {children}
    </div>
  );
};

const Chain: React.FC<{ from: number; landed: number }> = ({ from, landed }) => {
  const frame = useCurrentFrame();
  const pop = usePop(from, 14);
  const blocks = [403716254, 403716255, 403716256];
  return (
    <div style={{ position: 'absolute', left: 1400, top: 200, width: 260, transform: `scale(${pop})`, transformOrigin: 'top' }}>
      <div style={{ fontFamily: F.display, color: C.pink, fontSize: 22, letterSpacing: 4, textAlign: 'center', marginBottom: 10, textShadow: glow(C.pink, 8) }}>
        SUI CHECKPOINTS
      </div>
      {blocks.map((b, i) => {
        const isNew = i === blocks.length - 1;
        const lit = isNew && frame >= landed;
        return (
          <div
            key={b}
            style={{
              height: 92,
              marginBottom: 12,
              border: `2px solid ${lit ? C.green : C.pink}`,
              borderRadius: 8,
              background: lit ? 'rgba(57,255,136,0.12)' : 'rgba(4,6,12,0.85)',
              boxShadow: `0 0 ${lit ? 30 : 12}px ${lit ? C.green : C.pink}55`,
              fontFamily: F.mono,
              color: lit ? C.green : C.muted,
              fontSize: 17,
              display: 'grid',
              placeItems: 'center',
              opacity: isNew && frame < landed ? 0.35 : 1,
            }}
          >
            #{b}
            {lit && <div style={{ fontSize: 16 }}>Anchored · 6 forecasts</div>}
          </div>
        );
      })}
    </div>
  );
};

export const Stamp: React.FC<{ at: number; text: string; x: number; y: number; color?: string }> = ({ at, text, x, y, color = C.green }) => {
  const frame = useCurrentFrame();
  const s = interpolate(frame, [at, at + 8], [2.4, 1], clamp);
  const o = interpolate(frame, [at, at + 4], [0, 1], clamp);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: `rotate(-8deg) scale(${s})`,
        opacity: o,
        border: `5px solid ${color}`,
        color,
        padding: '10px 28px',
        fontFamily: F.display,
        fontSize: 54,
        letterSpacing: 6,
        borderRadius: 10,
        textShadow: glow(color, 12),
        boxShadow: `0 0 30px ${color}66`,
        background: 'rgba(4,6,12,0.7)',
      }}
    >
      {text}
    </div>
  );
};

export { Tag };
