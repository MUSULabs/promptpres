"""research/features/geometry.py on synthetic points (no MediaPipe, no video)."""
import math

import numpy as np
import pytest

from research.features import geometry as g

NAN = float("nan")


def test_dist_and_nan_passes_through():
    a = np.array([[0.0, 0.0], [1.0, 1.0], [NAN, 0.0]])
    b = np.array([[3.0, 4.0], [1.0, 1.0], [0.0, 0.0]])
    d = g.dist(a, b)
    assert d[:2].tolist() == [5.0, 0.0]
    assert math.isnan(d[2])


def test_normalise_removes_sway_and_camera_distance():
    # the same pose seen twice: second time shifted 100 px right and twice as large
    wrist = np.array([[110.0, 220.0], [320.0, 640.0]])
    origin = np.array([[100.0, 200.0], [300.0, 600.0]])
    scale = np.array([20.0, 40.0])
    n = g.normalise(wrist, origin, scale)
    assert np.allclose(n, [[0.5, 1.0], [0.5, 1.0]])


def test_normalise_many_points_per_frame():
    pts = np.zeros((2, 21, 2)) + [[[10.0, 20.0]], [[20.0, 40.0]]]
    n = g.normalise(pts, np.zeros((2, 2)), 10.0)
    assert n.shape == (2, 21, 2)
    assert np.allclose(n[1, 5], [2.0, 4.0])
    n2 = g.normalise(pts, np.zeros((2, 2)), np.array([10.0, 20.0]))
    assert np.allclose(n2[:, 0], [[1.0, 2.0], [1.0, 2.0]])


def test_angle_deg():
    a = np.array([[0.0, 0.0]])
    b = np.array([[1.0, 0.0]])
    assert g.angle_deg(a, b, np.array([[2.0, 0.0]]))[0] == pytest.approx(180.0)
    assert g.angle_deg(a, b, np.array([[1.0, 1.0]]))[0] == pytest.approx(90.0)


def eye(outer_x, inner_x, iris, y=100.0):
    return (np.array([[outer_x, y]]), np.array([[inner_x, y]]), np.array([iris], float))


@pytest.mark.parametrize(("outer_x", "inner_x"), [(100.0, 140.0), (140.0, 100.0)])
def test_iris_position_centre_and_down_for_both_eye_directions(outer_x, inner_x):
    mid = (outer_x + inner_x) / 2
    u, v = g.eye_iris_position(*eye(outer_x, inner_x, [mid, 100.0]))
    assert u[0] == pytest.approx(0.5)
    assert v[0] == pytest.approx(0.0)
    # iris 4 px below the corner line of a 40 px eye -> +0.1 eye widths (down), whichever way the
    # corners are ordered in the image
    _, v = g.eye_iris_position(*eye(outer_x, inner_x, [mid, 104.0]))
    assert v[0] == pytest.approx(0.1)


def test_iris_position_towards_the_inner_corner():
    u, _ = g.eye_iris_position(*eye(100.0, 140.0, [130.0, 100.0]))
    assert u[0] == pytest.approx(0.75)


def test_iris_position_ignores_head_roll():
    # eye rotated 90 degrees (corners stacked vertically): the iris at the middle is still centred
    o, i, iris = np.array([[50.0, 0.0]]), np.array([[50.0, 40.0]]), np.array([[50.0, 20.0]])
    u, v = g.eye_iris_position(o, i, iris)
    assert u[0] == pytest.approx(0.5)
    assert v[0] == pytest.approx(0.0)


def test_eye_openness():
    o, i = np.array([[0.0, 0.0]]), np.array([[40.0, 0.0]])
    top, bottom = np.array([[20.0, -6.0]]), np.array([[20.0, 6.0]])
    assert g.eye_openness(o, i, top, bottom)[0] == pytest.approx(0.3)
    assert g.eye_openness(o, i, top, top)[0] == pytest.approx(0.0)


def test_finite_diff_uses_real_timestamps():
    # uneven times (a variable-rate source): 0.0, 0.1, 0.15 s
    t = np.array([0.0, 0.1, 0.15])
    x = np.array([[0.0, 0.0], [1.0, 0.0], [2.0, 0.0]])
    v, t_mid = g.finite_diff(x, t, max_dt=0.25)
    assert math.isnan(v[0, 0])
    assert v[1, 0] == pytest.approx(10.0)
    assert v[2, 0] == pytest.approx(20.0)
    assert t_mid[1:].tolist() == pytest.approx([0.05, 0.125])


