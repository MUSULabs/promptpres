"""D-067 Phase 2 local feature extractor v2 for the N1/N2 classifiers (research only).

Nothing here is used by the production pipeline (`worker/`). MediaPipe is a fixed feature
extractor; the team's classifiers are trained later on the tables this package writes.

    geometry.py      pure geometry on landmark arrays (tested on synthetic points)
    table.py         raw per-frame landmarks -> derived per-frame features + quality flags
    video.py         one video -> fixed-rate grid -> MediaPipe -> raw table -> feature table
    provenance.py    model hashes, code commit, feature-set hash
    batch.py         clip list (dev_clips_sc02.yaml style) -> one table per clip
    features_v2.yaml every parameter the extractor uses (part of the feature-set hash)

See README.md for the column list and the time grid.
"""

EXTRACTOR_VERSION = "2.0.0"
