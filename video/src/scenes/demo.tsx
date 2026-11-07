import React from 'react';
import { AbsoluteFill, interpolate, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Background, usePop } from '../components/fx';
import rec from '../rec.json';
import { C, cue, F, FPS, glow, type SceneId } from '../theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** A browser-like frame around a screen recording. */
const Screen: React.FC<{ children: React.ReactNode; zoom?: number }> = ({ children, zoom = 1 }) => (
  <div
    style={{
      position: 'absolute',
      left: 80,
      top: 64,
      width: 1760,
      height: 990,
      borderRadius: 14,
      overflow: 'hidden',
      border: `2px solid ${C.cyan}88`,
      boxShadow: `0 0 60px ${C.cyan}44`,
      background: '#000',
    }}
  >
    <div style={{ height: 36, background: '#0b111c', display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 14 }}>
      {[C.red, C.yellow, C.green].map((c) => (
        <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.8 }} />
      ))}
      <div style={{ marginLeft: 16, fontFamily: F.mono, fontSize: 16, color: C.muted }}>localhost:8787 · Sibyl live dashboard</div>
    </div>
    <div style={{ width: 1760, height: 954, overflow: 'hidden' }}>
      <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>{children}</div>
    </div>
  </div>
);

const Label: React.FC<{ text: string; color?: string; at?: number }> = ({ text, color = C.pink, at = 0 }) => {
  const pop = usePop(at, 12);
  return (
    <div
      style={{
        position: 'absolute',
        right: 110,
        top: 120,
        transform: `scale(${pop})`,
        transformOrigin: 'right',
        fontFamily: F.display,
        fontSize: 30,
        letterSpacing: 4,
        color,
        padding: '10px 22px',
        border: `2px solid ${color}`,
        borderRadius: 8,
        background: 'rgba(4,6,12,0.85)',
        boxShadow: `0 0 26px ${color}66`,
        textShadow: glow(color, 8),
      }}
    >
      {text}
    </div>
  );
};

// ---------- one real round, time-remapped to the narration ----------

const round = rec.round as typeof rec.round & { viewHeight?: number };
/** Tall recordings hold the hero and the price chart; the camera pans between them. */
const TALL = (round.viewHeight ?? 810) > 1000;
/** How far down (screen px) the chart sits in a tall recording. */
const CHART_PAN = -720;
/** The dashboard refreshes every 5 s, so it shows a new phase a few seconds after the API does. */
const UI_LAG = 4;
const expiryMs = Number(round.eventId.split(':')[2]);

export const RoundDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  // Scene frame -> recording second. Keyframes put each phase on screen as the narrator names it.
  const sceneKeys = [0, cue('round', 'four'), cue('round', 'locks'), cue('round', 'seconds'), cue('round', 'watches'), cue('round', 'settles'), cue('round', 'scored'), durationInFrames];
  const recKeys = [
    round.featured - 0.5,
    round.locked - 6,
    round.locked + 0.5,
    round.onSui - 1,
    round.onSui + 12,
    round.closed - 3,
    round.settled + 2,
    Math.min(round.end - 0.5, round.settled + 9),
  ];
  const recT = interpolate(frame, sceneKeys, recKeys, clamp);
  const speed = (interpolate(frame + 1, sceneKeys, recKeys, clamp) - recT) * FPS;
  const realMs = expiryMs - (round.closed - recT) * 1000;
  const watches = cue('round', 'watches');
  const settles = cue('round', 'settles');
  const pan = TALL
    ? interpolate(frame, [watches - 6, watches + 18, settles - 18, settles + 4], [0, CHART_PAN, CHART_PAN, 0], { ...clamp, easing: (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2) })
    : 0;
  const phase =
    recT >= round.settled ? ['SETTLED', C.green] : recT >= round.closed ? ['CLOSED · ORACLE', C.yellow] : recT >= round.onSui + UI_LAG ? ['ON SUI ✓', C.green] : recT >= round.locked + UI_LAG ? ['LOCKED', C.cyan] : ['SAMPLING VOICES', C.pink];
  return (
    <AbsoluteFill>
      <Background />
      <Screen zoom={TALL ? 1 : 1.22}>
        <div style={{ transform: `translateY(${pan}px)` }}>
          {/* pre-cut by scripts/round_cut.py with the same keyframes, so it plays straight through */}
          <OffthreadVideo src={staticFile('rec/round-cut.mp4')} muted style={{ width: 1760 }} />
        </div>
      </Screen>
      <div style={{ position: 'absolute', left: 110, top: 120, display: 'flex', gap: 14 }}>
        <Chip color={C.yellow}>{speed > 1.5 ? `▶▶ ×${Math.round(speed)}` : '▶ ×1'}</Chip>
        <Chip color={C.muted}>{new Date(realMs).toLocaleTimeString('en-GB')}</Chip>
      </div>
      <AbsoluteFill>
        <Label text={phase[0]} color={phase[1]} at={0} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Chip: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <div style={{ fontFamily: F.mono, fontSize: 26, color, padding: '8px 16px', border: `1px solid ${color}`, borderRadius: 8, background: 'rgba(4,6,12,0.85)' }}>
    {children}
  </div>
);

// ---------- one tab of the dashboard, at real speed ----------

const TAB_TITLES: Record<string, string> = {
  track: 'TRACK RECORD',
  lessons: 'LESSONS',
  payments: 'PAYMENTS',
  proofs: 'PROOFS',
  hood: 'UNDER THE HOOD',
};

export const tabScene = (tab: keyof typeof TAB_TITLES): React.FC => {
  const TabDemo: React.FC = () => {
    const frame = useCurrentFrame();
    const { durationInFrames } = useVideoConfig();
    const zoom = interpolate(frame, [0, durationInFrames], [1.0, 1.06]);
    const start = (rec.tabs as Record<string, number>)[tab] - 0.4;
    return (
      <AbsoluteFill>
        <Background />
        <Screen zoom={zoom}>
          <OffthreadVideo src={staticFile('rec/tabs.mp4')} muted trimBefore={Math.round(start * FPS)} style={{ width: 1760 }} />
        </Screen>
        <Label text={`LIVE DEMO · ${TAB_TITLES[tab]}`} at={4} />
      </AbsoluteFill>
    );
  };
  return TabDemo;
};

export type DemoSceneId = Extract<SceneId, 'round' | 'tabTrack' | 'tabLessons' | 'tabPayments' | 'tabProofs' | 'tabHood'>;
