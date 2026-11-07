"""
Cut the real round recording into a clip whose speed changes per segment, so each phase is on
screen when the narrator names it. Same keyframes as src/scenes/demo.tsx (RoundDemo).
  python3 scripts/round_cut.py   -> public/rec/round-cut.mp4
"""
import json
import re
import subprocess

FPS, LEAD, TAIL = 30, 0.5, 0.9
voice = json.load(open('src/voice.json'))['round']
rec = json.load(open('src/rec.json'))['round']


def cue(prefix):
    for w in voice['words']:
        if re.sub(r'[^a-z0-9$]', '', w['text'].lower()).startswith(prefix):
            return round((LEAD + w['start']) * FPS)
    raise SystemExit(f'no word {prefix}')


frames = round((LEAD + voice['duration'] + TAIL) * FPS)
scene = [0, cue('four'), cue('locks'), cue('seconds'), cue('watches'), cue('settles'), cue('scored'), frames]
source = [
    rec['featured'] - 0.5,
    rec['locked'] - 6,
    rec['locked'] + 0.5,
    rec['onSui'] - 1,
    rec['onSui'] + 12,
    rec['closed'] - 3,
    rec['settled'] + 2,
    min(rec['end'] - 0.5, rec['settled'] + 9),
]

parts, labels = [], []
for i in range(len(scene) - 1):
    out_s = (scene[i + 1] - scene[i]) / FPS
    in_s = source[i + 1] - source[i]
    parts.append(
        f"[0:v]trim=start={source[i]:.3f}:end={source[i + 1]:.3f},setpts=(PTS-STARTPTS)*{out_s / in_s:.6f}[s{i}]"
    )
    labels.append(f'[s{i}]')
graph = ';'.join(parts) + f";{''.join(labels)}concat=n={len(labels)}:v=1:a=0,fps={FPS}[out]"
subprocess.run(
    ['ffmpeg', '-loglevel', 'error', '-y', '-i', 'public/rec/round.mp4', '-filter_complex', graph, '-map', '[out]',
     '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', 'public/rec/round-cut.mp4'],
    check=True,
)
print('scene frames', frames, 'segments', [round((source[i + 1] - source[i]) / ((scene[i + 1] - scene[i]) / FPS), 1) for i in range(len(scene) - 1)])
