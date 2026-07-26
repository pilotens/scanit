# Tomography gateway protocol

## Scope

The physical tomography gateway is a control and acquisition adapter for a dedicated coherent multistatic microwave array. It is not an ordinary Wi-Fi access point.

The first app adapter uses JSON request/response messages over WebSocket. The gateway may internally control a VNA, switch matrix, SDR or another coherent RF frontend.

## Request envelope

```json
{
  "id": "tom-123",
  "type": "status | configure | capture",
  "payload": {}
}
```

## Response envelope

```json
{
  "requestId": "tom-123",
  "ok": true,
  "payload": {}
}
```

Errors use `ok: false` and an `error` string.

## Status

The `status` response must conform to `TomographyProviderStatus` and report:

- provider ID;
- connection state;
- hardware profile ID;
- common coherent clock availability;
- active RF port count;
- supported frequency range;
- hardware limitations or warnings.

## Configure

The app sends `TomographyAcquisitionConfiguration` containing:

- measured antenna geometry;
- field of view;
- coherent frequency sweep;
- optional acquisition temperature.

The gateway must reject unsupported frequencies, incoherent operation or unavailable ports before acquisition begins.

## Capture

The app requests a capture role:

- `background`;
- `subject`;
- `phantom-reference`.

A subject capture should reference the background capture ID used for differential reconstruction.

The response must be a complete `TomographyCapture` containing one complex S21 value for every acquired directed TX/RX/frequency point, together with phase and magnitude uncertainty.

The app validates:

- all antenna IDs;
- declared frequency membership;
- unique path-frequency keys;
- finite complex values;
- non-negative uncertainties;
- expected measurement coverage.

Invalid captures are rejected before encrypted storage or reconstruction.

## Timing

Version 1 treats each tomography capture as a quasi-static coherent sweep. A future dynamic tomography protocol must add:

- a common monotonic clock domain;
- sweep start/end timestamps;
- per-path acquisition timestamps;
- hardware trigger provenance;
- motion and respiratory phase reference.

## Transport evolution

JSON is acceptable for the first bench implementation because tomography captures are lower-rate than continuous radar cubes. A production gateway may replace the capture payload with CBOR, FlatBuffers or chunked binary transfer while preserving the same domain schema and validation rules.

## Safety boundary

The gateway reports RF measurements only. It must not return anatomy, stenosis, ischemia or infarction classifications. Those remain separate, explicitly validated downstream research questions.
