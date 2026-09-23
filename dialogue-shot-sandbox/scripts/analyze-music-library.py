#!/usr/bin/env python3
"""Download and analyze the BGM catalog with an incremental local cache."""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

import numpy as np


ANALYZER_VERSION = "music-semantic-profile.v3"
BASE_TOKEN = "TxRLbFH2zalbTSsw4O3cFQUAnkb"
TABLE_ID = "tblXRZRyNviXeFSr"
STATE_FILENAME = "d对话音乐状态映射表.csv"
DOWNLOAD_LOCKS: dict[str, Lock] = {}
DOWNLOAD_LOCKS_GUARD = Lock()

NARRATIVE_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("悬疑调查", ("悬疑", "神秘", "阴谋", "诡异", "吊诡", "危机四伏", "调查")),
    ("备战推进", ("备战", "准备", "集结", "行动", "万事俱备", "即将开始")),
    ("冲突升级", ("战斗", "大战", "boss", "危险", "危机", "激战", "追逐")),
    ("胜利收束", ("胜利", "成功", "凯旋", "信心", "希望", "正能量")),
    ("悲伤失落", ("悲伤", "忧伤", "低落", "孤独", "绝望", "悲剧", "哀伤")),
    ("关系缓和", ("真诚", "和解", "温馨", "感人", "圆满", "和平", "信任")),
    ("幽默调剂", ("幽默", "搞笑", "滑稽", "搞怪", "荒诞", "出糗", "笨重")),
    ("日常铺垫", ("日常", "悠闲", "舒缓", "宁静", "安详", "轻松", "主城")),
    ("环境氛围", ("场景", "开放", "村", "酒吧", "森林", "遗迹", "旅程", "异域")),
    ("特殊演出", ("pv", "主题曲", "专属", "演出", "周年", "春节", "圣诞")),
)

MOOD_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("平静", ("平静", "宁静", "安宁", "安详", "舒缓", "悠闲")),
    ("温暖", ("温暖", "温馨", "感人", "真诚", "圆满", "和平")),
    ("幽默", ("幽默", "搞笑", "滑稽", "搞怪", "荒诞", "出糗")),
    ("希望", ("希望", "信心", "正能量", "胜利", "凯旋")),
    ("神秘", ("悬疑", "神秘", "阴谋", "诡异", "吊诡")),
    ("激烈", ("激烈", "重金属", "电吉他", "摇滚", "战斗", "大战")),
    ("紧张", ("紧张", "备战", "危险", "危机", "战斗", "大战")),
    ("压迫", ("压迫", "绝望", "严峻", "沉重", "危机四伏")),
    ("悲伤", ("悲伤", "忧伤", "低落", "孤独", "哀伤")),
    ("庄严", ("庄严", "宏大", "史诗", "管弦", "英雄")),
    ("喜悦", ("快乐", "欢快", "庆典", "节日", "胜利")),
)

TAG_NARRATIVE_PRIORS: dict[str, tuple[str, ...]] = {
    "日常轻松": ("日常铺垫",),
    "忧伤低落": ("悲伤失落",),
    "危险战斗": ("冲突升级",),
    "备战7": ("备战推进",),
    "特殊": ("特殊演出",),
}

TAG_MOOD_PRIORS: dict[str, tuple[str, ...]] = {
    "日常轻松": ("平静",),
    "忧伤低落": ("悲伤",),
    "危险战斗": ("紧张",),
    "备战7": ("紧张", "希望"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--records",
        default=".storyboard-data/music-catalog.ndjson",
    )
    parser.add_argument(
        "--state-map",
        default=r"C:\trunk\doc\csvdir\d对话音乐状态映射表.csv",
    )
    parser.add_argument(
        "--audio-dir",
        default=".storyboard-data/music",
    )
    parser.add_argument(
        "--cache-dir",
        default=".storyboard-data/music-analysis-cache",
    )
    parser.add_argument(
        "--output",
        default=".storyboard-data/music-analysis.ndjson",
    )
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--max-seconds", type=float, default=180.0)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--skip-download", action="store_true")
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--analysis-table", default="音乐音频分析")
    parser.add_argument(
        "--schema",
        default="scripts/music-analysis-table-fields.json",
    )
    return parser.parse_args()


def read_records(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as error:
                raise RuntimeError(
                    f"{path.name} line {line_number} is invalid JSON"
                ) from error
    return records


def read_state_map(path: Path) -> dict[str, int]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.reader(handle))
    if len(rows) < 2:
        raise RuntimeError(f"{path} does not contain the two CSV header rows")
    members = [cell.removeprefix("##&").strip() for cell in rows[0]]
    try:
        id_index = members.index("DialogMusicState.id")
        state_index = members.index("DialogMusicState.WwiseState")
    except ValueError as error:
        raise RuntimeError(
            f"{path} is missing DialogMusicState.id or "
            "DialogMusicState.WwiseState"
        ) from error
    result: dict[str, int] = {}
    for row in rows[2:]:
        if len(row) <= max(id_index, state_index):
            continue
        state_name = row[state_index].strip()
        if state_name and row[id_index].strip().isdigit():
            result[state_name] = int(row[id_index].strip())
    return result


