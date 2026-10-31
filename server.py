"""Ableton Link bridge: the browser UI sends tempo/phase commands over a WebSocket."""
import asyncio
import json
import webbrowser
from pathlib import Path

from aalink import Link
from aiohttp import WSMsgType, web

PORT = 8765
STATIC = Path(__file__).parent / "static"


def handle(link, msg):
    kind = msg.get("type")
    if kind == "tempo":
        link.tempo = max(20.0, min(300.0, float(msg["bpm"])))
    elif kind == "tap":
        if msg.get("bpm"):
            link.tempo = max(20.0, min(300.0, float(msg["bpm"])))
        if msg.get("first"):
            link.force_beat(0.0)  # tap = beat 1 of the bar
        else:
            shift_to_grid(link, 0.0)
    elif kind == "phase":
        shift_to_grid(link, float(msg["ago_ms"]))


def shift_to_grid(link, ago_ms):
    """Align the nearest whole beat with an event that happened ago_ms ago."""
    beat_at_event = link.beat - ago_ms / 60000.0 * link.tempo
    off = beat_at_event - round(beat_at_event)
    if abs(off) > 0.01:
        link.force_beat(link.beat - off)


async def ws_handler(request):
    link = request.app["link"]
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    request.app["clients"].add(ws)
    try:
        async for m in ws:
            if m.type == WSMsgType.TEXT:
                try:
                    handle(link, json.loads(m.data))
                except (ValueError, KeyError, TypeError):
                    pass
    finally:
        request.app["clients"].discard(ws)
    return ws


async def broadcast(app):
    link = app["link"]
    while True:
        state = json.dumps({
            "bpm": round(link.tempo, 2),
            "beat": link.beat % link.quantum,
            "quantum": link.quantum,
            "peers": link.num_peers,
        })
        for ws in list(app["clients"]):
            try:
                await ws.send_str(state)
            except ConnectionError:
                app["clients"].discard(ws)
        await asyncio.sleep(0.05)


async def index(request):
    return web.FileResponse(STATIC / "index.html")


async def main():
    link = Link(120.0)
    link.quantum = 4
    link.enabled = True
    app = web.Application()
    app["link"] = link
    app["clients"] = set()
    app.add_routes([web.get("/", index), web.get("/ws", ws_handler)])
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", PORT).start()
    url = f"http://localhost:{PORT}"
    print(f"Link beat sync running at {url}  (Ctrl+C to quit)")
    webbrowser.open(url)
    await broadcast(app)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
