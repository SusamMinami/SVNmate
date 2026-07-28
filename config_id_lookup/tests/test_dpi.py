import unittest

from config_linker.dpi import window_geometry


class DpiTests(unittest.TestCase):
    def test_geometry_scales_and_stays_inside_work_area(self) -> None:
        geometry = window_geometry(
            dpi=120,
            screen_width=2560,
            screen_height=1440,
            work_width=2560,
            work_height=1400,
        )

        self.assertGreaterEqual(geometry.width, 1500)
        self.assertGreaterEqual(geometry.height, 900)
        self.assertLessEqual(geometry.width, 2560)
        self.assertLessEqual(geometry.height, 1400)

    def test_small_screen_is_capped(self) -> None:
        geometry = window_geometry(
            dpi=144,
            screen_width=1366,
            screen_height=768,
            work_width=1366,
            work_height=728,
        )

        self.assertLessEqual(geometry.width, 1366)
        self.assertLessEqual(geometry.height, 728)
        self.assertLessEqual(geometry.minimum_width, geometry.width)
        self.assertLessEqual(geometry.minimum_height, geometry.height)

    def test_standard_dpi_keeps_three_card_minimum(self) -> None:
        geometry = window_geometry(
            dpi=96,
            screen_width=1920,
            screen_height=1080,
            work_width=1920,
            work_height=1040,
        )

        self.assertEqual(geometry.width, 1320)
        self.assertEqual(geometry.height, 820)
        self.assertEqual(geometry.minimum_width, 1120)
        self.assertEqual(geometry.minimum_height, 680)


if __name__ == "__main__":
    unittest.main()