def safe_file_name(file_token: str, file_name: str) -> str:
    safe_token = re.sub(r"[^A-Za-z0-9_-]", "_", file_token)
    safe_name = re.sub(r'[<>:"/\\|?*]', "_", file_name)
    return f"{safe_token}-{safe_name}"


def parse_cli_json(output: str) -> dict[str, Any]:
    text = output.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise RuntimeError("lark-cli returned invalid JSON")


def lark_cli_command() -> list[str]:
    app_data = os.environ.get("APPDATA")
    if not app_data:
        raise RuntimeError("APPDATA is not set")
    entry = (
        Path(app_data)
        / "npm"
        / "node_modules"
        / "@larksuite"
        / "cli"
        / "scripts"
        / "run.js"
    )
    node = shutil.which("node")
    if not node or not entry.is_file():
        raise RuntimeError("lark-cli runtime was not found")
    return [node, str(entry)]


def run_lark(
    project_root: Path,
    args: list[str],
    timeout: int = 120,
) -> dict[str, Any]:
    environment = {
        **os.environ,
        "LARKSUITE_CLI_NO_UPDATE_NOTIFIER": "1",
        "LARKSUITE_CLI_NO_SKILLS_NOTIFIER": "1",
    }
    completed = subprocess.run(
        [*lark_cli_command(), *args],
        cwd=project_root,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
    )
    envelope = parse_cli_json(completed.stdout or completed.stderr)
    if completed.returncode != 0 or envelope.get("ok") is False:
        error = envelope.get("error") or {}
        raise RuntimeError(error.get("message") or "lark-cli command failed")
    data = envelope.get("data")
    return data if isinstance(data, dict) else envelope


def download_attachment(
    project_root: Path,
    target: Path,
    record_id: str,
    file_token: str,
    expected_size: int,
) -> None:
    with DOWNLOAD_LOCKS_GUARD:
        download_lock = DOWNLOAD_LOCKS.setdefault(file_token, Lock())
    with download_lock:
        if target.is_file() and (
            expected_size <= 0 or target.stat().st_size == expected_size
        ):
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        relative_target = target.relative_to(project_root).as_posix()
        run_lark(
            project_root,
            [
            "base",
            "+record-download-attachment",
            "--base-token",
            BASE_TOKEN,
            "--table-id",
            TABLE_ID,
            "--record-id",
            record_id,
            "--file-token",
            file_token,
            "--output",
            f"./{relative_target}",
            "--overwrite",
            "--as",
            "user",
            ],
            timeout=240,
        )
        if not target.is_file() or target.stat().st_size == 0:
            raise RuntimeError("music attachment download produced no file")


def ffprobe(path: Path) -> dict[str, Any]:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_name,sample_rate,channels:format=duration,size",
        "-of",
        "json",
        str(path),
    ]
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
        check=True,
    )
    payload = json.loads(result.stdout)
    streams = payload.get("streams") or []
    if not streams:
        raise RuntimeError("file has no audio stream")
    stream = streams[0]
    format_data = payload.get("format") or {}
    return {
        "codec": str(stream.get("codec_name") or ""),
        "sample_rate_hz": int(stream.get("sample_rate") or 0),
        "channels": int(stream.get("channels") or 0),
        "duration_seconds": float(format_data.get("duration") or 0),
        "file_size_bytes": int(format_data.get("size") or path.stat().st_size),
    }


def decode_samples(path: Path, max_seconds: float) -> np.ndarray:
    command = [
        "ffmpeg",
        "-v",
        "error",
        "-i",
        str(path),
        "-t",
        str(max_seconds),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "11025",
        "-f",
        "f32le",
        "pipe:1",
    ]
    result = subprocess.run(
        command,
        capture_output=True,
        timeout=max(120, int(max_seconds * 2)),
        check=True,
    )
    samples = np.frombuffer(result.stdout, dtype="<f4")
    if samples.size < 2_048:
        raise RuntimeError("decoded audio is too short to analyze")
    return samples


def loudness(path: Path, max_seconds: float) -> dict[str, float | None]:
    command = [
        "ffmpeg",
        "-hide_banner",
        "-nostats",
        "-i",
        str(path),
        "-t",
        str(max_seconds),
        "-vn",
        "-af",
        "loudnorm=I=-24:LRA=7:TP=-2:print_format=json",
        "-f",
        "null",
        os.devnull,
    ]
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=max(120, int(max_seconds * 2)),
        check=False,
    )
    matches = re.findall(r"\{[\s\S]*?\}", result.stderr)
    if not matches:
        return {
            "integrated_lufs": None,
            "loudness_range_lu": None,
            "true_peak_dbfs": None,
        }
    payload = json.loads(matches[-1])

    def finite_value(key: str) -> float | None:
        try:
            value = float(payload[key])
            return value if math.isfinite(value) else None
        except (KeyError, TypeError, ValueError):
            return None

    return {
        "integrated_lufs": finite_value("input_i"),
        "loudness_range_lu": finite_value("input_lra"),
        "true_peak_dbfs": finite_value("input_tp"),
    }


