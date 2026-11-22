---
doc: research/features/README
version: extractor 2.0.0, params features-v2.0
date: 2026-11-22
status: DRAFT — to be LOCKED before the first outer LOSO run (EXPERIMENT_PROTOCOL_V1 §3)
decisions: D-067 Phase 2
---

# Local feature extractor v2 (research only)

One video in, one **per-frame feature table** out (Parquet, or CSV), plus `<clip>.meta.json` with
every version. Research code only: the production extractor `worker/extract/landmarks.py`,
`n1.py`, `n2.py`, thresholds, contract, API and UI are not touched. MediaPipe models are **fixed
feature extractors** (no fine-tuning). Nothing here reads labels or scenario ids. Runs locally;
tables come from real videos and stay in the git-ignored `data/` folder.

```
python -m research.features.video VIDEO OUT.parquet                    # one video
python -m research.features.batch --clips config/dev_clips_sc02.yaml \
       --only G09_P18_S01_T01 [--media original] [--format csv]         # clip list
python -m pytest research/tests -q                                      # tests (smoke skips without MediaPipe/ffmpeg/models)
```

Batch: SC02 root from env `PROMPTPRES_SC02`, models from `PROMPTPRES_MODELS` (default `models/`).
Output `data/research_features/v<version>/<clip_id>.parquet` + `.meta.json`, and `runs.csv`
(one line per clip: status, rows, duration, run time). A missing model file stops the run with a
message; nothing is downloaded.

## Time grid

- Rows on a **fixed 10 fps grid**: `t_s = k / 10` seconds from the start of the source video
  (protocol §2: at most 10 fps). Grid point k is filled by the first decoded frame whose real
  timestamp is ≥ `k/10 − 0.005 s`; a gap in the video leaves grid points without a row.
- `frame_t_s` = the decoder's real timestamp of that frame. **All velocities, accelerations and
  jerks use `frame_t_s`**, never the grid. A 30 fps CFR MP4 gives `frame_t_s = t_s` exactly.
- `--media original` reads the source WebM (variable rate, real timestamps — recommended for
  P02–P04, recorded at ~22–23 fps, whose 30 fps MP4 repeats about a third of frames); `--media mp4`
  (default) reads the CFR MP4. At 10 fps a repeated MP4 frame is never picked twice for 22 fps
  sources, but the content of an MP4 frame can be up to one source frame older than its
  `frame_t_s`; `dup_frame` flags any sampled frame identical to the previous one.
- Window features (1/2/3 s windows, hop 0.5 s, half-open `[start, end)`) are built later from
  `t_s`; annotation times map to source time via `source_offset_s` (protocol §4.4).

## Columns

