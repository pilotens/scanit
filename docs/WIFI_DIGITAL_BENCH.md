# Wi-Fi CSI digital bench

The digital bench exercises the controlled Wi-Fi sensing transport before physical ESP32-C5 boards are available.

It starts at the same boundary as receiver firmware output:

```text
synthetic channel response
  -> int8 [imaginary, real] CSI
  -> packed CSI0 v2 record
  -> fragmented UART byte stream
  -> Csi0StreamParser
  -> exact SND1 identity validation
  -> multi-receiver intersection
  -> WCS1 frame
  -> mobile capture, encrypted replay, calibration and analysis
```

The bench does not inject ready-made WCS1 objects into the gateway. Every generated frame is quantized and encoded as CSI0 v2, split into deterministic UART fragments, parsed again and dimension-checked before WCS1 conversion.

## Run the readiness suite

Install the gateway package and run:

```bash
python -m pip install -e scanner/wifi-gateway
scanit-wifi-bench
```

Machine-readable output:

```bash
scanit-wifi-bench --json
```

The command returns a non-zero exit code if any expected transport behavior or rejection fails.

## Run the app against the digital gateway

Start the healthy three-receiver rig:

```bash
scanit-wifi-gateway \
  --source bench \
  --bench-scenario healthy \
  --bench-receivers 3 \
  --rx-node-id rx-left \
  --rx-node-id rx-right \
  --rx-node-id rx-reference \
  --phy ht \
  --channel 36 \
  --frame-rate-hz 20 \
  --host 0.0.0.0 \
  --port 8770
```

Enter `ws://<gateway-address>:8770` in the app's Wi-Fi CSI panel and run a physical-gateway capture. The app receives the same WCS1 contract that will later be produced from physical serial nodes.

## Scenarios

| Scenario | Injected condition | Expected behavior |
|---|---|---|
| `healthy` | Quantized HT20 CSI0 v2 fragmented over UART | Complete explicit-ID WCS1 stream |
| `start-offsets` | Receivers begin at different sounding IDs | Join begins only at the first common transmitter ID |
| `lossy` | One receiver misses selected SND1 frames | Missing IDs are skipped; no false pairing |
| `clock-drift` | Different deterministic receiver clock drift | Original receiver timing preserves the drift |
| `motion-burst` | Large transient phase motion | Transport remains valid; signal quality should degrade |
| `phase-jump` | Persistent phase discontinuity on one link | Transport remains valid; calibration/quality should detect instability |
| `queue-drop` | Cumulative receiver queue loss | CSI0/WCS1 carries a blocking queue-drop flag |
| `identity-fallback` | One receiver loses SND1 identity | Multi-link aggregation is rejected |
| `nonce-change` | SND1 session nonce changes during capture | Active capture is rejected |
| `truncated-payload` | CSI payload loses one complex pair | Dimension validation rejects the frame before WCS1 |

## Readiness checks

`scanit-wifi-bench` currently requires:

1. 36 complete healthy soundings through fragmented CSI0 v2.
2. Exact alignment of independently started receivers.
3. Explicit gap reporting without cross-packet pairing after packet loss.
4. End-to-end propagation of receiver queue-drop status.
5. Rejection of mixed explicit/fallback identities.
6. Rejection of a nonce change during an active session.
7. Rejection of a truncated CSI payload.

These checks are run by the Wi-Fi gateway CI job along with SND1, CSI0, WCS1 and WebSocket tests.

## What the bench can and cannot prove

It can validate:

- binary layouts and CRC behavior;
- UART fragmentation handling;
- int8 signed conversion and Float32 WCS1 encoding;
- exact multi-receiver packet identity;
- buffering, gaps, duplicates and failure propagation;
- deterministic channel-motion and multipath perturbations;
- mobile record/replay and quality-boundary behavior.

It cannot validate:

- the physical ESP32-C5 CSI byte order for the selected LTF mode;
- actual subcarrier ordering;
- RF oscillator phase behavior;
- antenna and enclosure effects;
- UART throughput under real callback load;
- real SND1-to-CSI callback timing;
- physiological sensitivity or clinical performance.

A passing digital bench means the software is ready to receive physical evidence. It is not evidence that Wi-Fi can identify anatomy or disease.
