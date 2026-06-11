$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root "denetim_app"
$brandDir = Join-Path $app "assets\brand"
$imageDir = Join-Path $app "assets\images"
$webDir = Join-Path $app "web"
$webIconsDir = Join-Path $webDir "icons"
$iosIconDir = Join-Path $app "ios\Runner\Assets.xcassets\AppIcon.appiconset"

@($brandDir, $imageDir, $webIconsDir, $iosIconDir) | ForEach-Object {
    New-Item -ItemType Directory -Force -Path $_ | Out-Null
}

$officialLogoSvg = Join-Path $brandDir "metro_istanbul_official.svg"
if (!(Test-Path $officialLogoSvg)) {
    throw "Missing official logo SVG: $officialLogoSvg"
}

$blue1 = "#001e61"
$blue2 = "#021d49"
$red1 = "#b2292e"
$red2 = "#d7282f"
$white = "#ffffff"
$ink = "#111827"
$muted = "#667085"

function Save-Svg($name, $svg) {
    [System.IO.File]::WriteAllText((Join-Path $brandDir $name), $svg, [System.Text.UTF8Encoding]::new($false))
}

$officialSvg = [System.IO.File]::ReadAllText($officialLogoSvg)
Copy-Item $officialLogoSvg (Join-Path $brandDir "logo_horizontal.svg") -Force

$officialIconSvg = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 47.74 60.07" role="img" aria-label="Metro İstanbul official icon">
  <polygon fill="$blue1" points="23.87 13.89 0 0.4 0 27.31 10.13 33.01 10.13 16.15 23.86 23.77 37.61 16.15 37.61 33.01 47.74 27.31 47.74 0.4 23.87 13.89"/>
  <polygon fill="$blue2" points="23.87 13.89 23.87 23.77 37.61 16.15 37.61 33.01 47.74 27.31 47.74 0.4 23.87 13.89"/>
  <polygon fill="$red1" points="47.74 34.83 23.87 48.12 0 34.83 0 46.45 23.86 60.07 23.86 60.07 23.87 60.07 23.87 60.07 23.87 60.07 47.74 46.45 47.74 34.83"/>
  <polygon fill="$red2" points="23.87 48.12 23.87 48.12 0 34.83 0 46.45 23.86 60.07 23.86 60.07 23.87 60.07 23.87 48.12"/>
</svg>
"@
Save-Svg "metro_istanbul_icon_official.svg" $officialIconSvg
Save-Svg "logo_small.svg" $officialIconSvg
Save-Svg "app_icon.svg" @"
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="Metro İstanbul app icon">
  <rect width="1024" height="1024" rx="220" fill="$white"/>
  <g transform="translate(242 132) scale(11.3)">$($officialIconSvg -replace '<\?xml[^>]*>','' -replace '<svg[^>]*>','' -replace '</svg>','')</g>
</svg>
"@
Save-Svg "app_icon_alt.svg" @"
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="Metro İstanbul alternate app icon">
  <rect width="1024" height="1024" rx="220" fill="$blue1"/>
  <circle cx="512" cy="512" r="382" fill="$white"/>
  <g transform="translate(272 154) scale(10.1)">$($officialIconSvg -replace '<\?xml[^>]*>','' -replace '<svg[^>]*>','' -replace '</svg>','')</g>
</svg>
"@
Save-Svg "favicon.svg" (Get-Content (Join-Path $brandDir "app_icon.svg") -Raw)
Save-Svg "logo_mono.svg" @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 47.74 60.07" role="img" aria-label="Metro İstanbul one color logo">
  <polygon fill="$blue1" points="23.87 13.89 0 0.4 0 27.31 10.13 33.01 10.13 16.15 23.86 23.77 37.61 16.15 37.61 33.01 47.74 27.31 47.74 0.4 23.87 13.89"/>
  <polygon fill="$blue1" points="47.74 34.83 23.87 48.12 0 34.83 0 46.45 23.86 60.07 23.87 60.07 47.74 46.45 47.74 34.83"/>
