param(
  [string]$Root = "$env:LOCALAPPDATA\ShotSandbox\speech-runtime",
  [string]$Python = "python",
  [ValidateSet("modelscope", "huggingface")][string]$Source = "modelscope"
)
$ErrorActionPreference = "Stop"
if (!(Get-Command $Python -ErrorAction SilentlyContinue)) {
  throw "未找到 Python 3。请先安装可用的 Python 3，并确保 python 命令可用。"
}
function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Speech runtime setup failed ($LASTEXITCODE)" }
}
Write-Output "SHOT_SANDBOX_STAGE:正在准备独立 Python 环境"
if (!(Test-Path "$Root\venv\Scripts\python.exe")) {
  Invoke-Checked $Python @("-m", "venv", "$Root\venv")
}
$RuntimePython = "$Root\venv\Scripts\python.exe"
Write-Output "SHOT_SANDBOX_STAGE:正在更新安装工具"
Invoke-Checked $RuntimePython @("-m", "pip", "install", "--upgrade", "pip")
Write-Output "SHOT_SANDBOX_STAGE:正在安装 GPU 推理组件"
Invoke-Checked $RuntimePython @("-m", "pip", "install", "torch==2.6.0", "--index-url", "https://download.pytorch.org/whl/cu124")
Write-Output "SHOT_SANDBOX_STAGE:正在安装语音处理组件"
Invoke-Checked $RuntimePython @("-m", "pip", "install", "qwen-asr==0.0.6", "numpy==1.26.4", "modelscope==1.34.0")
$Download = @'
import os, sys
root, source = sys.argv[1:]
for name in ("Qwen3-ASR-0.6B", "Qwen3-ForcedAligner-0.6B"):
    print("SHOT_SANDBOX_STAGE:正在下载端侧模型 " + name, flush=True)
    target = os.path.join(root, "models", name)
    if source == "modelscope":
        from modelscope import snapshot_download
        snapshot_download("Qwen/" + name, local_dir=target)
    else:
        from huggingface_hub import snapshot_download
        snapshot_download("Qwen/" + name, local_dir=target)
print("Models installed in " + root)
'@
Invoke-Checked $RuntimePython @("-c", $Download, $Root, $Source)
Write-Output "SHOT_SANDBOX_STAGE:正在验证模型与 GPU 环境"
Invoke-Checked $RuntimePython @("-c", "import torch; from qwen_asr import Qwen3ASRModel, Qwen3ForcedAligner; print('CUDA:', torch.cuda.is_available())")
Invoke-Checked $RuntimePython @("-c", "import json,sys,pathlib; pathlib.Path(sys.argv[1], 'ready.json').write_text(json.dumps({'qwen_asr':'0.0.6','torch':'2.6.0','schema':1}), encoding='utf8')", $Root)
Write-Output "SHOT_SANDBOX_STAGE:端侧语音环境已就绪"
