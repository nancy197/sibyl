import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { Scene } from './components/scene';
import { Commit, Council } from './scenes/council';
import { Amnesia, Lessons, Recall, Score } from './scenes/learning';
import { Hook, Intro, Outro } from './scenes/opening';
import { Results } from './scenes/results';
import { RoundDemo, tabScene } from './scenes/demo';
import { C, OVERLAP, sceneFrames, type SceneId } from './theme';

export const SCENES: { id: SceneId; Component: React.FC }[] = [
  { id: 'hook', Component: Hook },
  { id: 'intro', Component: Intro },
  { id: 'council', Component: Council },
  { id: 'commit', Component: Commit },
  { id: 'score', Component: Score },
  { id: 'lessons', Component: Lessons },
  { id: 'recall', Component: Recall },
  { id: 'amnesia', Component: Amnesia },
  { id: 'round', Component: RoundDemo },
  { id: 'tabTrack', Component: tabScene('track') },
  { id: 'tabLessons', Component: tabScene('lessons') },
  { id: 'tabPayments', Component: tabScene('payments') },
  { id: 'tabProofs', Component: tabScene('proofs') },
  { id: 'tabHood', Component: tabScene('hood') },
  { id: 'results', Component: Results },
  { id: 'outro', Component: Outro },
];

/** Scene start frames; neighbours overlap a little for the glitch transition. */
export function timeline() {
  let at = 0;
  return SCENES.map((s) => {
    const start = at;
    const frames = sceneFrames(s.id);
    at += frames - OVERLAP;
    return { ...s, start, frames };
  });
}

export const totalFrames = () => {
  const t = timeline();
  return t.at(-1)!.start + t.at(-1)!.frames;
};

export const SibylVideo: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    <Audio src={staticFile('sfx/bed.mp3')} volume={0.11} />
    {timeline().map(({ id, Component, start, frames }) => (
      <Sequence key={id} from={start} durationInFrames={frames} name={id}>
        <Scene id={id}>
          <Component />
        </Scene>
      </Sequence>
    ))}
  </AbsoluteFill>
);
