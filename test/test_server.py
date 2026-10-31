"""Server tests: python -m unittest discover -s test   (uses a fake Link, no network or audio needed)."""
import json
import sys
import unittest
from pathlib import Path

from aiohttp.test_utils import TestClient, TestServer

sys.path.insert(0, str(Path(__file__).parent.parent))
import server  # noqa: E402


class FakeLink:
    def __init__(self, tempo=120.0, beat=10.0):
        self.tempo, self.beat, self.quantum, self.num_peers = tempo, beat, 4, 0
        self.forced = []

    def force_beat(self, beat):
        self.forced.append(beat)
        self.beat = beat


class HandleTest(unittest.TestCase):
    def test_tempo_is_clamped(self):
        link = FakeLink()
        server.handle(link, {"type": "tempo", "bpm": 1000})
        self.assertEqual(link.tempo, server.MAX_BPM)
        server.handle(link, {"type": "tempo", "bpm": 1})
        self.assertEqual(link.tempo, server.MIN_BPM)

    def test_non_finite_values_are_rejected(self):
        link = FakeLink()
        for msg in ({"type": "tempo", "bpm": float("nan")}, {"type": "tempo", "bpm": float("inf")},
                    {"type": "tap", "bpm": float("nan"), "first": True},
                    {"type": "phase", "ago_ms": float("nan")}):
            with self.assertRaises(ValueError):
                server.handle(link, msg)
        self.assertEqual((link.tempo, link.beat, link.forced), (120.0, 10.0, []))

    def test_non_object_is_rejected(self):
        for msg in ([], "tempo", 5, None):
            with self.assertRaises(TypeError):
                server.handle(FakeLink(), msg)

    def test_unknown_type_is_ignored(self):
        link = FakeLink()
        server.handle(link, {"type": "nope"})
        self.assertEqual((link.tempo, link.forced), (120.0, []))

    def test_first_tap_sets_beat_one_and_tempo(self):
        link = FakeLink()
        server.handle(link, {"type": "tap", "bpm": 128.0, "first": True})
        self.assertEqual(link.tempo, 128.0)
        self.assertEqual(link.forced, [0.0])

    def test_later_tap_keeps_the_bar_and_aligns_the_beat(self):
        link = FakeLink(beat=10.1)
        server.handle(link, {"type": "tap", "bpm": 120.0, "first": False})
        self.assertAlmostEqual(link.beat, 10.0)   # nearest whole beat, bar position untouched

    def test_shift_to_grid_deadband(self):
        link = FakeLink(beat=10.005)
        server.shift_to_grid(link, 0.0)
        self.assertEqual(link.forced, [])

    def test_phase_moves_halfway_towards_the_event(self):
        # tempo 120: 500 ms per beat. Event 400 ms ago happened at beat 10.1 - 0.8 = 9.3, i.e. 0.3 beats after
        # the grid line 9.0 -> the grid has to move back by 0.3; gain 0.5 does half of that.
        link = FakeLink(tempo=120.0, beat=10.1)
        server.handle(link, {"type": "phase", "ago_ms": 400.0})
        self.assertAlmostEqual(link.beat, 10.1 - 0.15)

    def test_snapshot(self):
        link = FakeLink(tempo=127.456, beat=6.5)
        link.num_peers = 2
        self.assertEqual(server.snapshot(link), {"bpm": 127.46, "beat": 2, "quantum": 4, "peers": 2})


class WebSocketTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.link = FakeLink()
        self.client = TestClient(TestServer(server.make_app(self.link)))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def test_snapshot_on_connect_and_commands(self):
        ws = await self.client.ws_connect("/ws")
        first = json.loads((await ws.receive()).data)
        self.assertEqual(first["bpm"], 120.0)
        await ws.send_json({"type": "tempo", "bpm": 130})
        await ws.send_json({"type": "tap", "bpm": None, "first": True})
        await ws.close()
        self.assertEqual(self.link.tempo, 130.0)
        self.assertEqual(self.link.forced, [0.0])

    async def test_garbage_does_not_kill_the_connection(self):
        ws = await self.client.ws_connect("/ws")
        await ws.receive()
        for raw in ("not json", "[]", '{"type": "tempo"}', '{"type": "tempo", "bpm": NaN}', '"x"'):
            await ws.send_str(raw)
        await ws.send_json({"type": "tempo", "bpm": 140})
        await ws.close()
        self.assertEqual(self.link.tempo, 140.0)

    async def test_client_registry(self):
        ws = await self.client.ws_connect("/ws")
        await ws.receive()
        self.assertEqual(len(self.client.app[server.CLIENTS]), 1)
        await ws.close()
        await self.client.close()   # waits for the handler to finish
        self.assertEqual(len(self.client.app[server.CLIENTS]), 0)


if __name__ == "__main__":
    unittest.main()
