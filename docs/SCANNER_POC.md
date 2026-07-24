# Scanner PoC plan

## PoC A — mechanical heart sensing

**Hardware:** Infineon DEMO-BGT60TR13C initially, then KIT-CSK-BGT60TR13C for wireless integration.

**Objective:** reproduce pulse, respiration and a stable subject-specific phase/range signature while seated and still.

**Reference:** simultaneously recorded ECG or PPG from the watch.

**Acceptance gates:**

- raw frames can be streamed without loss;
- timestamps remain monotonic;
- target range is stable within a controlled placement fixture;
- cardiac-band motion is recoverable after respiration removal;
- repeated measurements on the same person are more similar than measurements with changed placement.

## PoC B — broadband tissue response

**Hardware:** NOVELDA X7 Radar Direct.

**Objective:** determine whether known phantom layer changes produce reproducible changes in complex UWB response.

**Acceptance gates:**

- distinguish 5, 10 and 20 mm tissue-equivalent layers in a controlled phantom;
- separate layer change from pressure, angle and air-gap changes;
- demonstrate test-retest repeatability before human interpretation.

## PoC C — Wi-Fi CSI comparator

**Hardware:** two ESP32-C5/C6 boards with external antennas.

**Objective:** quantify how much personal respiratory/cardiac information remains in commodity 20/40 MHz CSI.

This track is a comparator and low-cost fallback, not the expected source of anatomical resolution.

## Mobile transport target

The scanner accessory should use:

- Bluetooth LE for discovery, configuration and status;
- Wi-Fi Direct/local network or USB-C for raw IQ frames;
- sequence numbers, CRC and retransmission counters;
- an IMU and contact/distance measurement on the scanner itself.

## Next firmware deliverable

Implement an embedded `SCN1` encoder and control channel with commands for:

- device information;
- radio configuration;
- calibration start/stop;
- stream start/stop;
- position identifier;
- clock synchronization;
- diagnostic counters.
