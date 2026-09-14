"""Run in factory-startup Blender; no UE connection or production files."""
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent))
from adapt_motion import matrix, rigid_fit, unique_names


def rejected(call):
    try:
        call()
    except ValueError:
        return
    raise AssertionError("Invalid input was accepted")


points = [[0, 0, 0], [1, 0, 0], [0, 2, 0], [0, 0, 3], [1, 2, 3]]
rotated = [[-p[1]+2, p[0]-3, p[2]+1] for p in points]
fit, error = rigid_fit(points, rotated)
assert error < 1e-6 and fit.to_3x3().determinant() > 0
reflected = [[-p[0], p[1], p[2]] for p in points]
fit, error = rigid_fit(points, reflected, allow_reflection=True)
assert error < 1e-6 and fit.to_3x3().determinant() < 0
_, wrong_error = rigid_fit(points, reflected)
assert wrong_error > 0.1
rejected(lambda: rigid_fit([[0, 0, 0]]*4, [[0, 0, 0]]*4))
rejected(lambda: unique_names([SimpleNamespace(name="A B"), SimpleNamespace(name="A-B")]))
assert unique_names([SimpleNamespace(name="A B")]) == {"A-B": "A B"}
identity = {"translation": [0, 0, 0], "rotation_xyzw": [0, 0, 0, 1], "scale": [1, 1, 1]}
assert abs(matrix(identity).determinant()-1) < 1e-6
rejected(lambda: matrix({**identity, "translation": [float("nan"), 0, 0]}))
rejected(lambda: matrix({**identity, "rotation_xyzw": [0, 0, 0, 2]}))
rejected(lambda: matrix({**identity, "scale": [2, 1, 1]}))
print("10 coordinate/name/transform contract checks passed")
