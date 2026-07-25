from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from .aggregate import MultiLinkWifiCsiSource
from .server import WifiCsiGatewayServer
from .source import FakeWifiCsiSource, SerialWifiCsiSource, WifiCsiSource, WifiGatewayConfig


def _subcarrier_map(value: str) -> tuple[int, ...]:
    values: list[int] = []
    for part in value.split(","):
        token = part.strip()
        if not token:
            continue
        if ":" in token:
            start_text, end_text = token.split(":", 1)
            start = int(start_text)
            end = int(end_text)
            step = 1 if end >= start else -1
            values.extend(range(start, end + step, step))
        else:
            values.append(int(token))
    result = tuple(values)
    if not result or len(set(result)) != len(result):
        raise argparse.ArgumentTypeError(
            "Subcarrier map must contain unique integers or inclusive ranges."
        )
    return result


def _receiver_ids(values: list[str] | None, count: int) -> list[str]:
    if values:
        if len(values) != count:
            raise ValueError(
                f"Expected {count} --rx-node-id values, received {len(values)}."
            )
        if len(set(values)) != len(values):
            raise ValueError("Receiver node identifiers must be unique.")
        return values
    return [f"rx-{index + 1}" for index in range(count)]


def _build_source(args: argparse.Namespace) -> WifiCsiSource:
    if args.source == "fake":
        receiver_ids = _receiver_ids(args.rx_node_id, args.fake_receivers)
        sources = [(receiver_id, FakeWifiCsiSource()) for receiver_id in receiver_ids]
    else:
        ports: list[str] = args.serial_port or []
        if not ports:
            raise ValueError("At least one --serial-port is required for the serial source.")
        receiver_ids = _receiver_ids(args.rx_node_id, len(ports))
        sources = [
            (receiver_id, SerialWifiCsiSource(port, args.baudrate))
            for receiver_id, port in zip(receiver_ids, ports, strict=True)
        ]

    if len(sources) == 1:
        return sources[0][1]
    return MultiLinkWifiCsiSource(sources)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="ScanIt Wi-Fi CSI0 ingress and WCS1 WebSocket gateway."
    )
    parser.add_argument("--source", choices=("fake", "serial"), default="fake")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8770)
    parser.add_argument("--serial-port", action="append")
    parser.add_argument("--baudrate", type=int, default=2_000_000)
    parser.add_argument("--fake-receivers", type=int, default=3)
    parser.add_argument("--rx-node-id", action="append")
    parser.add_argument("--tx-node-id", default="tx-node")
    parser.add_argument("--session-id", default="wifi-session")
    parser.add_argument("--band", choices=("2.4-ghz", "5-ghz", "6-ghz"), default="5-ghz")
    parser.add_argument("--channel", type=int, default=36)
    parser.add_argument("--center-frequency-hz", type=int, default=5_180_000_000)
    parser.add_argument("--bandwidth-hz", type=int, default=20_000_000)
    parser.add_argument("--phy", choices=("legacy-ofdm", "ht", "vht", "he", "eht"), default="he")
    parser.add_argument("--frame-rate-hz", type=float, default=20.0)
    parser.add_argument(
        "--subcarriers",
        type=_subcarrier_map,
        default=_subcarrier_map("-28:-1,1:28"),
        help="Comma-separated indices and inclusive ranges, e.g. -28:-1,1:28.",
    )
    return parser


async def _run(args: argparse.Namespace) -> None:
    if args.fake_receivers < 1:
        raise ValueError("--fake-receivers must be positive.")
    source = _build_source(args)
    config = WifiGatewayConfig(
        session_id=args.session_id,
        tx_node_id=args.tx_node_id,
        rx_node_id=(args.rx_node_id or ["rx-1"])[0],
        clock_domain="wifi-source-clock",
        band=args.band,
        channel=args.channel,
        center_frequency_hz=args.center_frequency_hz,
        bandwidth_hz=args.bandwidth_hz,
        phy=args.phy,
        frame_rate_hz=args.frame_rate_hz,
        subcarrier_indices=args.subcarriers,
    )
    config.validate()
    server = WifiCsiGatewayServer(
        source,
        host=args.host,
        port=args.port,
        config=config,
    )
    print(
        f"ScanIt Wi-Fi CSI gateway listening on ws://{args.host}:{args.port} "
        f"using {args.source} source"
    )
    await server.run()


def main() -> None:
    parser = _parser()
    args = parser.parse_args()
    try:
        asyncio.run(_run(args))
    except KeyboardInterrupt:
        pass
    except Exception as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