def estimate_bpm(onset_envelope: np.ndarray, frame_rate: float) -> tuple[float | None, float]:
    if onset_envelope.size < 16 or float(np.max(onset_envelope)) <= 1e-9:
        return None, 0.0
    centered = onset_envelope - np.mean(onset_envelope)
    minimum_lag = max(1, round(frame_rate * 60 / 190))
    maximum_lag = min(len(centered) - 2, round(frame_rate * 60 / 55))
    candidates: list[tuple[float, int]] = []
    for lag in range(minimum_lag, maximum_lag + 1):
        left = centered[:-lag]
        right = centered[lag:]
        denominator = math.sqrt(float(np.dot(left, left) * np.dot(right, right)))
        score = float(np.dot(left, right) / denominator) if denominator else 0.0
        candidates.append((score, lag))
    if not candidates:
        return None, 0.0
    score, lag = max(candidates)
    bpm = 60 * frame_rate / lag
    if bpm < 70:
        bpm *= 2
    elif bpm > 160:
        bpm /= 2
    confidence = max(0.0, min(1.0, score))
    return round(bpm, 1), round(confidence, 3)


def temporal_features(samples: np.ndarray, segment_count: int = 8) -> dict[str, Any]:
    levels: list[float] = []
    for segment in np.array_split(samples, segment_count):
        rms = float(np.sqrt(np.mean(np.square(segment, dtype=np.float64))))
        levels.append(20 * math.log10(max(rms, 1e-12)))
    x_axis = np.arange(len(levels), dtype=np.float64)
    slope = float(np.polyfit(x_axis, np.asarray(levels), 1)[0])
    total_change = slope * max(1, len(levels) - 1)
    level_range = max(levels) - min(levels)
    if total_change >= 3:
        trajectory = "渐强"
    elif total_change <= -3:
        trajectory = "回落"
    elif level_range >= 7:
        trajectory = "起伏"
    else:
        trajectory = "平稳"
    later_level = float(np.median(levels[1:])) if len(levels) > 1 else levels[0]
    if levels[0] >= later_level - 1.5:
        entry_mode = "立即进入"
    elif levels[0] <= later_level - 5:
        entry_mode = "慢铺垫"
    else:
        entry_mode = "柔和进入"
    return {
        "segment_rms_dbfs": [round(level, 2) for level in levels],
        "intensity_trajectory": trajectory,
        "entry_mode": entry_mode,
        "peak_position": round((int(np.argmax(levels)) + 0.5) / len(levels), 3),
    }


def signal_features(samples: np.ndarray, sample_rate: int = 11_025) -> dict[str, Any]:
    peak = float(np.max(np.abs(samples)))
    rms = float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))
    peak_dbfs = 20 * math.log10(max(peak, 1e-12))
    rms_dbfs = 20 * math.log10(max(rms, 1e-12))
    frame_size = 2_048
    hop_size = 512
    window = np.hanning(frame_size).astype(np.float32)
    frequencies = np.fft.rfftfreq(frame_size, 1 / sample_rate)
    band_energy = np.zeros(3, dtype=np.float64)
    weighted_centroid = 0.0
    total_spectral_magnitude = 0.0
    flux_values: list[float] = []
    previous_magnitude: np.ndarray | None = None
    for start in range(0, samples.size - frame_size + 1, hop_size):
        frame = samples[start : start + frame_size] * window
        magnitude = np.abs(np.fft.rfft(frame))
        power = np.square(magnitude)
        total = float(np.sum(power))
        if total <= 1e-12:
            continue
        band_energy[0] += float(np.sum(power[(frequencies >= 20) & (frequencies < 250)]))
        band_energy[1] += float(np.sum(power[(frequencies >= 250) & (frequencies < 2_000)]))
        band_energy[2] += float(np.sum(power[frequencies >= 2_000]))
        magnitude_total = float(np.sum(magnitude))
        weighted_centroid += float(np.sum(frequencies * magnitude))
        total_spectral_magnitude += magnitude_total
        if previous_magnitude is not None:
            denominator = float(np.sum(previous_magnitude)) + 1e-12
            flux_values.append(
                float(np.sum(np.maximum(magnitude - previous_magnitude, 0))) / denominator
            )
        previous_magnitude = magnitude
    band_total = float(np.sum(band_energy))
    ratios = band_energy / band_total if band_total > 0 else band_energy
    onset = np.asarray(flux_values, dtype=np.float64)
    if onset.size >= 3:
        onset = np.convolve(onset, np.ones(3) / 3, mode="same")
        baseline_width = max(3, round(sample_rate / hop_size))
        baseline = np.convolve(
            onset,
            np.ones(baseline_width) / baseline_width,
            mode="same",
        )
        onset = np.maximum(onset - baseline, 0)
    bpm, confidence = estimate_bpm(onset, sample_rate / hop_size)
    return {
        "estimated_bpm": bpm,
        "tempo_confidence": confidence,
        "rms_dbfs": round(rms_dbfs, 2),
        "sample_peak_dbfs": round(peak_dbfs, 2),
        "dynamic_range_db": round(peak_dbfs - rms_dbfs, 2),
        "spectral_centroid_hz": round(
            weighted_centroid / total_spectral_magnitude
            if total_spectral_magnitude > 0
            else 0,
            1,
        ),
        "low_frequency_ratio": round(float(ratios[0]), 4),
        "mid_frequency_ratio": round(float(ratios[1]), 4),
        "high_frequency_ratio": round(float(ratios[2]), 4),
        **temporal_features(samples),
    }


