# Scanner signal quality, band separation and personal baseline

## Purpose

The scanner must reject technically unreliable measurements before any physiological or longitudinal interpretation is shown. This layer is deterministic and independent of future medical models or language models.

## Quality gate v1

`scanner-quality-v1` evaluates:

- SCN1 sequence continuity and packet gaps;
- signal-to-noise ratio;
- frame-timing stability;
- range stability;
- target-bin stability;
- phase continuity;
- scanner movement and motion contamination;
- usable-frame ratio;
- analyzable measurement duration.

The output is one of:

- `approved`: technically suitable for research analysis and personal-baseline use;
- `repeat`: usable information exists, but the measurement should be repeated;
- `rejected`: the result must not be interpreted.

A weighted score never overrides a blocking condition. Examples of blocking conditions include very low SNR, excessive packet loss, severe phase discontinuity, excessive device movement or too few usable frames.

The current thresholds are engineering defaults for development. They are not clinical thresholds and must be recalibrated against physical measurements.

## Physiological band separation v1

`scanner-physiology-v1` does not assume that the strongest reflection comes from the heart. It:

1. calculates range profiles for every frame;
2. selects multiple candidate range bins;
3. reconstructs continuous phase displacement per candidate bin;
4. evaluates the respiratory band at 0.1–0.5 Hz;
5. evaluates the mechanical cardiac band at 0.7–3.0 Hz;
6. selects respiration and cardiac bins independently;
7. reports the dominant periodic rates, band power and separation confidence.

The reported rates describe periodic RF motion. They are not medical heart-rate or respiratory diagnoses and must later be validated against synchronized ECG, PPG and respiratory reference signals.

## Personal RF baseline

A baseline is specific to:

- scanner position;
- radio modality;
- hardware profile.

Only recordings with an `approved` quality verdict can enter the baseline. Up to twelve recent approved recordings are retained per compatible baseline.

The baseline contains:

- mean range profile;
- mean and variation in target range;
- mean and variation in peak phase displacement;
- mean SNR;
- mean and variation in the mechanical cardiac-band rate when available;
- the source recording identifiers and quality scores.

A candidate is compared using profile cosine similarity, range deviation, phase-displacement deviation, SNR deviation and mechanical-rate deviation. The result is one of:

- `within-baseline`;
- `changed`;
- `significant-change`;
- `insufficient-quality`.

These labels describe RF-signal differences, not anatomy or disease.

## Current validation

Automated tests use deterministic 20 Hz FMCW data with simulated respiratory and cardiac motion. They verify:

- an otherwise stable ten-second capture passes the quality gate;
- respiratory and cardiac periodic bands are recovered within broad plausible ranges;
- encrypted record/replay preserves the raw capture;
- an approved capture can create a personal baseline;
- the source capture compares as within its own baseline;
- TypeScript and Expo web export remain valid.

## Physical validation still required

The thresholds are initial engineering thresholds. They must be recalibrated using physical measurements that include:

- controlled placement fixtures;
- repeated sessions and multiple body types;
- synchronized ECG/PPG and respiratory reference data;
- deliberate motion, angle, pressure and distance perturbations;
- packet-loss and clock-drift experiments;
- independent test participants not used for threshold tuning.
