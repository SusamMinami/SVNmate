from __future__ import annotations


CORE_VERSION = "1.1.0"

CORE_CAPABILITIES: dict[str, int] = {
    "update.batch": 1,
    "update.cleanup_retry": 1,
    "update.multi_root_parallel": 1,
    "update.same_root_serial": 1,
}

SVNMATE_CAPABILITIES: dict[str, int] = {
    **CORE_CAPABILITIES,
    "ipc.fifo_queue": 1,
    "ipc.runtime_requirements": 1,
}