def classify_features(result: dict[str, Any]) -> None:
    bpm = result.get("estimated_bpm")
    lufs = result.get("integrated_lufs")
    centroid = result.get("spectral_centroid_hz")
    result["tempo_level"] = (
        "未知" if bpm is None else "慢" if bpm < 80 else "中" if bpm < 120 else "快"
    )
    result["energy_level"] = (
        "未知" if lufs is None else "低" if lufs < -24 else "中" if lufs < -17 else "高"
    )
    result["brightness"] = (
        "未知"
        if centroid is None
        else "偏暗"
        if centroid < 1_500
        else "均衡"
        if centroid < 3_000
        else "明亮"
    )
    bpm_text = "未知 BPM" if bpm is None else f"{bpm:.1f} BPM"
    lufs_text = "响度未知" if lufs is None else f"{lufs:.1f} LUFS"
    result["analysis_summary"] = (
        f"{result['tempo_level']}速（{bpm_text}，置信度 "
        f"{result.get('tempo_confidence', 0):.2f}），"
        f"{result['energy_level']}能量（{lufs_text}，动态范围 "
        f"{result.get('dynamic_range_db', 0):.1f} dB），"
        f"音色{result['brightness']}（频谱重心 "
        f"{result.get('spectral_centroid_hz', 0) / 1_000:.2f} kHz；"
        f"低/中/高频 "
        f"{result.get('low_frequency_ratio', 0) * 100:.1f}%/"
        f"{result.get('mid_frequency_ratio', 0) * 100:.1f}%/"
        f"{result.get('high_frequency_ratio', 0) * 100:.1f}%）"
    )


def clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def semantic_profile(
    tags: list[str],
    notes: str,
    name: str,
    state_name: str,
    result: dict[str, Any],
) -> dict[str, Any]:
    note_text = re.split(r"[；;]文件[:：]", notes)[0].strip("；; ")
    text = " ".join([name, state_name, note_text]).lower()
    narrative_scores = {label: 0 for label, _ in NARRATIVE_RULES}
    mood_scores = {label: 0 for label, _ in MOOD_RULES}
    keyword_matches = 0
    for label, terms in NARRATIVE_RULES:
        matches = sum(term.lower() in text for term in terms)
        narrative_scores[label] += matches
        keyword_matches += matches
    for tag in tags:
        for label in TAG_NARRATIVE_PRIORS.get(tag, ()):
            narrative_scores[label] += 2
    for label, terms in MOOD_RULES:
        matches = sum(term.lower() in text for term in terms)
        mood_scores[label] += matches
        keyword_matches += matches
    for tag in tags:
        for label in TAG_MOOD_PRIORS.get(tag, ()):
            mood_scores[label] += 1

    narrative_functions = [
        label
        for label, score in sorted(
            narrative_scores.items(),
            key=lambda item: (-item[1], list(narrative_scores).index(item[0])),
        )
        if score > 0
    ][:3]
    if not narrative_functions:
        narrative_functions = ["日常铺垫"]
    moods = [
        label
        for label, score in sorted(
            mood_scores.items(),
            key=lambda item: (-item[1], list(mood_scores).index(item[0])),
        )
        if score > 0
    ][:3]
    if not moods:
        moods = [
            "激烈"
            if result.get("energy_level") == "高"
            else "平静"
            if result.get("energy_level") == "低"
            else "克制"
        ]

    positive_terms = (
        "温暖", "温馨", "真诚", "圆满", "和平", "快乐", "欢快", "庆典",
        "胜利", "希望", "信心", "正能量", "悠闲", "舒适",
    )
    negative_terms = (
        "悲伤", "忧伤", "低落", "孤独", "绝望", "悲剧", "危险", "危机",
        "压迫", "沉重", "严峻",
    )
    positive = sum(term in text for term in positive_terms)
    negative = sum(term in text for term in negative_terms)
    valence = math.tanh((positive - negative) / 2.5)

    lufs = result.get("integrated_lufs")
    bpm = result.get("estimated_bpm")
    tempo_confidence = float(result.get("tempo_confidence") or 0)
    loudness_arousal = (
        clamp((float(lufs) + 30) / 18) if lufs is not None else 0.5
    )
    tempo_arousal = (
        clamp((float(bpm) - 55) / 100) if bpm is not None else 0.5
    )
    tempo_weight = 0.3 * max(0.25, tempo_confidence)
    arousal = (
        loudness_arousal * 0.7
        + tempo_arousal * tempo_weight
    ) / (0.7 + tempo_weight)
    if any(term in text for term in ("激烈", "大战", "高潮", "重金属")):
        arousal += 0.15
    if any(term in text for term in ("安眠", "舒缓", "宁静", "平静")):
        arousal -= 0.15
    arousal = clamp(arousal)

    tension = 0.12 + arousal * 0.18
    if "悬疑调查" in narrative_functions:
        tension += 0.32
    if "备战推进" in narrative_functions:
        tension += 0.24
    if "冲突升级" in narrative_functions:
        tension += 0.42
    if "悲伤失落" in narrative_functions:
        tension += 0.12
    if "关系缓和" in narrative_functions or "日常铺垫" in narrative_functions:
        tension -= 0.12
    tension = clamp(tension)

    special_use_only = (
        "特殊" in tags
        or any(
            term in text
            for term in ("pv", "主题曲", "专属", "周年", "春节", "圣诞")
        )
    )
    vocal = any(term in text for term in ("人声", "主唱", "歌曲"))
    if special_use_only or vocal:
        dialogue_fit = "低"
    elif (
        result.get("energy_level") != "高"
        and result.get("entry_mode") != "立即进入"
        and "冲突升级" not in narrative_functions
    ):
        dialogue_fit = "高"
    else:
        dialogue_fit = "中"

    confidence = 0.4
    confidence += min(0.35, keyword_matches * 0.04)
    confidence += 0.1 if tags else 0
    confidence += 0.1 if lufs is not None else 0
    return {
        "schema_version": ANALYZER_VERSION,
        "narrative_functions": narrative_functions,
        "moods": moods,
        "valence": round(clamp(valence, -1, 1), 3),
        "arousal": round(arousal, 3),
        "tension": round(tension, 3),
        "intensity_trajectory": str(result.get("intensity_trajectory") or "平稳"),
        "entry_mode": str(result.get("entry_mode") or "柔和进入"),
        "dialogue_fit": dialogue_fit,
        "special_use_only": special_use_only,
        "confidence": round(clamp(confidence), 3),
    }


def semantic_recommendation(profile: dict[str, Any]) -> str:
    valence = float(profile["valence"])
    tone = "正向" if valence >= 0.25 else "负向" if valence <= -0.25 else "中性"
    arousal = float(profile["arousal"])
    arousal_text = "高唤醒" if arousal >= 0.67 else "中唤醒" if arousal >= 0.34 else "低唤醒"
    tension = float(profile["tension"])
    tension_text = "高张力" if tension >= 0.67 else "中张力" if tension >= 0.34 else "低张力"
    return (
        f"叙事功能：{'、'.join(profile['narrative_functions'])}；"
        f"情绪：{'、'.join(profile['moods'])}；"
        f"{tone}、{arousal_text}、{tension_text}；"
        f"{profile['intensity_trajectory']}、{profile['entry_mode']}；"
        f"对白兼容{profile['dialogue_fit']}"
    )


def refresh_semantic_fields(
    result: dict[str, Any],
    tags: list[str],
    notes: str,
    name: str,
    state_name: str,
) -> dict[str, Any]:
    classify_features(result)
    result["semantic_profile"] = semantic_profile(
        tags,
        notes,
        name,
        state_name,
        result,
    )
    result["recommended_use"] = semantic_recommendation(result["semantic_profile"])
    return result


def declared_bpm(*values: str) -> float | None:
    text = " ".join(values)
    match = re.search(
        r"(?i)(?:bpm[_\s-]*(\d{2,3})|(\d{2,3})[_\s-]*bpm)",
        text,
    )
    if not match:
        return None
    value = float(match.group(1) or match.group(2))
    return value if 40 <= value <= 240 else None