</svg>
"@
Save-Svg "logo_black_white.svg" @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 47.74 60.07" role="img" aria-label="Metro İstanbul black white logo">
  <polygon fill="$ink" points="23.87 13.89 0 0.4 0 27.31 10.13 33.01 10.13 16.15 23.86 23.77 37.61 16.15 37.61 33.01 47.74 27.31 47.74 0.4 23.87 13.89"/>
  <polygon fill="$ink" points="47.74 34.83 23.87 48.12 0 34.83 0 46.45 23.86 60.07 23.87 60.07 47.74 46.45 47.74 34.83"/>
</svg>
"@
Save-Svg "logo_badge.svg" @"
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900" role="img" aria-label="Metro İstanbul badge logo">
  <rect width="900" height="900" fill="none"/>
  <circle cx="450" cy="450" r="380" fill="$white"/>
  <circle cx="450" cy="450" r="342" fill="none" stroke="$blue1" stroke-width="16"/>
  <g transform="translate(236 96) scale(9.0)">$($officialIconSvg -replace '<svg[^>]*>','' -replace '</svg>','')</g>
  <text x="450" y="780" fill="$blue1" font-family="Arial, sans-serif" font-size="42" font-weight="900" text-anchor="middle" letter-spacing="4">DENETIM</text>
</svg>
"@
Save-Svg "logo_vertical.svg" @"
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="980" viewBox="0 0 900 980" role="img" aria-label="Metro İstanbul vertical audit logo">
  <rect width="900" height="980" fill="none"/>
  <g transform="translate(244 70) scale(8.65)">$($officialIconSvg -replace '<svg[^>]*>','' -replace '</svg>','')</g>
  <text x="450" y="690" fill="$blue1" font-family="Arial, sans-serif" font-size="76" font-weight="900" text-anchor="middle" letter-spacing="1">METRO İSTANBUL</text>
  <rect x="240" y="734" width="420" height="8" rx="4" fill="$red2"/>
  <text x="450" y="805" fill="$blue2" font-family="Arial, sans-serif" font-size="32" font-weight="800" text-anchor="middle" letter-spacing="4">KURUMSAL DENETIM</text>
  <text x="450" y="855" fill="$muted" font-family="Arial, sans-serif" font-size="28" font-weight="700" text-anchor="middle" letter-spacing="4">PLATFORMU</text>
</svg>
"@
Save-Svg "splash_logo.svg" @"
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="620" viewBox="0 0 1200 620" role="img" aria-label="Metro İstanbul splash logo">
  <rect width="1200" height="620" fill="none"/>
  <g transform="translate(460 40) scale(5.85)">$($officialIconSvg -replace '<svg[^>]*>','' -replace '</svg>','')</g>
  <text x="600" y="450" fill="$white" font-family="Arial, sans-serif" font-size="72" font-weight="900" text-anchor="middle" letter-spacing="2">METRO İSTANBUL</text>
  <rect x="390" y="495" width="420" height="8" rx="4" fill="$red2"/>
  <text x="600" y="558" fill="$white" opacity=".86" font-family="Arial, sans-serif" font-size="30" font-weight="800" text-anchor="middle" letter-spacing="5">DENETIM SISTEMI</text>
</svg>
"@

