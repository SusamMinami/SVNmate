"""Local-only, single-job speech worker. JSON input; NDJSON progress/result output."""
import contextlib
import gc
import json
import math
import os
import re
import sys
import time

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"


def emit(kind, **data):
    print(json.dumps(dict(type=kind, **data), ensure_ascii=True), flush=True)


def normalize(text):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKC", text).lower() if c.isalnum())


def group_alignment(lines, items, origin, crop_start, duration):
    cursor = 0
    output = []
    for line in lines:
        expected = normalize(line["text"])
        collected, selected = "", []
        while cursor < len(items) and len(collected) < len(expected):
            item = items[cursor]
            collected += normalize(item.text)
            selected.append(item)
            cursor += 1
        if not expected or collected != expected:
            raise ValueError("Alignment text mapping mismatch; no subtitle timings applied")
        start, end = float(selected[0].start_time), float(selected[-1].end_time)
        warnings = []
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end > duration + 0.02 or end <= start:
            warnings.append("时间范围异常，请试听后手工修正")
        if any(float(item.end_time) <= float(item.start_time) for item in selected):
            warnings.append("包含零长度字词，对齐可能不可靠")
        if len(expected) / max(0.01, end - start) > 12:
            warnings.append("语速超过 12 字/秒，请核对时间")
        output.append(dict(
            key=line["key"], dialogueId=line.get("dialogueId"), text=line["text"],
            start=origin + crop_start + start, end=origin + crop_start + end,
            audioStart=crop_start + start, audioEnd=crop_start + end, warnings=warnings,
        ))
    if cursor != len(items):
        raise ValueError("Alignment returned unmatched words")
    return output


def run(request):
    started = time.perf_counter()
    emit("progress", stage="加载本地语音运行环境")
    import torch
    import soundfile as sf
    from qwen_asr import Qwen3ASRModel, Qwen3ForcedAligner
    torch.set_num_threads(min(8, os.cpu_count() or 4))
    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if device.startswith("cuda") else torch.float32
    if device.startswith("cuda") and torch.cuda.mem_get_info()[0] < 2.5 * 1024**3:
        raise RuntimeError("可用显存不足 2.5GB，请先释放其他模型或应用的显存")
    start, end = request["cropStart"], request["cropEnd"]
    if start < 0 or not 0 < end - start <= 300:
        raise ValueError("Audio crop must be between 0 and 300 seconds")
    with sf.SoundFile(request["path"]) as source:
        if end > len(source) / source.samplerate + 0.001:
            raise ValueError("Audio crop exceeds media duration")
        sr = source.samplerate
        source.seek(round(start * sr))
        audio = source.read(round((end - start) * sr), dtype="float32", always_2d=True).mean(axis=1)
    if not len(audio) or float(abs(audio).max()) < 0.0001:
        raise ValueError("所选音频范围为空或静音")
    model_root = os.path.join(request["root"], "models")
    lines = request["lines"]
    if request["mode"] == "asr":
        emit("progress", stage="加载 Qwen3-ASR-0.6B")
        model = Qwen3ASRModel.from_pretrained(
            os.path.join(model_root, "Qwen3-ASR-0.6B"), dtype=dtype, device_map=device,
            attn_implementation="sdpa", max_inference_batch_size=1, max_new_tokens=4096,
            local_files_only=True,
        )
        emit("progress", stage="识别中文语音")
        result = model.transcribe(audio=(audio, sr), language="Chinese")[0]
        text = result.text.strip()
        if not normalize(text):
            raise ValueError("未识别到有效台词")
        del model
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        pieces = re.findall(r"[^。！？!?；;\n]+[。！？!?；;]?", text)
        chunks = []
        for piece in pieces:
            # Keep generated drafts short; a person still approves the DialogueID mapping.
            chunks.extend(piece[i:i + 36] for i in range(0, len(piece), 36) if normalize(piece[i:i + 36]))
        lines = [dict(key="asr-" + str(i), text=piece.strip()) for i, piece in enumerate(chunks)]
    if not lines or sum(len(line["text"]) for line in lines) > 12000:
        raise ValueError("台词为空或超出单次 12000 字限制")
    emit("progress", stage="加载 Qwen3-ForcedAligner-0.6B")
    model = Qwen3ForcedAligner.from_pretrained(
        os.path.join(model_root, "Qwen3-ForcedAligner-0.6B"), dtype=dtype, device_map=device,
        attn_implementation="sdpa", local_files_only=True,
    )
    emit("progress", stage="对齐台词与音频时间")
    aligned = model.align(audio=(audio, sr), text=" ".join(line["text"] for line in lines), language="Chinese")[0]
    mapped = group_alignment(lines, list(aligned), request["timelineOrigin"], start, end - start)
    return dict(
        mode=request["mode"],
        model="Qwen3-ForcedAligner-0.6B" if request["mode"] == "align" else "Qwen3-ASR-0.6B + Qwen3-ForcedAligner-0.6B",
        device=device, elapsed=round(time.perf_counter() - started, 2), lines=mapped,
        warnings=["模型未提供可信度分数；强制对齐不证明台词与音频一致，须试听审核。"],
    )


if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.read())
        # Third-party libraries may print to stdout; reserve stdout for our protocol.
        protocol_out = sys.stdout
        def emit(kind, **data):
            print(json.dumps(dict(type=kind, **data), ensure_ascii=True), file=protocol_out, flush=True)
        with contextlib.redirect_stdout(sys.stderr):
            result = run(request)
        emit("result", result=result)
    except Exception as error:
        emit("error", error=str(error))
        sys.exit(1)
