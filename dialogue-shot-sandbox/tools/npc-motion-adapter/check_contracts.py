"""Run in factory-startup Blender; no UE connection or production files."""
import sys
from pathlib import Path
from types import SimpleNamespace

from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).parent))
from adapt_motion import blend_transform, matrix, rigid_fit, rotation_angle, unique_names


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
left = Matrix.Identity(4)
right = Matrix.LocRotScale(
    Vector((10, 0, 0)), Quaternion(Vector((0, 0, 1)), 1.5707963267948966),
    Vector((1, 1, 1)),
)
assert blend_transform(left, right, 0) == left
assert blend_transform(left, right, 1) == right
half = blend_transform(left, right, 0.5)
assert abs(half.translation.x - 5) < 1e-6
assert abs(rotation_angle(left, half) - 0.7853981633974483) < 1e-6
print("14 coordinate/name/transform/blend contract checks passed")