function New-Bitmap([int]$w, [int]$h) {
    $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $bmp.SetResolution(144, 144)
    return $bmp
}
function Brush($hex) { New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($hex)) }
function Pen($hex, [float]$width) {
    $p = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml($hex)), $width
    $p.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $p.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    return $p
}
function Add-RoundedRect($path, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $path.AddArc($x,$y,$r*2,$r*2,180,90)
    $path.AddArc($x+$w-$r*2,$y,$r*2,$r*2,270,90)
    $path.AddArc($x+$w-$r*2,$y+$h-$r*2,$r*2,$r*2,0,90)
    $path.AddArc($x,$y+$h-$r*2,$r*2,$r*2,90,90)
    $path.CloseFigure()
}
function Points($coords, [float]$x, [float]$y, [float]$s) {
    $pts = @()
    for ($i=0; $i -lt $coords.Length; $i+=2) {
        $pts += [System.Drawing.PointF]::new($x + $coords[$i]*$s, $y + $coords[$i+1]*$s)
    }
    return $pts
}
function Draw-OfficialIcon($g, [float]$x, [float]$y, [float]$s, [string]$mode = "color") {
    $c1 = if ($mode -eq "bw") { $ink } elseif ($mode -eq "mono") { $blue1 } else { $blue1 }
    $c2 = if ($mode -eq "bw") { $ink } elseif ($mode -eq "mono") { $blue1 } else { $blue2 }
    $c3 = if ($mode -eq "bw") { $ink } elseif ($mode -eq "mono") { $blue1 } else { $red1 }
    $c4 = if ($mode -eq "bw") { $ink } elseif ($mode -eq "mono") { $blue1 } else { $red2 }
    $g.FillPolygon((Brush $c1), (Points @(23.87,13.89,0,0.4,0,27.31,10.13,33.01,10.13,16.15,23.86,23.77,37.61,16.15,37.61,33.01,47.74,27.31,47.74,0.4) $x $y $s))
    $g.FillPolygon((Brush $c2), (Points @(23.87,13.89,23.87,23.77,37.61,16.15,37.61,33.01,47.74,27.31,47.74,0.4) $x $y $s))
    $g.FillPolygon((Brush $c3), (Points @(47.74,34.83,23.87,48.12,0,34.83,0,46.45,23.86,60.07,23.87,60.07,47.74,46.45) $x $y $s))
    $g.FillPolygon((Brush $c4), (Points @(23.87,48.12,0,34.83,0,46.45,23.86,60.07,23.87,60.07) $x $y $s))
}
function Save-Png($path, [int]$w, [int]$h, [scriptblock]$draw) {
    $bmp = New-Bitmap $w $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    & $draw $g $w $h
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}
function Draw-AppIcon($g, $w, $h) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    Add-RoundedRect $path 0 0 $w $h ($w*.22)
    $g.FillPath((Brush $white), $path)
    $s = [Math]::Min($w*.54/47.74, $h*.70/60.07)
    Draw-OfficialIcon $g (($w-47.74*$s)/2) (($h-60.07*$s)/2) $s "color"
}
function Draw-AppIconAlt($g, $w, $h) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    Add-RoundedRect $path 0 0 $w $h ($w*.22)
    $g.FillPath((Brush $blue1), $path)
    $g.FillEllipse((Brush $white), $w*.13, $h*.13, $w*.74, $h*.74)
    $s = [Math]::Min($w*.45/47.74, $h*.58/60.07)
    Draw-OfficialIcon $g (($w-47.74*$s)/2) (($h-60.07*$s)/2) $s "color"
}
function Draw-Symbol($g, $w, $h) {
    $s = [Math]::Min($w*.68/47.74, $h*.80/60.07)
    Draw-OfficialIcon $g (($w-47.74*$s)/2) (($h-60.07*$s)/2) $s "color"
}
function Draw-Mono($g, $w, $h) {
    $s = [Math]::Min($w*.68/47.74, $h*.80/60.07)
    Draw-OfficialIcon $g (($w-47.74*$s)/2) (($h-60.07*$s)/2) $s "mono"
}
function Draw-BW($g, $w, $h) {
    $s = [Math]::Min($w*.68/47.74, $h*.80/60.07)
    Draw-OfficialIcon $g (($w-47.74*$s)/2) (($h-60.07*$s)/2) $s "bw"
}
function Draw-Horizontal($g, $w, $h) {
    $s = $h*.72/60.07
    Draw-OfficialIcon $g ($w*.04) ($h*.14) $s "color"
    $tx = $w*.29
    $font1 = New-Object System.Drawing.Font "Arial", ($h*.18), ([System.Drawing.FontStyle]::Bold)
    $font2 = New-Object System.Drawing.Font "Arial", ($h*.08), ([System.Drawing.FontStyle]::Bold)
    $font3 = New-Object System.Drawing.Font "Arial", ($h*.055), ([System.Drawing.FontStyle]::Regular)
    $g.DrawString("METRO İSTANBUL", $font1, (Brush $blue1), $tx, $h*.20)
    $g.FillRectangle((Brush $red2), $tx, $h*.46, $w*.39, [Math]::Max(5,$h*.018))
    $g.DrawString("DENETIM SISTEMI", $font2, (Brush $blue2), $tx, $h*.56)
    $g.DrawString("Audit  Governance  Operations", $font3, (Brush $muted), $tx, $h*.75)
}
function Draw-Vertical($g, $w, $h) {
    $s = [Math]::Min($w*.42/47.74, $h*.48/60.07)
    Draw-OfficialIcon $g (($w-47.74*$s)/2) ($h*.06) $s "color"
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $font1 = New-Object System.Drawing.Font "Arial", ($w*.075), ([System.Drawing.FontStyle]::Bold)
    $font2 = New-Object System.Drawing.Font "Arial", ($w*.035), ([System.Drawing.FontStyle]::Bold)
    $g.DrawString("METRO İSTANBUL", $font1, (Brush $blue1), [System.Drawing.RectangleF]::new(0,$h*.66,$w,$h*.08), $sf)
    $g.FillRectangle((Brush $red2), $w*.27, $h*.735, $w*.46, [Math]::Max(5,$h*.008))
    $g.DrawString("DENETIM SISTEMI", $font2, (Brush $blue2), [System.Drawing.RectangleF]::new(0,$h*.79,$w,$h*.07), $sf)
}
function Draw-Badge($g, $w, $h) {
    $d = [Math]::Min($w,$h)*.86
    $x = ($w-$d)/2; $y = ($h-$d)/2
    $g.FillEllipse((Brush $white), $x, $y, $d, $d)
    $g.DrawEllipse((Pen $blue1 ($d*.018)), $x+$d*.05, $y+$d*.05, $d*.90, $d*.90)
    $s = [Math]::Min($w*.42/47.74, $h*.52/60.07)
    Draw-OfficialIcon $g (($w-47.74*$s)/2) ($h*.16) $s "color"
    $font = New-Object System.Drawing.Font "Arial", ($w*.045), ([System.Drawing.FontStyle]::Bold)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString("DENETIM", $font, (Brush $blue1), [System.Drawing.RectangleF]::new(0,$h*.78,$w,$h*.08), $sf)
}
function Draw-Splash($g, $w, $h) {
    $s = [Math]::Min($w*.18/47.74, $h*.36/60.07)
    Draw-OfficialIcon $g (($w-47.74*$s)/2) ($h*.08) $s "color"
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $font1 = New-Object System.Drawing.Font "Arial", ($h*.11), ([System.Drawing.FontStyle]::Bold)
    $font2 = New-Object System.Drawing.Font "Arial", ($h*.048), ([System.Drawing.FontStyle]::Bold)
    $g.DrawString("METRO İSTANBUL", $font1, (Brush $white), [System.Drawing.RectangleF]::new(0,$h*.58,$w,$h*.12), $sf)
    $g.FillRectangle((Brush $red2), $w*.33, $h*.75, $w*.34, [Math]::Max(5,$h*.012))
    $g.DrawString("DENETIM SISTEMI", $font2, (Brush $white), [System.Drawing.RectangleF]::new(0,$h*.81,$w,$h*.08), $sf)
}

