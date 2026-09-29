[CmdletBinding()]
param(
    [ValidateSet('Import', 'ImportPipe', 'Status', 'Prepare', 'SelfTest')]
    [string]$Action = 'Import',
    [string]$VaultPath = (Join-Path $env:LOCALAPPDATA 'ArtSoul\testnet-wallets'),
    [string]$PolicyPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$stage = 'initialization'
if (!$PolicyPath) { $PolicyPath = Join-Path $PSScriptRoot '..\docs\private\phase-a-wallet-policy.json' }

function Set-PrivateDirectoryAcl([string]$Path) {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    # Change the DACL only. Reassigning an existing directory's owner needlessly
    # requires SeRestorePrivilege in some Windows child-process tokens.
    $acl = Get-Acl -LiteralPath $Path
    $allowedSids = @($identity.Value, 'S-1-5-18')
    $rules = @($acl.Access)
    $safeRules = @($rules | Where-Object {
        $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -in $allowedSids -and
        $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
        $_.FileSystemRights -eq [Security.AccessControl.FileSystemRights]::FullControl -and
        $_.InheritanceFlags -eq [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' -and
        !$_.IsInherited
    })
    if ($acl.AreAccessRulesProtected -and $rules.Count -eq 2 -and $safeRules.Count -eq 2 -and
        @($rules | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } | Select-Object -Unique).Count -eq 2) { return }
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($rule) }
    $inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $propagation = [System.Security.AccessControl.PropagationFlags]::None
    $allow = [System.Security.AccessControl.AccessControlType]::Allow
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', $inheritance, $propagation, $allow)))
    $system = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($system, 'FullControl', $inheritance, $propagation, $allow)))
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Initialize-Vault {
    $script:VaultPath = [System.IO.Path]::GetFullPath($VaultPath)
    if (Test-Path -LiteralPath $VaultPath) {
        $item = Get-Item -LiteralPath $VaultPath -Force
        if (!$item.PSIsContainer -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            throw 'INVALID_VAULT_DIRECTORY'
        }
    } else {
        New-Item -ItemType Directory -Path $VaultPath -Force | Out-Null
    }
    Set-PrivateDirectoryAcl $VaultPath
}

function Invoke-ImportValidation([System.Security.SecureString]$Secret, [string]$ExpectedAddress, $Policy) {
    $pointer = [IntPtr]::Zero
    $child = $null
    $plain = $null
    $payload = $null
    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        $payload = @{ privateKey = $plain; expectedAddress = $ExpectedAddress; policy = $Policy } | ConvertTo-Json -Depth 5 -Compress
        $info = New-Object System.Diagnostics.ProcessStartInfo
        $info.FileName = (Get-Command node.exe -ErrorAction Stop).Source
        $helper = Join-Path $PSScriptRoot 'testnet-wallets.mjs'
        $info.Arguments = '"' + $helper + '" validate-import'
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardInput = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $info.EnvironmentVariables.Remove('NODE_OPTIONS')
        $info.EnvironmentVariables.Remove('NODE_PATH')
        $info.EnvironmentVariables.Remove('NODE_V8_COVERAGE')
        $info.EnvironmentVariables.Remove('NODE_DEBUG')
        $child = New-Object System.Diagnostics.Process
        $child.StartInfo = $info
        if (!$child.Start()) { throw 'VALIDATION_START_FAILED' }
        $outputTask = $child.StandardOutput.ReadToEndAsync()
        $errorTask = $child.StandardError.ReadToEndAsync()
        $child.StandardInput.Write($payload)
        $child.StandardInput.Close()
        if (!$child.WaitForExit(15000)) {
            $child.Kill()
            throw 'VALIDATION_TIMEOUT'
        }
        $publicResult = $outputTask.GetAwaiter().GetResult()
        $null = $errorTask.GetAwaiter().GetResult()
        if ($child.ExitCode -ne 0) { throw 'KEY_ADDRESS_OR_POLICY_REJECTED' }
        $result = $publicResult | ConvertFrom-Json
        if ($result.chainId -ne 84532 -or $result.address -notmatch '^0x[a-fA-F0-9]{40}$') {
            throw 'INVALID_PUBLIC_RESULT'
        }
        return $result
    } finally {
        if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
        $plain = $null
        $payload = $null
        if ($child) { $child.Dispose() }
    }
}

