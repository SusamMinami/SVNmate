Add-Type -AssemblyName System.Drawing

$size = 512
$bitmap = New-Object System.Drawing.Bitmap($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

function New-RoundedRectangle {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc(
    $X + $Width - $diameter,
    $Y + $Height - $diameter,
    $diameter,
    $diameter,
    0,
    90
  )
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

$background = New-RoundedRectangle 28 28 456 456 72
$graphics.FillPath(
  (New-Object System.Drawing.SolidBrush(
    [System.Drawing.Color]::FromArgb(255, 32, 40, 48)
  )),
  $background
)

$whitePen = New-Object System.Drawing.Pen(
  [System.Drawing.Color]::FromArgb(255, 244, 247, 249),
  26
)
$whitePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$whitePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawRectangle($whitePen, 112, 188, 288, 210)
$graphics.DrawLine($whitePen, 112, 188, 392, 188)
$graphics.DrawLine($whitePen, 128, 114, 388, 72)
$graphics.DrawLine($whitePen, 151, 110, 198, 178)
$graphics.DrawLine($whitePen, 245, 94, 292, 162)
$graphics.DrawLine($whitePen, 339, 79, 384, 142)

$accentBrush = New-Object System.Drawing.SolidBrush(
  [System.Drawing.Color]::FromArgb(255, 47, 150, 232)
)
$graphics.FillEllipse($accentBrush, 202, 238, 108, 108)
$graphics.FillPolygon(
  $accentBrush,
  [System.Drawing.Point[]]@(
    (New-Object System.Drawing.Point(300, 272)),
    (New-Object System.Drawing.Point(360, 238)),
    (New-Object System.Drawing.Point(360, 346)),
    (New-Object System.Drawing.Point(300, 312))
  )
)

New-Item -ItemType Directory -Force build | Out-Null
$bitmap.Save(
  (Join-Path $PWD "build\icon.png"),
  [System.Drawing.Imaging.ImageFormat]::Png
)

$accentBrush.Dispose()
$whitePen.Dispose()
$background.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
