from collections.abc import Callable
from typing import Any


class ClickArbiter:
    def __init__(
        self,
        schedule: Callable[[int, Callable[[], None]], Any],
        cancel: Callable[[Any], None],
        delay_ms: int = 220,
    ) -> None:
        self._schedule = schedule
        self._cancel = cancel
        self._delay_ms = delay_ms
        self._pending: Any = None
        self._suppress_next_single = False

    @property
    def has_pending(self) -> bool:
        return self._pending is not None

    def single(self, callback: Callable[[], None]) -> None:
        if self._suppress_next_single:
            self._suppress_next_single = False
            return
        self._cancel_pending()

        def run() -> None:
            self._pending = None
            callback()

        self._pending = self._schedule(self._delay_ms, run)

    def double(self, callback: Callable[[], None]) -> None:
        self._cancel_pending()
        self._suppress_next_single = True
        callback()

    def _cancel_pending(self) -> None:
        if self._pending is None:
            return
        self._cancel(self._pending)
        self._pending = None
