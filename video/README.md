# Sibyl demo video (Remotion)

Motion-graphics demo plus real screen recordings of the dashboard, 1920x1080, about 2.5 minutes, with an ElevenLabs narration (voice "Brian").

```bash
pnpm install
pnpm voice     # narration per scene + word timings (needs video/.env with ELEVENLABS_API_KEY*)
pnpm shots     # screenshots of the live dashboard (app running on :8787)
node scripts/record.mjs tabs     # walk through every tab (about 70 s)
node scripts/record.mjs round    # wait for the next 5m call and record it until it settles (about 5 to 9 min)
ffmpeg -i public/rec/tabs.webm -c:v libx264 -crf 18 -g 30 -pix_fmt yuv420p -an public/rec/tabs.mp4
ffmpeg -i public/rec/round.webm -c:v libx264 -crf 18 -g 15 -pix_fmt yuv420p -an public/rec/round.mp4
#   then copy the marks from public/rec/*.json into src/rec.json (round gets "viewHeight": 1500)
python3 scripts/round_cut.py     # speed-ramped round clip, synced to the narration
pnpm studio    # preview and tweak in the browser
pnpm render    # out/sibyl-demo.mp4
ffmpeg -i out/sibyl-demo.mp4 -c:v copy -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:a aac -b:a 192k out/sibyl-demo-final.mp4
```

- `src/script.json`: the narration, one entry per scene. Edit it, then run `pnpm voice` again; only changed lines are re-synthesized.
- `src/theme.ts`: colors, fonts, and `cue(scene, word)`, which ties every animation beat to the moment the narrator says that word.
- `src/scenes/*`: hook, intro, council, commit, score, lessons, recall, amnesia, results, outro.
- `src/scenes/demo.tsx`: the live round (speed-ramped, with phase labels and a pan to the price chart) and one scene per dashboard tab.
- `public/sfx`: music bed and soft effects (blip, swoosh) generated with ElevenLabs, low-passed and turned down.
