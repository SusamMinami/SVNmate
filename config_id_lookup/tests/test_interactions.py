import unittest

from config_linker.interactions import ClickArbiter


class ClickArbiterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scheduled: dict[str, object] = {}
        self.cancelled: list[str] = []
        self.next_token = 0

    def schedule(self, _delay_ms: int, callback) -> str:
        self.next_token += 1
        token = f"job-{self.next_token}"
        self.scheduled[token] = callback
        return token

    def cancel(self, token: str) -> None:
        self.cancelled.append(token)
        self.scheduled.pop(token, None)

    def test_double_click_cancels_pending_navigation(self) -> None:
        actions: list[str] = []
        arbiter = ClickArbiter(self.schedule, self.cancel)

        arbiter.single(lambda: actions.append("navigate"))
        arbiter.double(lambda: actions.append("copy"))
        arbiter.single(lambda: actions.append("navigate-again"))

        self.assertEqual(self.cancelled, ["job-1"])
        self.assertEqual(actions, ["copy"])
        self.assertEqual(self.scheduled, {})

    def test_single_click_runs_after_delay(self) -> None:
        actions: list[str] = []
        arbiter = ClickArbiter(self.schedule, self.cancel)

        arbiter.single(lambda: actions.append("navigate"))
        callback = self.scheduled["job-1"]
        callback()

        self.assertEqual(actions, ["navigate"])
        self.assertFalse(arbiter.has_pending)

    def test_new_single_click_replaces_previous_pending_action(self) -> None:
        actions: list[str] = []
        arbiter = ClickArbiter(self.schedule, self.cancel)

        arbiter.single(lambda: actions.append("first"))
        arbiter.single(lambda: actions.append("second"))

        self.assertEqual(self.cancelled, ["job-1"])
        self.assertEqual(list(self.scheduled), ["job-2"])


if __name__ == "__main__":
    unittest.main()
