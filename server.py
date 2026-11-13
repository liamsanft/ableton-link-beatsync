"""Ableton Link bridge: the browser UI sends tempo/phase commands over a WebSocket.

Protocol (JSON over /ws)
  client -> server  {"type": "tempo", "bpm": 128.0}
                    {"type": "tap", "bpm": 128.0 | null, "first": true | false}   first tap = beat 1 of the bar
                    {"type": "phase", "ago_ms": 12.5}   a beat happened ago_ms ago: nudge the grid towards it
  server -> client  {"bpm": 128.0, "beat": 0..3, "quantum": 4, "peers": 2}   sent on connect and on change only
"""
import asyncio
import errno
import json
import math
import sys
import webbrowser
from pathlib import Path

from aalink import Link
from aiohttp import WSMsgType, web

PORT = 8765
# In a PyInstaller build the bundled files live under sys._MEIPASS instead of next to the script.
STATIC = Path(getattr(sys, "_MEIPASS", Path(__file__).parent)) / "static"
MIN_BPM, MAX_BPM = 20.0, 300.0
QUANTUM = 4
LINK, CLIENTS, WAKE = web.AppKey("link", Link), web.AppKey("clients", set), web.AppKey("wake", asyncio.Event)
MAX_SLEEP_S = 0.5  # upper bound so tempo/peer changes made by other Link apps show up quickly


def finite(x):
    """float(x), but NaN/inf are rejected (JSON allows them in Python, and min/max would let NaN through)."""
    x = float(x)
    if not math.isfinite(x):
        raise ValueError("not finite")
    return x


def clamp_bpm(bpm):
    return max(MIN_BPM, min(MAX_BPM, finite(bpm)))


def handle(link, msg):
    if not isinstance(msg, dict):
        raise TypeError("message must be an object")
    kind = msg.get("type")
    if kind == "tempo":
        link.tempo = clamp_bpm(msg["bpm"])
    elif kind == "tap":
        bpm = clamp_bpm(msg["bpm"]) if msg.get("bpm") else None   # validate before touching the link
        if bpm:
            link.tempo = bpm
        if msg.get("first"):
            link.force_beat(0.0)  # tap = beat 1 of the bar
        else:
            shift_to_grid(link, 0.0)
    elif kind == "phase":
        shift_to_grid(link, finite(msg["ago_ms"]), gain=0.5, deadband=0.02)


def shift_to_grid(link, ago_ms, gain=1.0, deadband=0.01):
    """Align the nearest whole beat with an event that happened ago_ms ago.

    gain < 1 corrects only part of the error per call (smooth tracking)."""
    beat_at_event = link.beat - ago_ms / 60000.0 * link.tempo
    off = beat_at_event - round(beat_at_event)
    if abs(off) > deadband:
        link.force_beat(link.beat - off * gain)


def snapshot(link):
    return {
        "bpm": round(link.tempo, 2),
        "beat": int(link.beat % link.quantum),
        "quantum": link.quantum,
        "peers": link.num_peers,
    }


async def ws_handler(request):
    app = request.app
    link = app[LINK]
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    app[CLIENTS].add(ws)
    app[WAKE].set()
    await ws.send_str(json.dumps(snapshot(link)))
    try:
        async for m in ws:
            if m.type == WSMsgType.TEXT:
                try:
                    handle(link, json.loads(m.data))
                except (ValueError, KeyError, TypeError):
                    pass
    finally:
        app[CLIENTS].discard(ws)
    return ws


async def broadcast(app):
    """Push the state to all clients when it changes. Idle (no wakeups) while nobody is connected."""
    link, clients, wake = app[LINK], app[CLIENTS], app[WAKE]
    last = None
    while True:
        if not clients:
            wake.clear()
            await wake.wait()
            last = None
        state = snapshot(link)
        if state != last:
            last = state
            payload = json.dumps(state)
            for ws in list(clients):
                try:
                    await ws.send_str(payload)
                except ConnectionError:
                    clients.discard(ws)
        # sleep until the next beat boundary, where the displayed state changes
        to_next_beat = (1.0 - link.beat % 1.0) * 60.0 / max(link.tempo, MIN_BPM)
        await asyncio.sleep(min(MAX_SLEEP_S, to_next_beat + 0.005))


async def index(request):
    return web.FileResponse(STATIC / "index.html")


def make_app(link):
    app = web.Application()
    app[LINK] = link
    app[CLIENTS] = set()
    app[WAKE] = asyncio.Event()
    app.add_routes([web.get("/", index), web.get("/ws", ws_handler)])
    app.router.add_static("/static", STATIC)
    return app


async def main():
    link = Link(120.0)
    link.quantum = QUANTUM
    link.enabled = True
    app = make_app(link)
    runner = web.AppRunner(app)
    await runner.setup()
    try:
        await web.TCPSite(runner, "127.0.0.1", PORT).start()
    except OSError as e:
        if e.errno != errno.EADDRINUSE:
            raise
        sys.exit(
            f"Port {PORT} ist schon belegt – läuft Link Beat Sync bereits (anderes Terminal-Fenster)?\n"
            f"Dann dieses Fenster schließen und http://localhost:{PORT} öffnen, oder die andere Instanz mit Ctrl+C beenden."
        )
    url = f"http://localhost:{PORT}"
    print(f"Link beat sync running at {url}  (Ctrl+C to quit)")
    webbrowser.open(url)
    await broadcast(app)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