def test_finite_diff_gap_and_missing_point_give_nan():
    t = np.array([0.0, 0.1, 0.6, 0.7, 0.8])
    x = np.array([[0.0, 0], [1, 0], [2, 0], [NAN, 0], [3, 0]], float)
    v, _ = g.finite_diff(x, t, max_dt=0.25)
    assert np.isfinite(v[1, 0])
    assert math.isnan(v[2, 0])            # 0.5 s gap
    assert math.isnan(v[3, 0])            # missing point
    assert math.isnan(v[4, 0])            # previous point missing


def test_finite_diff_short_input():
    v, t = g.finite_diff(np.zeros((1, 2)), np.zeros(1), 0.25)
    assert v.shape == (1, 2)
    assert math.isnan(t[0])


def test_motion_magnitudes_constant_velocity_and_constant_acceleration():
    t = np.arange(6) * 0.1
    line = np.stack([2.0 * t, np.zeros_like(t)], 1)            # 2 units/s, no acceleration
    speed, acc, jerk = g.motion_magnitudes(line, t, 0.25)
    assert np.allclose(speed[1:], 2.0)
    assert np.allclose(acc[2:], 0.0)
    assert np.allclose(jerk[3:], 0.0)
    assert np.isnan(acc[1])
    assert np.isnan(jerk[2])
    parabola = np.stack([1.5 * t**2, np.zeros_like(t)], 1)     # acceleration 3 units/s^2
    _, acc, jerk = g.motion_magnitudes(parabola, t, 0.25)
    assert np.allclose(acc[2:], 3.0)
    assert np.allclose(jerk[3:], 0.0, atol=1e-9)


def test_motion_magnitudes_break_on_source_switch():
    t = np.arange(5) * 0.1
    x = np.stack([t, np.zeros_like(t)], 1)
    x[2:, 0] += 0.5                                            # a jump where the source changed
    breaks = np.array([False, False, True, False, False])
    speed, acc, _ = g.motion_magnitudes(x, t, 0.25, breaks=breaks)
    assert math.isnan(speed[2])
    assert math.isnan(acc[2])
    assert math.isnan(acc[3])
    assert speed[3] == pytest.approx(1.0)


def test_match_hands_nearer_side_and_never_twice():
    pose = {"l": (300.0, 400.0), "r": (100.0, 400.0)}
    assert g.match_hands([(105.0, 400.0), (290.0, 410.0)], pose, 200.0, 1.0) == {"l": 1, "r": 0}
    # both hands nearer the left wrist: the closer one wins, the other goes right if within range
    assert g.match_hands([(299.0, 400.0), (290.0, 400.0)], pose, 200.0, 1.0) == {"l": 0, "r": 1}
    # ... but not when the other wrist is more than max_sw shoulder widths away
    assert g.match_hands([(299.0, 400.0), (310.0, 400.0)], pose, 200.0, 1.0) == {"l": 0, "r": None}


def test_match_hands_too_far_or_no_pose_wrist():
    assert g.match_hands([(900.0, 900.0)], {"l": (100.0, 100.0), "r": None}, 50.0, 1.0) \
        == {"l": None, "r": None}
    assert g.match_hands([(1.0, 1.0)], {"l": (NAN, NAN), "r": None}, 50.0, 1.0) == {"l": None, "r": None}
    assert g.match_hands([], {"l": (1.0, 1.0), "r": None}, 50.0, 1.0) == {"l": None, "r": None}
    assert g.match_hands([(1.0, 1.0)], {"l": (1.0, 1.0), "r": None}, NAN, 1.0) == {"l": None, "r": None}


def take_all(sampler, times):
    return [(t, k) for t in times if (k := sampler.take(t)) is not None]


def test_grid_sampler_30fps_takes_every_third_frame():
    times = [i / 30 for i in range(31)]
    picked = take_all(g.GridSampler(10, 0.005), times)
    assert [k for _, k in picked] == pytest.approx([i / 10 for i in range(11)])
    assert [t for t, _ in picked] == pytest.approx([i / 10 for i in range(11)])


def test_grid_sampler_variable_rate_keeps_first_frame_at_or_after_each_grid_time():
    # WebM-like timestamps (s) from a real low-rate clip
    times = [0.0, 0.118, 0.192, 0.197, 0.287, 0.311, 0.355, 0.378, 0.426, 0.443, 0.477, 0.509]
    picked = take_all(g.GridSampler(10, 0.005), times)
    # 0.197 fills 0.2 because it is within the 5 ms tolerance; 0.287 is then too late for 0.2
    assert picked == [(0.0, 0.0), (0.118, 0.1), (0.197, 0.2), (0.311, 0.3), (0.426, 0.4),
                      (0.509, 0.5)]


def test_grid_sampler_gap_skips_grid_points():
    picked = take_all(g.GridSampler(10, 0.005), [0.0, 0.05, 0.45, 0.5])
    assert picked == [(0.0, 0.0), (0.45, 0.4), (0.5, 0.5)]
