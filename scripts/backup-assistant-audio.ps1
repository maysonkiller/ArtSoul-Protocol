# ArtSoul voice backup — Windows PowerShell 5.1 compatible.
# Offline and read-only with respect to the project. Never copies API keys,
# .env files, ledgers, wallet files or private user content.
param(
    [string]$Destination = (Join-Path $HOME 'ArtSoul-Voice-Backups')
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$audio = Join-Path $repo 'public\audio\assistant\v1'
$phraseBank = Join-Path $repo 'docs\audio\assistant-r2-phrase-bank.json'
$videoBank = Join-Path $repo 'docs\audio\assistant-video-r3-phrase-bank.json'
$audioIndex = Join-Path $repo 'voice-audio-bank-r2.js'
foreach ($required in @($audio, $phraseBank, $videoBank, $audioIndex)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw ("Required voice source missing: " + $required)
    }
}
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$stamp = (Get-Date -Format 'yyyyMMdd_HHmmss')
$zip = Join-Path $Destination ("ArtSoul-Voice-SAFE-BACKUP-" + $stamp + ".zip")
if (Test-Path -LiteralPath $zip) { throw "Backup already exists: $zip" }
$stage = Join-Path ([IO.Path]::GetTempPath()) ('artsoul-voice-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    $audioParent = Join-Path $stage 'public\audio\assistant'
    $docsFolder = Join-Path $stage 'docs\audio'
    New-Item -ItemType Directory -Force -Path $audioParent | Out-Null
    New-Item -ItemType Directory -Force -Path $docsFolder | Out-Null
    Copy-Item -LiteralPath $audio -Destination (Join-Path $audioParent 'v1') -Recurse
    Copy-Item -LiteralPath $phraseBank -Destination (Join-Path $docsFolder 'assistant-r2-phrase-bank.json')
    Copy-Item -LiteralPath $videoBank -Destination (Join-Path $docsFolder 'assistant-video-r3-phrase-bank.json')
    Copy-Item -LiteralPath $audioIndex -Destination (Join-Path $stage 'voice-audio-bank-r2.js')
    # Compress only this explicit allowlist of static public/audio and script data.
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
    $sha = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Output ("BACKUP_FILE=" + $zip)
    Write-Output ("SHA256=" + $sha)
    Write-Output "BACKUP_OK. Verify the ZIP before modifying or replacing local WAV files."
} finally {
    if (Test-Path -LiteralPath $stage) {
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
}
