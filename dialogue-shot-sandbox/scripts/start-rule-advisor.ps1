param(
  [string]$Model = "qwen3-vl:4b",
  [string]$HostAddress = "127.0.0.1:11434"
)

$ErrorActionPreference = "Stop"

$ollama = Get-Command "ollama" -ErrorAction SilentlyContinue
$ollamaPath = if ($ollama) {
  $ollama.Source
} else {
  Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
}
if (-not (Test-Path $ollamaPath)) {
  throw "Ollama is not available in PATH. Install it separately before starting the rule advisor."
}

$env:OLLAMA_HOST = $HostAddress
$modelInfo = & $ollamaPath show $Model 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Model '$Model' is not installed. Run 'ollama pull $Model' explicitly, then retry."
}

$statusUrl = "http://${HostAddress}/api/tags"
try {
  Invoke-RestMethod -Uri $statusUrl -TimeoutSec 2 | Out-Null
  Write-Host "Ollama is already serving at http://${HostAddress}/v1"
  Write-Host "Rule advisor model: $Model"
  exit 0
} catch {
  Write-Host "Starting Ollama at http://${HostAddress}/v1"
  Write-Host "Rule advisor model: $Model"
}

& $ollamaPath serve
exit $LASTEXITCODE