`l`/`r` = the **speaker's** left/right (MediaPipe Pose naming; the hand model's own left/right
label is not used). Pixel coordinates are full-frame pixels, y down. Missing = NaN, never 0.
Normalised values (`n…`) are `(point − mid-shoulder) / sw_ref`, where `sw_ref` = the clip's median
shoulder width (the speaker's own unlabeled frames; removes sway and camera distance).

| Group | Columns | Notes |
|---|---|---|
| Frame | `t_s`, `frame_t_s`, `width`, `height`, `frame_diff`, `dup_frame` | `frame_diff` = mean \|grey diff\| to the previous row on a 64×36 thumbnail |
| Pose (21 upper-body points) | `pose_ok`, `p_<pt>_{x,y,vis,pres}` for nose, eyes, ears, mouth, shoulders `sh`, elbows `el`, wrists `wr`, pinky/index/thumb, hips | pose on a 960 px wide copy (`pose.task` = pose_landmarker_lite) |
| Hands (2 × 21 points) | `{l,r}_hand_ok`, `{l,r}_hand_score`, `h{l,r}_{00..20}_{x,y,z}` | each hand goes to the nearer pose wrist within 1 shoulder width |
| Face / head | `face_ok`, `yaw`, `pitch`, `roll`, `face_tz`, `face_{x0,y0,x1,y1}`, `face_illum` | face on a crop around the nose; angles from the transformation matrix with the production sign (pitch < 0 = down); `face_illum` = mean grey in the face box |
| Eyes (raw) | `f_{l,r}_{outer,inner,top,bottom,iris}_{x,y}`, `bs_eye{Blink,LookDown,LookIn,LookOut,LookUp,Squint,Wide}{Left,Right}` | mesh points 263/362/386/374/473 (left) and 33/133/159/145/468 (right) |
| Body scale | `sw_px`, `sw_ref_px` | per-frame and clip-median shoulder width |
| Wrist–body (per side) | `wr_src` (0 none, 1 pose, 2 hand model), `wr_nx`, `wr_ny`, `wr_out`, `wr_torso_d`, `el_nx`, `el_ny`, `elbow_deg` | `wr_out` > 0 = away from the body midline |
| Hand (per side) | `hand_cx`, `hand_cy`, `hand_face_d`, `hand_open` | hand centre = mean of 21 points; `hand_face_d` to the pose nose / `sw_ref`; `hand_open` = mean fingertip–wrist / wrist–middle-finger-base (spikes when the hand is seen end-on; window stage should use robust statistics) |
| Dynamics (per side) | `wr_speed`, `wr_acc`, `wr_jerk` (sw/s, sw/s², sw/s³), `hand_motion` (mean speed of 21 hand points) | backward differences on `frame_t_s`; NaN over gaps > 0.25 s or when `wr_src` changes |
| Both hands | `hands_d`, `hands_mid_ny`, `hands_sym`, `motion_energy`, `n_wrists_seen`, `n_hands_landmarked` | `motion_energy` = mean squared speed of the visible pose elbows + wrists |
| Eye features (per eye) | `eye_{l,r}_{w_px,ok,u,v,open}` | `u` = iris along outer→inner corner (0..1); `v` = offset towards the lower lid in eye widths; `open` = lid gap / eye width; used only if face found and eye ≥ 12 px wide |
| Eye summary | `iris_x`, `iris_y`, `eye_open`, `face_w_frac` | `iris_x` measured image-left → image-right so both eyes agree |
| Quality | `n1_obs` (0/1/2 wrists seen), `n2_obs` (0 no face, 1 head only, 2 head + eye) | inputs for the `UNOBSERVABLE` class; **features, not labels** |

The feature-set hash in the meta file covers the extractor version, `features_v2.yaml` and the
column list; any change gives a new hash.

## Protocol §6 → where each feature comes from

| §6 item | Frame table (this package) | Window stage (later, inside folds) |
|---|---|---|
| shoulder/elbow/wrist/hand landmarks, visibility | pose + hand columns | — |
| shoulder-width + torso-origin normalisation | `*_nx/ny`, `sw_ref_px` | — |
| hand–body, hand–face, inter-hand distance | `wr_torso_d`, `wr_out`, `hand_face_d`, `hands_d` | — |
| velocity, acceleration, jerk (real timestamps) | `wr_speed/acc/jerk`, `hand_motion` | window mean/max |
| spatial extent, moving/still ratio, active-hand count | inputs: normalised positions, speeds | range / share of rows above a speed fixed in inner folds |
| symmetry, motion energy, notes-holding cue | `hands_sym`, `motion_energy`; cue = `hands_d` + `hands_mid_ny` | — |
| yaw, pitch, roll; face scale; face visibility; illumination | `yaw/pitch/roll`, `face_w_frac`, `face_tz`, `face_ok`, `n2_obs`, `face_illum` | — |
| pitch/yaw vs speaker baseline (ablation) | — | speaker's own unlabeled frames (protocol §3) |
| iris coordinates, eyelid openness, eye blendshapes | `eye_*`, `iris_x/y`, `eye_open`, `bs_eye*` | — |
| temporal smoothing | — | window statistics |
| speech activity / audio energy (optional ablation) | not extracted here | from VAD |

MediaPipe is not a gaze estimator: iris and blendshape values are inputs to a classifier the team
trains against human GOLD labels; they do not say where the person is looking.

## First local run (development check, 22 Nov 2026)

Team clip `G09_P18_S01_T01` (P18 = G09 team speaker: pipeline development only, never a primary
metric), 231 s, 1920×1080, GTX 1650 laptop (MediaPipe runs on the CPU on Windows), uncommitted
code on `7689029`:

| Source | Rows (10 fps) | Run time | Run time / video time | Grid rows / s | frame lag median / max |
|---|---:|---:|---:|---:|---:|
| MP4 (30 fps CFR) | 2,311 | 150.6 s | 0.65 | 15.4 | 0 / 0 ms |
| WebM (`--media original`, VFR) | 2,311 | 149.4 s | 0.65 | 15.5 | 12 / 78 ms |

Pose and face on 100% of rows, left/right hand model on 97 / 99%, `n1_obs = 2` and `n2_obs = 2`
on 100%; eye width ≈ 33 px; all three model files match `models/download_provenance.json`.
Repeated-frame check: on a P02 MP4 (22–23 fps source) repeats differ by ≤ 0.03 grey levels on the
thumbnail and distinct frames by ≥ 0.096, hence `dup_diff_max = 0.05`.

## Not locked yet

`min_eye_width_px` (12 px) and `pose_vis_min` (0.5) are design values to be checked on the pilot
items; once the first outer LOSO run starts, `features_v2.yaml`, the column list and this README
are frozen and any change is a new protocol version.
