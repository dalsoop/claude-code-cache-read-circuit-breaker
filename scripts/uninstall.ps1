$ErrorActionPreference = "Stop"

$AppName = if ($env:APP_NAME) { $env:APP_NAME } else { "save-my-claude-token" }
$InstallDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { Join-Path $HOME ".local\bin" }
$ClaudeDir = if ($env:CLAUDE_DIR) { $env:CLAUDE_DIR } else { Join-Path $HOME ".claude" }
$HookLast = if ($env:HOOK_LAST) { $env:HOOK_LAST } else { "1h" }
$HookMaxCacheRead = if ($env:HOOK_MAX_CACHE_READ) { $env:HOOK_MAX_CACHE_READ } else { "1000000" }
$HookMaxEvents = if ($env:HOOK_MAX_EVENTS) { $env:HOOK_MAX_EVENTS } else { "1000" }

function Remove-Hook {
    $settingsPath = Join-Path $ClaudeDir "settings.json"
    if (-not (Test-Path $settingsPath)) {
        return
    }

    $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
    $hookCommand = "$AppName hook claude-guard --last $HookLast --max-cache-read $HookMaxCacheRead --max-events $HookMaxEvents"

    if ($settings.hooks -and $settings.hooks.UserPromptSubmit) {
        $newGroups = @()
        foreach ($group in $settings.hooks.UserPromptSubmit) {
            $newHooks = @()
            foreach ($hook in $group.hooks) {
                if (-not ($hook.type -eq "command" -and $hook.command -eq $hookCommand)) {
                    $newHooks += $hook
                }
            }
            if ($newHooks.Count -gt 0) {
                $newGroups += [pscustomobject]@{ hooks = $newHooks }
            }
        }

        if ($newGroups.Count -gt 0) {
            $settings.hooks.UserPromptSubmit = $newGroups
        } else {
            $settings.hooks.PSObject.Properties.Remove("UserPromptSubmit")
        }

        if ($settings.hooks.PSObject.Properties.Count -eq 0) {
            $settings.PSObject.Properties.Remove("hooks")
        }

        $settings | ConvertTo-Json -Depth 20 | Set-Content $settingsPath
        Write-Host "Removed Claude hook from $settingsPath"
    }
}

$targets = @(
    (Join-Path $InstallDir $AppName),
    (Join-Path $InstallDir "$AppName.exe")
)

$removed = $false
foreach ($target in $targets) {
    if (Test-Path $target) {
        Remove-Item -Force $target
        Write-Host "Removed $target"
        $removed = $true
    }
}

if (-not $removed) {
    Write-Host "Nothing to remove in $InstallDir"
}

Remove-Hook
