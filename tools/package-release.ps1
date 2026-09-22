$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent $PSScriptRoot

# Explicit allowlist: never copy source artwork or development folders.
$releaseFiles = @(
  'index.html', 'style.css',
  'js/app.js', 'js/gameEngine.js', 'js/physics.js',
  'js/uiManager.js', 'js/saveSystem.js', 'js/audio.js',
  'assets/squad.glb', 'assets/squad.json', 'assets/ball.glb',
  'assets/photographer-standing.glb', 'assets/photographer-kneeling.glb',
  'assets/ui/bg/shooting-goal.webp',
  'assets/ui/hud/confidence-frame.png',
  'assets/ui/hud/confidence-fill.png',
  'assets/ui/hud/game-over.png',
  'assets/ui/hud/manager-angry.png',
  'vendor/three/build/three.module.js',
  'vendor/three/examples/jsm/loaders/GLTFLoader.js',
  'vendor/three/examples/jsm/utils/SkeletonUtils.js',
  'vendor/three/examples/jsm/utils/BufferGeometryUtils.js',
  'vendor/three/LICENSE'
)
foreach ($portrait in @('barry', 'lars', 'nico', 'ravi', 'milo', 'felix', 'theo', 'kai')) {
  $releaseFiles += "assets/portraits/$portrait.webp"
}
foreach ($sound in @('tick_001', 'click_001', 'back_001', 'select_001', 'confirmation_001', 'confirmation_002', 'error_001')) {
  $releaseFiles += "assets/audio/ui/$sound.ogg"
}
$releaseFiles += 'assets/audio/ui/License.txt'
foreach ($icon in @('boot', 'charm', 'icebath', 'legday', 'pet', 'poacher', 'star', 'subnet', 'talent', 'target', 'veins')) {
  $releaseFiles += "assets/ui/icons/$icon.webp"
}

# Fail before creating output if a required input is missing.
foreach ($relativePath in $releaseFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relativePath) -PathType Leaf)) {
    throw "Missing release file: $relativePath"
  }
}

$releaseName = 'striker-streak-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$releaseRoot = Join-Path (Join-Path $projectRoot 'dist') $releaseName
$archivePath = "$releaseRoot.zip"
New-Item -ItemType Directory -Path $releaseRoot | Out-Null
[long]$rawBytes = 0
foreach ($relativePath in $releaseFiles) {
  $sourcePath = Join-Path $projectRoot $relativePath
  $targetPath = Join-Path $releaseRoot $relativePath
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetPath) | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $targetPath
  $rawBytes += (Get-Item -LiteralPath $sourcePath).Length
}
# Archive directory contents, not the enclosing folder: index.html is at root.
Compress-Archive -Path (Join-Path $releaseRoot '*') -DestinationPath $archivePath -CompressionLevel Optimal
$zipBytes = (Get-Item -LiteralPath $archivePath).Length
Write-Output "Release folder: $releaseRoot"
Write-Output "Release ZIP: $archivePath"
Write-Output ('Files: {0}; unpacked: {1:N2} MB; ZIP: {2:N2} MB (decimal)' -f $releaseFiles.Count, ($rawBytes / 1000000), ($zipBytes / 1000000))
