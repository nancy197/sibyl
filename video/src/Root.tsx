import React from 'react';
import { Composition } from 'remotion';
import { FPS } from './theme';
import { SibylVideo, totalFrames } from './Video';

export const Root: React.FC = () => (
  <Composition id="Sibyl" component={SibylVideo} durationInFrames={totalFrames()} fps={FPS} width={1920} height={1080} />
);
