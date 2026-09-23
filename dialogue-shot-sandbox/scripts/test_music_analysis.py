from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

import numpy as np


SCRIPT_PATH = Path(__file__).with_name("analyze-music-library.py")
SPEC = importlib.util.spec_from_file_location("music_analysis", SCRIPT_PATH)
assert SPEC and SPEC.loader
music_analysis = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(music_analysis)


class MusicSemanticProfileTests(unittest.TestCase):
    def test_temporal_features_detect_a_gradual_build(self) -> None:
        samples = np.concatenate(
            [
                np.full(4_096, amplitude, dtype=np.float32)
                for amplitude in np.linspace(0.02, 0.5, 8)
            ]
        )

        features = music_analysis.temporal_features(samples)

        self.assertEqual(features["intensity_trajectory"], "渐强")
        self.assertEqual(features["entry_mode"], "慢铺垫")
        self.assertGreater(features["peak_position"], 0.8)

    def test_semantic_profile_combines_metadata_and_audio_shape(self) -> None:
        profile = music_analysis.semantic_profile(
            ["备战/悬疑/危机"],
            "神秘阴谋逐渐显露，压迫感增强",
            "暗线浮现",
            "Hidden_Truth",
            {
                "integrated_lufs": -21,
                "estimated_bpm": 82,
                "tempo_confidence": 0.7,
                "energy_level": "中",
                "intensity_trajectory": "渐强",
                "entry_mode": "慢铺垫",
            },
        )

        self.assertEqual(profile["schema_version"], "music-semantic-profile.v3")
        self.assertIn("悬疑调查", profile["narrative_functions"])
        self.assertIn("神秘", profile["moods"])
        self.assertGreater(profile["tension"], 0.5)
        self.assertEqual(profile["dialogue_fit"], "高")

    def test_broad_legacy_tag_does_not_override_specific_metadata(self) -> None:
        profile = music_analysis.semantic_profile(
            ["备战/悬疑/危机"],
            "胜利后对话",
            "胜利",
            "Victory",
            {
                "integrated_lufs": -15,
                "estimated_bpm": 120,
                "tempo_confidence": 0.6,
                "energy_level": "高",
                "intensity_trajectory": "回落",
                "entry_mode": "慢铺垫",
            },
        )

        self.assertIn("胜利收束", profile["narrative_functions"])
        self.assertNotIn("悬疑调查", profile["narrative_functions"])
        self.assertIn("喜悦", profile["moods"])

    def test_analysis_fields_publishes_structured_profile(self) -> None:
        profile = {
            "schema_version": "music-semantic-profile.v3",
            "narrative_functions": ["关系缓和"],
            "moods": ["温暖"],
            "valence": 0.6,
            "arousal": 0.3,
            "tension": 0.1,
            "intensity_trajectory": "平稳",
            "entry_mode": "柔和进入",
            "dialogue_fit": "高",
            "special_use_only": False,
            "confidence": 0.8,
        }

        fields = music_analysis.analysis_fields(
            {
                "analysis_key": "Sincere",
                "music_name": "情绪-真诚",
                "analysis_status": "ready",
                "semantic_profile": profile,
                "recommended_use": music_analysis.semantic_recommendation(profile),
            }
        )

        self.assertEqual(
            json.loads(fields["语义画像JSON"])["narrative_functions"],
            ["关系缓和"],
        )
        self.assertIn("关系缓和", fields["推荐场景"])


if __name__ == "__main__":
    unittest.main()