function Read-PublicRecords($Policy) {
    $records = @()
    foreach ($role in @('creator', 'collector', 'buyer')) {
        $path = Join-Path $VaultPath ($role + '.json')
        if (Test-Path -LiteralPath $path) {
            $item = Get-Item -LiteralPath $path -Force
            if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'INVALID_STORED_PATH' }
            $record = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
            if ($record.version -ne 1 -or $record.chainId -ne 84532 -or $record.role -ne $role -or
                $record.address -notmatch '^0x[a-fA-F0-9]{40}$' -or
                $record.protectedPrivateKey -notmatch '^[a-fA-F0-9]{100,}$') { throw 'INVALID_STORED_RECORD' }
            if (@($Policy.excludedAddresses) -contains $record.address) { throw 'PROTECTED_ADDRESS' }
            if (@($records | Where-Object { $_.address -eq $record.address }).Count -ne 0) { throw 'DUPLICATE_ROLE_ADDRESS' }
            $records += [PSCustomObject]@{ role = $role; address = $record.address; chainId = 84532 }
        }
    }
    return $records
}

function Save-NewRecord([string]$Destination, $Record) {
    $temporary = Join-Path $VaultPath ('.pending-' + [Guid]::NewGuid().ToString('N') + '.json')
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes(($Record | ConvertTo-Json -Compress))
        $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) }
        finally { $stream.Dispose(); [Array]::Clear($bytes, 0, $bytes.Length) }
        # Same-volume rename is atomic and refuses to overwrite an existing role.
        [IO.File]::Move($temporary, $Destination)
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Import-TestAccount([string]$Role, [string]$ExpectedAddress, [Security.SecureString]$Secret, $Policy) {
    if ($Role -notin @('creator', 'collector', 'buyer')) { throw 'INVALID_ROLE' }
    $public = Invoke-ImportValidation $Secret $ExpectedAddress $Policy
    $records = @(Read-PublicRecords $Policy)
    $destination = Join-Path $VaultPath ($Role + '.json')
    if (Test-Path -LiteralPath $destination) {
        $existing = Get-Content -LiteralPath $destination -Raw | ConvertFrom-Json
        if ($existing.address -ne $public.address) { throw 'EXISTING_ROLE_ADDRESS_MISMATCH' }
        $existingSecret = ConvertTo-SecureString $existing.protectedPrivateKey
        try { $null = Invoke-ImportValidation $existingSecret $existing.address $Policy }
        finally { $existingSecret.Dispose() }
        return
    }
    if (@($records | Where-Object { $_.address -eq $public.address }).Count -ne 0) { throw 'DUPLICATE_ROLE_ADDRESS' }
    $record = [ordered]@{
        version = 1; chainId = 84532; role = $Role; address = $public.address
        createdAt = [DateTime]::UtcNow.ToString('o')
        protectedPrivateKey = (ConvertFrom-SecureString $Secret)
    }
    Save-NewRecord $destination $record
}

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'WINDOWS_REQUIRED' }
    # A Node child may inherit PowerShell 7's module paths while running 5.1.
    # Load this engine's own built-ins, not a module from an inherited search path.
    foreach ($moduleName in @('Microsoft.PowerShell.Security', 'Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Management')) {
        Import-Module ([IO.Path]::Combine($PSHOME, 'Modules', $moduleName, ($moduleName + '.psd1'))) -ErrorAction Stop
    }
    if ($Action -eq 'SelfTest') {
        # Disposable/public vectors only; no network or writes to the user's vault.
        $sample = [Guid]::NewGuid().ToString('N')
        $secure = ConvertTo-SecureString $sample -AsPlainText -Force
        $encrypted = ConvertFrom-SecureString $secure
        $restored = ConvertTo-SecureString $encrypted
        $pointer = [IntPtr]::Zero
        try {
            $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($restored)
            if ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) -cne $sample) { throw 'DPAPI_ROUNDTRIP_FAILED' }
        } finally {
            if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
            $secure.Dispose()
            $restored.Dispose()
        }
        # Public Ethereum test vector: also exercise the hidden child pipe.
        $testKey = ConvertTo-SecureString ('0x' + ('0' * 63) + '1') -AsPlainText -Force
        try {
            $testPolicy = @{ version = 1; chainId = 84532; excludedAddresses = @('0x0000000000000000000000000000000000000000') }
            $public = Invoke-ImportValidation $testKey '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf' $testPolicy
            if ($public.chainId -ne 84532) { throw 'CHILD_PIPE_TEST_FAILED' }
        } finally { $testKey.Dispose() }
        $script:VaultPath = Join-Path ([IO.Path]::GetTempPath()) ('artsoul-custody-test-' + [Guid]::NewGuid().ToString('N'))
        $testRecordPath = Join-Path $VaultPath 'creator.json'
        try {
            Initialize-Vault
            $testRecord = @{ version = 1; chainId = 84532; role = 'creator'; address = $public.address; protectedPrivateKey = $encrypted }
            Save-NewRecord $testRecordPath $testRecord
            $records = @(Read-PublicRecords $testPolicy)
            if ($records.Count -ne 1) { throw 'RECORD_ROUNDTRIP_FAILED' }
            $before = [IO.File]::ReadAllText($testRecordPath)
            $overwritten = $false
            try { Save-NewRecord $testRecordPath $testRecord; $overwritten = $true } catch {}
            if ($overwritten -or [IO.File]::ReadAllText($testRecordPath) -cne $before) { throw 'OVERWRITE_NOT_REJECTED' }
            if (@(Get-ChildItem -LiteralPath $VaultPath -Force).Count -ne 1) { throw 'TEMPORARY_FILE_NOT_CLEANED' }
            [IO.File]::WriteAllText($testRecordPath, '{}')
            $acceptedCorrupt = $false
            try { $null = @(Read-PublicRecords $testPolicy); $acceptedCorrupt = $true } catch {}
            if ($acceptedCorrupt) { throw 'CORRUPT_RECORD_NOT_REJECTED' }
        } finally {
            if (Test-Path -LiteralPath $testRecordPath) { Remove-Item -LiteralPath $testRecordPath -Force }
            if (Test-Path -LiteralPath $VaultPath) { Remove-Item -LiteralPath $VaultPath }
        }
        Write-Output 'DPAPI_SELF_TEST_PASSED'
        exit 0
    }
    $stage = 'policy'
    $policy = Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json
    if ($policy.version -ne 1 -or $policy.chainId -ne 84532 -or @($policy.excludedAddresses).Count -eq 0) {
        throw 'INVALID_TESTNET_POLICY'
    }
    if ($Action -eq 'Status') {
        # Envelope presence is not proof of successful decryption by this user.
        $records = @(Read-PublicRecords $policy)
        @{ version = 1; chainId = 84532; custodyVerified = $false; walletCount = $records.Count; wallets = $records } | ConvertTo-Json -Depth 4
        exit 0
    }
    $stage = 'vault'
    Initialize-Vault
    $null = @(Read-PublicRecords $policy)
    if ($Action -eq 'Prepare') { Write-Output 'TESTNET_VAULT_READY'; exit 0 }
    if ($Action -eq 'ImportPipe') {
        # For an explicitly authorized local parent process only; never pass
        # credentials in arguments or echo this anonymous pipe's contents.
        $stage = 'local-pipe'
        $raw = [Console]::In.ReadToEnd()
        if ($raw.Length -gt 8192) { throw 'INPUT_TOO_LARGE' }
        $incoming = $raw | ConvertFrom-Json
        $raw = $null
        if ($incoming.version -ne 1 -or $incoming.chainId -ne 84532 -or @($incoming.wallets).Count -ne 3) { throw 'INVALID_IMPORT_REQUEST' }
        $roles = @('creator', 'collector', 'buyer')
        for ($i = 0; $i -lt 3; $i++) {
            $account = $incoming.wallets[$i]
            if ($account.role -ne $roles[$i]) { throw 'INVALID_ROLE_ORDER' }
            $secret = ConvertTo-SecureString $account.privateKey -AsPlainText -Force
            try { Import-TestAccount $account.role $account.address $secret $policy }
            finally { $secret.Dispose(); $account.privateKey = $null }
        }
        $incoming = $null
        Write-Output 'TEST_ACCOUNTS_IMPORTED'
        exit 0
    }
    Write-Host 'ArtSoul: import THREE existing TEST wallets. No transaction will be signed.'
    Write-Host 'Use individual account private keys, NEVER seed phrases or a new mainnet founder key.'
    Write-Host 'Keys are entered invisibly and encrypted for this Windows user. Existing entries are not overwritten.'
    foreach ($role in @('creator', 'collector', 'buyer')) {
        $destination = Join-Path $VaultPath ($role + '.json')
        if (Test-Path -LiteralPath $destination) {
            # Recheck that an existing encrypted record remains usable and matches its address.
            $stored = Get-Content -LiteralPath $destination -Raw | ConvertFrom-Json
            $storedSecret = ConvertTo-SecureString $stored.protectedPrivateKey
            try { $null = Invoke-ImportValidation $storedSecret $stored.address $policy }
            finally { $storedSecret.Dispose() }
            Write-Host ($role + ': existing entry verified and preserved.')
            continue
        }
        $stage = 'public-address'
        $expected = (Read-Host ($role + ' - public 0x address')).Trim()
        if ($expected -notmatch '^0x[a-fA-F0-9]{40}$') { throw 'INVALID_EXPECTED_ADDRESS' }
        if (@($policy.excludedAddresses) -contains $expected) { throw 'PROTECTED_ADDRESS' }
        $records = @(Read-PublicRecords $policy)
        if (@($records | Where-Object { $_.address -eq $expected }).Count -ne 0) { throw 'DUPLICATE_ROLE_ADDRESS' }
        $stage = 'hidden-key'
        $secret = Read-Host ($role + ' - TEST account private key (hidden)') -AsSecureString
        try {
            $stage = 'key-validation'
            $result = Invoke-ImportValidation $secret $expected $policy
            $record = [ordered]@{
                version = 1; chainId = 84532; role = $role; address = $result.address
                createdAt = [DateTime]::UtcNow.ToString('o')
                protectedPrivateKey = (ConvertFrom-SecureString $secret)
            }
            $stage = 'encrypted-storage'
            Save-NewRecord $destination $record
            Write-Host ($role + ': saved for address ending ' + $result.address.Substring(38) + '.')
        } finally {
            $secret.Dispose()
        }
    }
    Write-Host 'Import complete. Tell Codex: test wallets imported. Do not paste any keys.'
} catch {
    if ($Action -eq 'SelfTest') {
        # This mode only handles disposable/public test vectors.
        Write-Host ('SELF_TEST_ERROR: ' + $_.Exception.GetType().FullName + ': ' + $_.Exception.Message)
    }
    # Never print exceptions, ErrorRecord, child stderr or partial secret input.
    Write-Host 'Import stopped safely. No transaction was signed. Existing entries remain unchanged.'
    Write-Host ('Stage: ' + $stage + '; error type: ' + $_.Exception.GetType().Name)
    if ($_.Exception.Message -cmatch '^[A-Z_]{3,70}$') { Write-Host ('Code: ' + $_.Exception.Message) }
    Write-Host 'Check the public address, excluded-address policy and test key locally, then retry missing roles.'
    exit 1
}
