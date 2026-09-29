[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$PlanPath,
    [string]$VaultPath = (Join-Path $env:LOCALAPPDATA 'ArtSoul\testnet-wallets')
)
$ErrorActionPreference = 'Stop'
$pointer = [IntPtr]::Zero
$secret = $null
$child = $null
try {
    foreach ($name in @('Microsoft.PowerShell.Security','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Management')) {
        Import-Module ([IO.Path]::Combine($PSHOME,'Modules',$name,($name + '.psd1'))) -ErrorAction Stop
    }
    $plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
    if ($plan.chainId -ne 84532 -or $plan.role -notin @('creator','collector','buyer')) { throw 'INVALID_TEST_PLAN' }
    $record = Get-Content -LiteralPath (Join-Path $VaultPath ($plan.role + '.json')) -Raw | ConvertFrom-Json
    if ($record.chainId -ne 84532 -or $record.address -ne $plan.from) { throw 'WRONG_STORED_ACCOUNT' }
    $secret = ConvertTo-SecureString $record.protectedPrivateKey
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $payload = @{ privateKey=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer); address=$record.address; vaultPath=$VaultPath } | ConvertTo-Json -Compress
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = (Get-Command node.exe).Source
    $runner = Join-Path $PSScriptRoot 'testnet-transaction.mjs'
    $policy = Join-Path $PSScriptRoot '..\docs\private\phase-a-wallet-policy.json'
    $info.Arguments = '"' + $runner + '" "' + [IO.Path]::GetFullPath($PlanPath) + '" "' + [IO.Path]::GetFullPath($policy) + '"'
    $info.UseShellExecute=$false; $info.CreateNoWindow=$true
    $info.RedirectStandardInput=$true; $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
    foreach ($name in @('NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE','NODE_DEBUG')) { $info.EnvironmentVariables.Remove($name) }
    $child = New-Object Diagnostics.Process
    $child.StartInfo=$info
    if (!$child.Start()) { throw 'SIGNER_START_FAILED' }
    $outputTask=$child.StandardOutput.ReadToEndAsync(); $errorTask=$child.StandardError.ReadToEndAsync()
    $inputBytes=[Text.Encoding]::UTF8.GetBytes($payload)
    try {
        $child.StandardInput.BaseStream.Write($inputBytes,0,$inputBytes.Length)
        $child.StandardInput.BaseStream.Close()
    } finally { [Array]::Clear($inputBytes,0,$inputBytes.Length); $payload=$null }
    if (!$child.WaitForExit(180000)) { $child.Kill(); throw 'SIGNER_TIMEOUT_CHECK_JOURNAL' }
    $publicOutput=$outputTask.GetAwaiter().GetResult(); $publicError=$errorTask.GetAwaiter().GetResult()
    if ($child.ExitCode -ne 0) {
        $failure=$publicError | ConvertFrom-Json
        if ($failure.code -cmatch '^[A-Z_]{3,70}$') { Write-Output ('TESTNET_STOPPED: ' + $failure.code) }
        exit 1
    }
    $result=$publicOutput | ConvertFrom-Json
    if ($result.hash -notmatch '^0x[a-fA-F0-9]{64}$') { throw 'INVALID_PUBLIC_RESULT' }
    Write-Output $publicOutput
} catch {
    Write-Output 'TESTNET_STOPPED: LOCAL_RUNNER_ERROR_CHECK_JOURNAL'
    exit 1
} finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($secret) { $secret.Dispose() }
    if ($child) { $child.Dispose() }
}