Save-Png (Join-Path $brandDir "app_icon.png") 2048 2048 ${function:Draw-AppIcon}
Save-Png (Join-Path $brandDir "app_icon_alt.png") 2048 2048 ${function:Draw-AppIconAlt}
Save-Png (Join-Path $brandDir "logo_horizontal.png") 2400 600 ${function:Draw-Horizontal}
Save-Png (Join-Path $brandDir "logo_vertical.png") 1600 1800 ${function:Draw-Vertical}
Save-Png (Join-Path $brandDir "logo_small.png") 1024 1024 ${function:Draw-Symbol}
Save-Png (Join-Path $brandDir "logo_badge.png") 1600 1600 ${function:Draw-Badge}
Save-Png (Join-Path $brandDir "splash_logo.png") 1800 930 ${function:Draw-Splash}
Save-Png (Join-Path $brandDir "logo_black_white.png") 1024 1024 ${function:Draw-BW}
Save-Png (Join-Path $brandDir "logo_mono.png") 1024 1024 ${function:Draw-Mono}
Save-Png (Join-Path $brandDir "favicon.png") 512 512 ${function:Draw-AppIcon}

Copy-Item (Join-Path $brandDir "logo_small.png") (Join-Path $imageDir "app_logo.png") -Force
Copy-Item (Join-Path $brandDir "logo_vertical.png") (Join-Path $imageDir "brand_vertical.png") -Force
Copy-Item (Join-Path $brandDir "logo_horizontal.png") (Join-Path $imageDir "brand_horizontal.png") -Force
Copy-Item (Join-Path $brandDir "logo_small.png") (Join-Path $imageDir "brand_small.png") -Force
Copy-Item (Join-Path $brandDir "logo_badge.png") (Join-Path $imageDir "brand_badge.png") -Force
Copy-Item (Join-Path $brandDir "splash_logo.png") (Join-Path $imageDir "splash_logo.png") -Force
Copy-Item (Join-Path $brandDir "logo_mono.png") (Join-Path $imageDir "brand_mono.png") -Force
Copy-Item (Join-Path $brandDir "logo_black_white.png") (Join-Path $imageDir "brand_black_white.png") -Force

