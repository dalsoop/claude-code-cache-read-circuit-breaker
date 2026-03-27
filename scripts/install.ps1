$ErrorActionPreference = "Stop"

$Repo = if ($env:REPO) { $env:REPO } else { "dalsoop/save-my-claude-token" }
$AppName = if ($env:APP_NAME) { $env:APP_NAME } else { "save-my-claude-token" }
$Version = if ($env:VERSION) { $env:VERSION } else { "latest" }
$InstallDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { Join-Path $HOME ".local\bin" }
$ClaudeDir = if ($env:CLAUDE_DIR) { $env:CLAUDE_DIR } else { Join-Path $HOME ".claude" }
$HookLast = if ($env:HOOK_LAST) { $env:HOOK_LAST } else { "1h" }
$HookMaxCacheRead = if ($env:HOOK_MAX_CACHE_READ) { $env:HOOK_MAX_CACHE_READ } else { "1000000" }
$HookMaxEvents = if ($env:HOOK_MAX_EVENTS) { $env:HOOK_MAX_EVENTS } else { "1000" }

function Get-Os {
    if ($IsWindows) { return "windows" }
    if ($IsMacOS) { return "darwin" }
    if ($IsLinux) { return "linux" }
    throw "Unsupported operating system."
}

function Get-Arch {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    switch ($arch) {
        "x64" { return "x86_64" }
        "arm64" { return "aarch64" }
        default { throw "Unsupported architecture: $arch" }
    }
}

function Get-DownloadUrl([string]$Os, [string]$Arch) {
    $base = "https://github.com/$Repo/releases"
    $asset = "${AppName}_${Os}_${Arch}.zip"
    if ($Os -ne "windows") {
        $asset = "${AppName}_${Os}_${Arch}.tar.gz"
    }
    if ($Version -eq "latest") {
        return "$base/latest/download/$asset"
    }
    return "$base/download/$Version/$asset"
}

function Register-Hook {
    New-Item -ItemType Directory -Force -Path $ClaudeDir | Out-Null
    $settingsPath = Join-Path $ClaudeDir "settings.json"
    if (Test-Path $settingsPath) {
        Copy-Item -Force $settingsPath "$settingsPath.bak-save-my-claude-token"
        $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
    } else {
        $settings = [pscustomobject]@{}
    }

    if (-not $settings.hooks) {
        $settings | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{})
    }
    if (-not $settings.hooks.UserPromptSubmit) {
        $settings.hooks | Add-Member -NotePropertyName UserPromptSubmit -NotePropertyValue @()
    }

    $hookCommand = "$AppName hook claude-guard --last $HookLast --max-cache-read $HookMaxCacheRead --max-events $HookMaxEvents"
    $exists = $false
    foreach ($group in $settings.hooks.UserPromptSubmit) {
        foreach ($hook in $group.hooks) {
            if ($hook.type -eq "command" -and $hook.command -eq $hookCommand) {
                $exists = $true
            }
        }
    }

    if (-not $exists) {
        $settings.hooks.UserPromptSubmit += [pscustomobject]@{
            hooks = @(
                [pscustomobject]@{
                    type = "command"
                    command = $hookCommand
                    timeout = 10
                }
            )
        }
    }

    $settings | ConvertTo-Json -Depth 20 | Set-Content $settingsPath
    Write-Host "Registered Claude hook in $settingsPath"
}

$os = Get-Os
$arch = Get-Arch
$url = Get-DownloadUrl -Os $os -Arch $arch

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tmp | Out-Null

try {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    $archive = Join-Path $tmp "archive"
    Write-Host "Downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $archive

    if ($url.EndsWith(".zip")) {
        Expand-Archive -Path $archive -DestinationPath $tmp -Force
    } else {
        tar -xzf $archive -C $tmp
    }

    $binary = Join-Path $tmp $AppName
    if ($os -eq "windows") {
        $binary = Join-Path $tmp "$AppName.exe"
    }
    if (-not (Test-Path $binary)) {
        throw "Archive did not contain $AppName."
    }

    $target = Join-Path $InstallDir $AppName
    if ($os -eq "windows") {
        $target = Join-Path $InstallDir "$AppName.exe"
    }
    Copy-Item -Force $binary $target
    Write-Host "Installed $AppName to $target"
    Write-Host "Add $InstallDir to PATH if it is not already there."

    Register-Hook
}
finally {
    if (Test-Path $tmp) {
        Remove-Item -Recurse -Force $tmp
    }
}