def analyze_record(
    record: dict[str, Any],
    state_map: dict[str, int],
    project_root: Path,
    audio_dir: Path,
    cache_dir: Path,
    max_seconds: float,
    skip_download: bool,
) -> dict[str, Any]:
    record_id = str(record.get("record_id") or "")
    state_name = str(record.get("资源标识") or "").strip()
    name = str(record.get("BGM名称") or state_name)
    tags = [str(tag) for tag in (record.get("标签") or [])]
    notes = str(record.get("备注") or "")
    files = record.get("BGM文件") or []
    attachment = files[0] if files else {}
    file_token = str(attachment.get("file_token") or "")
    file_name = str(attachment.get("name") or "")
    expected_size = int(attachment.get("size") or 0)
    base = {
        "analysis_key": state_name or record_id,
        "source_record_id": record_id,
        "music_name": name,
        "state_name": state_name,
        "state_id": state_map.get(state_name),
        "file_token": file_token,
        "file_name": file_name,
        "source_tags": tags,
        "source_notes": notes,
        "analyzer_version": ANALYZER_VERSION,
    }
    if not file_token or not file_name:
        return {
            **base,
            "analysis_status": "missing_attachment",
            "analysis_error": "飞书记录未提供 BGM 文件",
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
        }
    cache_path = cache_dir / f"{file_token}.json"
    if cache_path.is_file():
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
        if (
            cached.get("analyzer_version") == ANALYZER_VERSION
            and cached.get("file_token") == file_token
            and cached.get("source_size_bytes") == expected_size
            and cached.get("analysis_limit_seconds") == max_seconds
        ):
            return refresh_semantic_fields(
                {**cached, **base},
                tags,
                notes,
                name,
                state_name,
            )
    audio_path = audio_dir / safe_file_name(file_token, file_name)
    if skip_download and not audio_path.is_file():
        raise RuntimeError("attachment is not cached")
    download_attachment(
        project_root,
        audio_path,
        record_id,
        file_token,
        expected_size,
    )
    probe = ffprobe(audio_path)
    samples = decode_samples(audio_path, max_seconds)
    features = signal_features(samples)
    metadata_bpm = declared_bpm(state_name, name, file_name, notes)
    if metadata_bpm is not None:
        features["estimated_bpm"] = metadata_bpm
        features["tempo_confidence"] = 1.0
        features["bpm_source"] = "资源标识"
    else:
        features["bpm_source"] = "音频估算"
    result = {
        **base,
        **probe,
        **features,
        **loudness(audio_path, max_seconds),
        "source_size_bytes": expected_size,
        "analysis_limit_seconds": max_seconds,
        "analyzed_seconds": round(
            min(float(probe["duration_seconds"]), max_seconds),
            3,
        ),
        "analysis_status": "ready",
        "analysis_error": "",
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }
    refresh_semantic_fields(result, tags, notes, name, state_name)
    cache_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=cache_dir,
        delete=False,
    ) as handle:
        temporary = Path(handle.name)
        handle.write(json.dumps(result, ensure_ascii=False, indent=2))
    temporary.replace(cache_path)
    return result


