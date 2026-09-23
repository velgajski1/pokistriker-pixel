$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent $PSScriptRoot

# Explicit allowlist: never copy source artwork or development folders.
$releaseFiles = @(
  'index.html', 'style.css',
  'js/app.js', 'js/gameEngine.js', 'js/physics.js',
  'js/uiManager.js', 'js/saveSystem.js', 'js/audio.js', 'js/blockman.js', 'js/voxel.js', 'js/poki.js', 'js/progress.js',
  'assets/squad.glb', 'assets/squad.json',
  'assets/fonts/pixelify-sans.woff2', 'assets/fonts/press-start-2p.woff2',
  'assets/fonts/OFL-PixelifySans.txt', 'assets/fonts/OFL-PressStart2P.txt',
  'assets/fonts/rubik.woff2', 'assets/fonts/OFL-Rubik.txt',
  'vendor/three/build/three.module.min.js',
  'vendor/three/examples/jsm/loaders/GLTFLoader.js',
  'vendor/three/examples/jsm/utils/SkeletonUtils.js',
  'vendor/three/examples/jsm/utils/BufferGeometryUtils.js',
  'vendor/three/LICENSE'
)

# Fail before creating output if a required input is missing.
foreach ($relativePath in $releaseFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relativePath) -PathType Leaf)) {
    throw "Missing release file: $relativePath"
  }
}

$releaseName = 'block-striker-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
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
# Release builds ship no dev tooling: drop every /* @dev */ ... /* @end-dev */
# block (the Alt+number screen previews) and fail if any of it is left.
$utf8 = New-Object System.Text.UTF8Encoding $false
foreach ($relativePath in $releaseFiles | Where-Object { $_ -like 'js/*.js' }) {
  $targetPath = Join-Path $releaseRoot $relativePath
  $text = [System.IO.File]::ReadAllText($targetPath)
  $text = [regex]::Replace($text, '(?s)/\* @dev \*/.*?/\* @end-dev \*/', '')
  foreach ($leftover in @('@dev', '@end-dev', 'previewScreen', 'devTag')) {
    if ($text.Contains($leftover)) { throw "Dev code left in release ${relativePath}: $leftover" }
  }
  [System.IO.File]::WriteAllText($targetPath, $text, $utf8)
}

# Archive directory contents, not the enclosing folder: index.html is at root.
# Entries are written one by one with forward slashes: Windows PowerShell's
# Compress-Archive stores 'js\app.js', which Linux hosts (Poki) unpack as a flat
# file with a backslash in its name, so every file in a subfolder 404s.
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($archivePath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($relativePath in $releaseFiles) {
    $entryName = $relativePath -replace '\\', '/'
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,
      (Join-Path $releaseRoot $relativePath), $entryName, [System.IO.Compression.CompressionLevel]::Optimal)
  }
} finally {
  $zip.Dispose()
}
$zipBytes = (Get-Item -LiteralPath $archivePath).Length
Write-Output "Release folder: $releaseRoot"
Write-Output "Release ZIP: $archivePath"
Write-Output ('Files: {0}; unpacked: {1:N2} MB; ZIP: {2:N2} MB (decimal)' -f $releaseFiles.Count, ($rawBytes / 1000000), ($zipBytes / 1000000))