Copy-Item (Join-Path $brandDir "favicon.png") (Join-Path $webDir "favicon.png") -Force
Save-Png (Join-Path $webIconsDir "Icon-192.png") 192 192 ${function:Draw-AppIcon}
Save-Png (Join-Path $webIconsDir "Icon-512.png") 512 512 ${function:Draw-AppIcon}
Save-Png (Join-Path $webIconsDir "Icon-maskable-192.png") 192 192 ${function:Draw-AppIcon}
Save-Png (Join-Path $webIconsDir "Icon-maskable-512.png") 512 512 ${function:Draw-AppIcon}

$androidSizes = @{
    "mipmap-mdpi" = 48
    "mipmap-hdpi" = 72
    "mipmap-xhdpi" = 96
    "mipmap-xxhdpi" = 144
    "mipmap-xxxhdpi" = 192
}
foreach ($entry in $androidSizes.GetEnumerator()) {
    $dir = Join-Path $app "android\app\src\main\res\$($entry.Key)"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Save-Png (Join-Path $dir "ic_launcher.png") $entry.Value $entry.Value ${function:Draw-AppIcon}
    Save-Png (Join-Path $dir "launch_image.png") ($entry.Value * 2) ($entry.Value * 2) ${function:Draw-Symbol}
}

$iosSizes = @{
    "Icon-App-20x20@1x.png" = 20; "Icon-App-20x20@2x.png" = 40; "Icon-App-20x20@3x.png" = 60
    "Icon-App-29x29@1x.png" = 29; "Icon-App-29x29@2x.png" = 58; "Icon-App-29x29@3x.png" = 87
    "Icon-App-40x40@1x.png" = 40; "Icon-App-40x40@2x.png" = 80; "Icon-App-40x40@3x.png" = 120
    "Icon-App-60x60@2x.png" = 120; "Icon-App-60x60@3x.png" = 180
    "Icon-App-76x76@1x.png" = 76; "Icon-App-76x76@2x.png" = 152
    "Icon-App-83.5x83.5@2x.png" = 167
    "Icon-App-1024x1024@1x.png" = 1024
}
foreach ($entry in $iosSizes.GetEnumerator()) {
    Save-Png (Join-Path $iosIconDir $entry.Key) $entry.Value $entry.Value ${function:Draw-AppIcon}
}

Write-Host "Official Metro Istanbul brand assets generated in $brandDir"