def analysis_fields(item: dict[str, Any]) -> dict[str, Any]:
    status_names = {
        "ready": "完成",
        "missing_attachment": "缺少附件",
        "failed": "失败",
    }
    fields: dict[str, Any] = {
        "资源标识": item.get("analysis_key") or "",
        "BGM名称": item.get("music_name") or "",
        "源记录ID": item.get("source_record_id") or "",
        "状态ID": item.get("state_id"),
        "文件Token": item.get("file_token") or "",
        "文件名": item.get("file_name") or "",
        "BPM来源": item.get("bpm_source") or "",
        "来源标签": "、".join(item.get("source_tags") or []),
        "来源备注": item.get("source_notes") or "",
        "推荐场景": item.get("recommended_use") or "",
        "语义画像JSON": json.dumps(
            item.get("semantic_profile") or {},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        "音频特征摘要": item.get("analysis_summary") or "",
        "分析器版本": item.get("analyzer_version") or ANALYZER_VERSION,
        "分析状态": [status_names.get(item.get("analysis_status"), "失败")],
        "错误信息": item.get("analysis_error") or "",
    }
    source_record_id = item.get("source_record_id")
    if source_record_id:
        fields["源音乐记录"] = [{"id": source_record_id}]
    numeric_fields = {
        "文件大小MB": (
            item.get("file_size_bytes") or item.get("source_size_bytes")
        ),
        "时长秒": item.get("duration_seconds"),
        "分析采样秒": item.get("analyzed_seconds"),
        "采样率Hz": item.get("sample_rate_hz"),
        "声道数": item.get("channels"),
        "估算BPM": item.get("estimated_bpm"),
        "节奏置信度": item.get("tempo_confidence"),
        "综合响度LUFS": item.get("integrated_lufs"),
        "响度范围LU": item.get("loudness_range_lu"),
        "真峰值dBFS": item.get("true_peak_dbfs"),
        "RMS电平dBFS": item.get("rms_dbfs"),
        "动态范围dB": item.get("dynamic_range_db"),
        "频谱重心Hz": item.get("spectral_centroid_hz"),
        "低频占比": item.get("low_frequency_ratio"),
        "中频占比": item.get("mid_frequency_ratio"),
        "高频占比": item.get("high_frequency_ratio"),
    }
    for name, value in numeric_fields.items():
        if value is not None:
            fields[name] = (
                round(float(value) / (1024 * 1024), 2)
                if name == "文件大小MB"
                else value
            )
    if item.get("codec"):
        fields["编码"] = item["codec"]
    for field_name, key in [
        ("速度等级", "tempo_level"),
        ("能量等级", "energy_level"),
        ("音色明暗", "brightness"),
    ]:
        if item.get(key):
            fields[field_name] = [item[key]]
    analyzed_at = item.get("analyzed_at")
    if analyzed_at:
        fields["分析时间"] = (
            datetime.fromisoformat(str(analyzed_at))
            .astimezone()
            .strftime("%Y-%m-%d %H:%M")
        )
    return fields


def ensure_analysis_fields(
    project_root: Path,
    table_id: str,
    schema_path: Path,
) -> int:
    field_data = run_lark(
        project_root,
        [
            "base",
            "+field-list",
            "--base-token",
            BASE_TOKEN,
            "--table-id",
            table_id,
            "--as",
            "user",
            "--format",
            "json",
        ],
    )
    existing_names = {
        str(field.get("name") or "")
        for field in field_data.get("fields", [])
    }
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    missing = [
        field
        for field in schema
        if str(field.get("name") or "") not in existing_names
    ]
    if not missing:
        return 0
    payload_path = (
        project_root / ".storyboard-data" / "music-analysis-fields-create.json"
    )
    payload_path.parent.mkdir(parents=True, exist_ok=True)
    payload_path.write_text(
        json.dumps(missing, ensure_ascii=False),
        encoding="utf-8",
    )
    try:
        run_lark(
            project_root,
            [
                "base",
                "+field-create",
                "--base-token",
                BASE_TOKEN,
                "--table-id",
                table_id,
                "--json",
                f"@{payload_path.relative_to(project_root).as_posix()}",
                "--as",
                "user",
                "--format",
                "json",
            ],
        )
    finally:
        payload_path.unlink(missing_ok=True)
    return len(missing)


def publish_analysis(
    project_root: Path,
    results: list[dict[str, Any]],
    table_name: str,
    schema_path: Path,
) -> dict[str, Any]:
    table_data = run_lark(
        project_root,
        [
            "base",
            "+table-list",
            "--base-token",
            BASE_TOKEN,
            "--as",
            "user",
            "--format",
            "json",
        ],
    )
    matches = [
        table
        for table in table_data.get("tables", [])
        if table.get("name") == table_name
    ]
    if len(matches) > 1:
        raise RuntimeError(f"multiple Base tables are named {table_name}")
    created_field_count = 0
    if matches:
        table_id = str(matches[0]["id"])
        created_field_count = ensure_analysis_fields(
            project_root,
            table_id,
            schema_path,
        )
    else:
        schema_argument = f"@{schema_path.relative_to(project_root).as_posix()}"
        created = run_lark(
            project_root,
            [
                "base",
                "+table-create",
                "--base-token",
                BASE_TOKEN,
                "--name",
                table_name,
                "--fields",
                schema_argument,
                "--as",
                "user",
                "--format",
                "json",
            ],
        )
        table_id = str((created.get("table") or {}).get("id") or "")
        if not table_id:
            raise RuntimeError("Base did not return the created analysis table ID")
    existing_path = (
        project_root / ".storyboard-data" / "music-analysis-existing.ndjson"
    )
    run_lark(
        project_root,
        [
            "base",
            "+record-list",
            "--base-token",
            BASE_TOKEN,
            "--table-id",
            table_id,
            "--field-id",
            "资源标识",
            "--format",
            "ndjson",
            "--output",
            f"./{existing_path.relative_to(project_root).as_posix()}",
            "--overwrite",
            "--as",
            "user",
        ],
    )
    existing_records = (
        read_records(existing_path) if existing_path.is_file() else []
    )
    existing_by_key = {
        str(record.get("资源标识") or ""): str(record.get("record_id") or "")
        for record in existing_records
        if record.get("资源标识") and record.get("record_id")
    }
    creates: list[dict[str, Any]] = []
    updates: dict[str, dict[str, Any]] = {}
    for result in results:
        fields = analysis_fields(result)
        record_id = existing_by_key.get(str(fields["资源标识"]))
        if record_id:
            updates[record_id] = fields
        else:
            creates.append(fields)
    payload_dir = project_root / ".storyboard-data"
    payload_dir.mkdir(parents=True, exist_ok=True)
    if creates:
        create_path = payload_dir / "music-analysis-create.json"
        create_path.write_text(
            json.dumps({"create_records": creates}, ensure_ascii=False),
            encoding="utf-8",
        )
        try:
            run_lark(
                project_root,
                [
                    "base",
                    "+record-batch-create",
                    "--base-token",
                    BASE_TOKEN,
                    "--table-id",
                    table_id,
                    "--json",
                    f"@{create_path.relative_to(project_root).as_posix()}",
                    "--as",
                    "user",
                    "--format",
                    "json",
                ],
            )
        finally:
            create_path.unlink(missing_ok=True)
    if updates:
        update_path = payload_dir / "music-analysis-update.json"
        update_path.write_text(
            json.dumps({"update_records": updates}, ensure_ascii=False),
            encoding="utf-8",
        )
        try:
            run_lark(
                project_root,
                [
                    "base",
                    "+record-batch-update",
                    "--base-token",
                    BASE_TOKEN,
                    "--table-id",
                    table_id,
                    "--json",
                    f"@{update_path.relative_to(project_root).as_posix()}",
                    "--as",
                    "user",
                    "--format",
                    "json",
                ],
            )
        finally:
            update_path.unlink(missing_ok=True)
    verification_path = (
        project_root / ".storyboard-data" / "music-analysis-verified.ndjson"
    )
    verification = run_lark(
        project_root,
        [
            "base",
            "+record-list",
            "--base-token",
            BASE_TOKEN,
            "--table-id",
            table_id,
            "--field-id",
            "资源标识",
            "--field-id",
            "分析状态",
            "--field-id",
            "分析器版本",
            "--field-id",
            "语义画像JSON",
            "--format",
            "ndjson",
            "--output",
            f"./{verification_path.relative_to(project_root).as_posix()}",
            "--overwrite",
            "--as",
            "user",
        ],
    )
    verification_records = (
        read_records(verification_path) if verification_path.is_file() else []
    )
    current_keys = {
        str(result.get("analysis_key") or "")
        for result in results
        if result.get("analysis_key")
    }
    current_records = [
        record
        for record in verification_records
        if str(record.get("资源标识") or "") in current_keys
    ]
    verified_v3_profiles = 0
    for record in current_records:
        try:
            profile = json.loads(str(record.get("语义画像JSON") or "{}"))
        except json.JSONDecodeError:
            continue
        if profile.get("schema_version") == "music-semantic-profile.v3":
            verified_v3_profiles += 1
    return {
        "table_id": table_id,
        "created_fields": created_field_count,
        "created": len(creates),
        "updated": len(updates),
        "verified_records": verification.get("records_count", 0),
        "verified_current_records": len(current_records),
        "verified_v3_profiles": verified_v3_profiles,
        "historical_records": max(
            0,
            len(verification_records) - len(current_records),
        ),
        "has_more": verification.get("has_more", False),
    }


def main() -> int:
    args = parse_args()
    project_root = Path.cwd().resolve()
    records_path = (project_root / args.records).resolve()
    state_path = Path(args.state_map).resolve()
    audio_dir = (project_root / args.audio_dir).resolve()
    cache_dir = (project_root / args.cache_dir).resolve()
    output_path = (project_root / args.output).resolve()
    records = read_records(records_path)
    if args.limit:
        records = records[: args.limit]
    state_map = read_state_map(state_path)
    audio_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []

    def worker(record: dict[str, Any]) -> dict[str, Any]:
        try:
            return analyze_record(
                record,
                state_map,
                project_root,
                audio_dir,
                cache_dir,
                args.max_seconds,
                args.skip_download,
            )
        except Exception as error:
            state_name = str(record.get("资源标识") or "").strip()
            return {
                "analysis_key": state_name or str(record.get("record_id") or ""),
                "source_record_id": str(record.get("record_id") or ""),
                "music_name": str(record.get("BGM名称") or state_name),
                "state_name": state_name,
                "state_id": state_map.get(state_name),
                "file_token": str(
                    ((record.get("BGM文件") or [{}])[0]).get("file_token") or ""
                ),
                "file_name": str(
                    ((record.get("BGM文件") or [{}])[0]).get("name") or ""
                ),
                "source_tags": [
                    str(tag) for tag in (record.get("标签") or [])
                ],
                "source_notes": str(record.get("备注") or ""),
                "analyzer_version": ANALYZER_VERSION,
                "analysis_status": "failed",
                "analysis_error": str(error),
                "analyzed_at": datetime.now(timezone.utc).isoformat(),
            }

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {
            executor.submit(worker, record): index
            for index, record in enumerate(records)
        }
        completed = 0
        for future in as_completed(futures):
            results.append(future.result())
            completed += 1
            result = results[-1]
            print(
                f"[{completed}/{len(records)}] "
                f"{result.get('state_name') or result.get('music_name')} "
                f"{result['analysis_status']}",
                flush=True,
            )

    results.sort(
        key=lambda item: (
            item.get("state_id") is None,
            item.get("state_id") or 0,
            item.get("analysis_key") or "",
        )
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=output_path.parent,
        delete=False,
    ) as handle:
        temporary_output = Path(handle.name)
        for result in results:
            handle.write(json.dumps(result, ensure_ascii=False) + "\n")
    temporary_output.replace(output_path)
    summary = {
        "output": str(output_path),
        "records": len(results),
        "ready": sum(item["analysis_status"] == "ready" for item in results),
        "missing_attachment": sum(
            item["analysis_status"] == "missing_attachment" for item in results
        ),
        "failed": sum(item["analysis_status"] == "failed" for item in results),
        "analyzer_version": ANALYZER_VERSION,
    }
    if args.publish:
        summary["publish"] = publish_analysis(
            project_root,
            results,
            args.analysis_table,
            (project_root / args.schema).resolve(),
        )
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    return 1 if summary["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
