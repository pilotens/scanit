# Hardware handoff

The software MVP ends at a strict provider boundary: `ImagingSensorProvider`.

A physical scanner must implement five operations:

1. `connect()`
2. `capabilities()`
3. `calibrate()`
4. `acquire()`
5. `disconnect()`

## Minimum experimental inputs

### Ultrasound channel

The preferred input is raw or minimally processed ultrasound RF/envelope data with timestamps and probe pose. A vendor SDK that only exposes rendered screenshots is insufficient for quantitative reconstruction.

### Microwave channel

The acquisition layer must provide calibrated complex measurements: frequency, Tx index, Rx index, real/I and imaginary/Q (or equivalent amplitude + phase), timestamp, and sensor pose. Calibration standards/background measurements must be retained.

### Motion channel

UWB/mmWave is treated as a motion/ranging modality. Required values are range, displacement/phase-derived motion, confidence, timestamp, and pose. It is not treated as an anatomical ground-truth channel.

### Pose

Every frame/sample must be registered to a common coordinate frame. Initial prototypes may use a mechanically constrained fixture; freehand scanning later requires tracked pose from optical tracking and/or IMU fusion.

## First physical experiment

Do not begin with a human chest.

Build or obtain a tissue-mimicking phantom with known dimensions and one or more hidden targets. Record the target coordinates before acquisition and keep them hidden from the reconstruction step.

Acceptance metrics:

- target localization error
- false-positive evidence volume
- repeatability across repeated sweeps
- calibration drift
- structural overlap where ground truth geometry is available
- reconstruction latency

The current synthetic acceptance test is intentionally replaceable by this physical fixture without changing the app-level reconstruction contract.
