from __future__ import annotations

import argparse
import asyncio

from .infineon import InfineonRdkSource
from .server import ScannerGatewayServer
from .source import FakeRadarSource


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ScanIt BGT60TR13C USB-to-WebSocket gateway")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--source", choices=("infineon", "fake"), default="infineon")
    parser.add_argument("--uuid", help="Optional Infineon board UUID")
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    source = InfineonRdkSource(args.uuid) if args.source == "infineon" else FakeRadarSource()
    server = ScannerGatewayServer(source, args.host, args.port)
    print(f"ScanIt scanner gateway listening on ws://{args.host}:{args.port}")
    try:
        await server.run()
    finally:
        source.close()


if __name__ == "__main__":
    asyncio.run(main())
