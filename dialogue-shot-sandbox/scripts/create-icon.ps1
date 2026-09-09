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
    [System.Drawing.Color]::FromArgb(255, 238, 255, 0)
  )),
  $background
)

$inkPen = New-Object System.Drawing.Pen(
  [System.Drawing.Color]::FromArgb(255, 21, 22, 20),
  26
)
$inkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$inkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawRectangle($inkPen, 112, 188, 288, 210)
$graphics.DrawLine($inkPen, 112, 188, 392, 188)
$graphics.DrawLine($inkPen, 128, 114, 388, 72)
$graphics.DrawLine($inkPen, 151, 110, 198, 178)
$graphics.DrawLine($inkPen, 245, 94, 292, 162)
$graphics.DrawLine($inkPen, 339, 79, 384, 142)

$accentBrush = New-Object System.Drawing.SolidBrush(
  [System.Drawing.Color]::FromArgb(255, 0, 181, 194)
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
$inkPen.Dispose()
$background.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
