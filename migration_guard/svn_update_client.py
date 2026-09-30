from svnmate_update_client import (
    RESULT_PREFIX,
    MigrationUpdateClient,
    SvnMateUpdateClient,
    main,
    update_working_copies,
)

__all__ = [
    "RESULT_PREFIX",
    "MigrationUpdateClient",
    "SvnMateUpdateClient",
    "main",
    "update_working_copies",
]


if __name__ == "__main__":
    raise SystemExit(main())
