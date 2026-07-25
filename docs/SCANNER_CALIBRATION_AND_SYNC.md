# Scanner RX calibration, monotonic timing and reference-locked averaging

## Why this layer exists

A stable range peak is not enough for reliable mechanical interpretation. The three BGT60TR13C receive paths have static and temperature-dependent gain/phase differences, the USB/gateway path introduces timing uncertainty, and respiration can dominate the same RF phase trace used for cardiac analysis.

Pipeline v4 therefore requires three explicit engineering layers before event-locked mechanical analysis:

1. RX gain/phase calibration;
2. one monotonic scanner clock domain with quantified uncertainty;
3. explicit ECG R-peak or PPG pulse events mapped into that clock domain.

HealthKit summary samples, average heart rate and ECG classifications are not event streams and are not accepted as coherent-averaging triggers.

## RX calibration v1

`scanner-rx-calibration-v1` is derived from the designated calibration frames before active analysis.

For each RX channel it stores:

- measured complex magnitude and phase at the calibration target bin;
- gain correction relative to a selected reference RX channel;
- phase correction relative to the same reference;
- amplitude coefficient of variation;
- circular phase standard deviation;
- validity status.

The calibration artifact also stores:

- antenna configuration;
- hardware profile;
- target range bin and range;
- coherence before and after correction;
- device temperature when available;
- quality score and flags.

Corrections are applied in the complex range-FFT domain. Raw ADC cubes are never rewritten, so future algorithms can replay the original measurement with another calibration model.

A low-quality or missing RX calibration blocks a physical mmWave measurement in `scanner-quality-v3`.

## Monotonic timing v1

Every gateway frame now contains:

- process-monotonic acquisition start and end;
- acquisition midpoint used as the canonical frame timestamp;
- a boot-unique clock-domain identifier;
- wall-clock estimate anchored at gateway startup;
- estimated ± timestamp uncertainty;
- monotonic/wall-clock anchor pair.

The midpoint model avoids treating the time after USB acquisition as the physical sample time. Half of the acquisition duration is included in the uncertainty estimate.

`scanner-clock-model-v1` fits a linear relation between wall-clock and scanner-monotonic time. It reports:

- drift in ppm;
- RMS anchor residual;
- maximum anchor uncertainty;
- combined mapping uncertainty;
- confidence and synchronization status.

Physical captures are rejected when they lack one coherent monotonic clock domain or exceed the blocking uncertainty limits.

## Reference events

A reference event must contain:

- event type: ECG R-peak or PPG pulse;
- wall-clock timestamp in nanoseconds;
- timestamp uncertainty;
- event quality;
- optional source-device identity.

The clock model maps each event to scanner-monotonic time and combines event uncertainty with clock-model uncertainty.

Events with low quality or more than 20 ms combined uncertainty are excluded from coherent averaging.

## Event-locked coherent averaging v1

The implementation:

1. selects the calibrated range bin identified by the mechanical-cardiac multi-bin analysis;
2. reconstructs a continuous unwrapped phase trace at that bin;
3. maps each accepted reference event into scanner time;
4. interpolates a -250 ms to +750 ms mechanical window;
5. removes slow linear drift per beat to suppress respiratory baseline movement;
6. converts phase to displacement in millimetres;
7. calculates mean, standard deviation and standard error across beats;
8. reports beat coherence, rejected-beat count and theoretical averaging gain.

At least three complete events are required. The output remains an RF-derived mechanical waveform and is not an ECG morphology or medical diagnosis.

## Automated validation

The regression suite verifies that:

- known RX gain/phase mismatches are recovered;
- calibrated RX coherence improves relative to the raw channels;
- a controlled 100 ppm clock drift is estimated correctly;
- clock mapping uncertainty remains bounded;
- explicit synthetic R-peaks produce an event-locked mechanical average;
- the selected cardiac range bin is used rather than the respiration-dominant main target;
- raw cube, encrypted replay, quality gating and interpretation boundaries remain intact.

## Physical validation still required

The implementation cannot establish real-world accuracy without hardware. Required experiments include:

- calibration target at known range and angle;
- repeated calibration over device temperature;
- cable/USB load and gateway scheduling jitter;
- synchronized ECG/PPG acquisition with shared hardware trigger where possible;
- comparison of software clock mapping with a physical sync pulse;
- deliberate dropped frames and clock drift;
- repeatability across scanner placement, body type and breathing pattern.

The future preferred hardware design should expose a common trigger or timestamp line between radar and reference acquisition. Software wall-clock mapping is a fallback with explicit uncertainty, not a substitute for hardware synchronization.
