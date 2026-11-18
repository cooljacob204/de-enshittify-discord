<#
de-enshittify discord: installer for the Windows Discord desktop client.

  Install or update (paste into PowerShell):
    irm https://raw.githubusercontent.com/cooljacob204/de-enshittify-discord/main/install.ps1 | iex

  Uninstall:
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/cooljacob204/de-enshittify-discord/main/install.ps1))) -Uninstall

  Options: -Uninstall, -NoRestart (leave Discord running), -Source <folder> (install loader.js,
  preload.js and renderer.js from a local folder instead of downloading them).

It copies three files to %APPDATA%\de-enshittify-discord, adds one marked line at the top of
Discord's startup files to load them, and restarts Discord if it's running (that drops you from
any voice call). It works for Discord, Discord PTB and Discord Canary.
#>
param(
  [switch]$Uninstall,
  [switch]$NoRestart,
  [string]$Source
)

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $raw = 'https://raw.githubusercontent.com/cooljacob204/de-enshittify-discord/main'
  $files = @('loader.js', 'preload.js', 'renderer.js')
  $dest = Join-Path $env:APPDATA 'de-enshittify-discord'
  $statusFile = Join-Path $dest 'status.json'
  $marker = '// de-enshittify-discord-hook'
  $hook = 'try{require(require("path").join(process.env.APPDATA,"de-enshittify-discord","loader.js"))}catch(e){console.error("[de-enshittify-discord] hook failed:",e)} ' + $marker
  $utf8 = New-Object System.Text.UTF8Encoding $false

  $flavours = @(
    [pscustomobject]@{ Name = 'Discord'; Dir = 'Discord'; Exe = 'Discord' }
    [pscustomobject]@{ Name = 'Discord PTB'; Dir = 'DiscordPTB'; Exe = 'DiscordPTB' }
    [pscustomobject]@{ Name = 'Discord Canary'; Dir = 'DiscordCanary'; Exe = 'DiscordCanary' }
  ) | Where-Object { Test-Path (Join-Path $env:LOCALAPPDATA $_.Dir) }

  # Discord's startup files in every installed version: discord_desktop_core\index.js always, and
  # resources\app\index.js when another mod (such as BetterDiscord) has set that up.
  function Get-StartupFiles($flavour) {
    $root = Join-Path $env:LOCALAPPDATA $flavour.Dir
    foreach ($app in Get-ChildItem $root -Directory -Filter 'app-*') {
      $candidates = @(Join-Path $app.FullName 'resources\app\index.js')
      $modules = Join-Path $app.FullName 'modules'
      if (Test-Path $modules) {
        foreach ($core in Get-ChildItem $modules -Directory -Filter 'discord_desktop_core-*') {
          $candidates += Join-Path $core.FullName 'discord_desktop_core\index.js'
        }
      }
      $candidates | Where-Object { Test-Path $_ -PathType Leaf }
    }
  }

  # Adds or removes the hook line; leaves the rest of the file byte-for-byte as it was.
  function Set-Hook($path, [bool]$on) {
    $text = [IO.File]::ReadAllText($path)
    $has = $text.Contains($marker)
    if ($on -and -not $has) {
      [IO.File]::WriteAllText($path, $hook + "`n" + $text, $utf8)
      Write-Host "  hooked $path"
    } elseif (-not $on -and $has) {
      $kept = ($text -split "`n") | Where-Object { -not $_.Contains($marker) }
      [IO.File]::WriteAllText($path, ($kept -join "`n"), $utf8)
      Write-Host "  unhooked $path"
    }
  }

  # Discord only loads the hook when its main process starts (a Ctrl+R reload isn't enough), and
  # closing its window only hides it in the tray, so every process is stopped, then Discord is
  # started the way its shortcut does, which picks the newest installed version.
  function Restart-Discord($flavour) {
    $running = Get-Process -Name $flavour.Exe -ErrorAction SilentlyContinue
    if (-not $running) {
      Write-Host "$($flavour.Name) isn't running; the change applies the next time you start it."
      return $false
    }
    if ($NoRestart) {
      Write-Host "Quit $($flavour.Name) from its tray icon and start it again to apply the change."
      return $false
    }
    Write-Host "Restarting $($flavour.Name)..."
    $running | Stop-Process -Force -ErrorAction SilentlyContinue
    Wait-Process -Name $flavour.Exe -Timeout 20 -ErrorAction SilentlyContinue
    if (Get-Process -Name $flavour.Exe -ErrorAction SilentlyContinue) {
      Write-Host "$($flavour.Name) didn't close. Quit it from its tray icon and start it again." -ForegroundColor Yellow
      return $false
    }
    $updater = Join-Path (Join-Path $env:LOCALAPPDATA $flavour.Dir) 'Update.exe'
    Start-Process -FilePath $updater -ArgumentList '--processStart', "$($flavour.Exe).exe"
    return $true
  }

  try {
    if (-not $flavours) {
      Write-Host "Couldn't find Discord in $env:LOCALAPPDATA (looked for Discord, DiscordPTB and DiscordCanary)." -ForegroundColor Red
      return
    }

    if ($Uninstall) {
      foreach ($flavour in $flavours) {
        foreach ($file in Get-StartupFiles $flavour) { Set-Hook $file $false }
      }
      if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
      Write-Host 'Removed de-enshittify discord.' -ForegroundColor Green
      foreach ($flavour in $flavours) { [void](Restart-Discord $flavour) }
      return
    }

    # Fetch the patch into a temporary folder first, so a failed download changes nothing.
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('de-enshittify-discord-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
      if ($Source) {
        foreach ($f in $files) { Copy-Item (Join-Path $Source $f) (Join-Path $tmp $f) }
      } else {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Write-Host 'Downloading the patch...'
        foreach ($f in $files) { Invoke-WebRequest -UseBasicParsing -Uri "$raw/src/$f" -OutFile (Join-Path $tmp $f) }
      }
      New-Item -ItemType Directory -Force -Path $dest | Out-Null
      foreach ($f in $files) { Copy-Item (Join-Path $tmp $f) (Join-Path $dest $f) -Force }
    } finally {
      Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Host "Installed the patch to $dest"

    Remove-Item $statusFile -Force -ErrorAction SilentlyContinue
    $restarted = $false
    foreach ($flavour in $flavours) {
      foreach ($file in Get-StartupFiles $flavour) { Set-Hook $file $true }
      if (Restart-Discord $flavour) { $restarted = $true }
    }
    if (-not $restarted) {
      Write-Host 'Done.' -ForegroundColor Green
      return
    }

    # About 20 seconds after Discord finishes loading, the patch writes status.json.
    Write-Host 'Waiting for Discord to load to confirm the patch (up to 2 minutes)...'
    $deadline = (Get-Date).AddMinutes(2)
    while (-not (Test-Path $statusFile) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
    if (-not (Test-Path $statusFile)) {
      Write-Host "Discord hasn't reported back yet. Open $statusFile later to see which patches applied." -ForegroundColor Yellow
      return
    }
    Start-Sleep -Milliseconds 500
    $status = Get-Content $statusFile -Raw | ConvertFrom-Json
    $applied = @($status.applied.PSObject.Properties).Count
    $failed = @($status.missed.PSObject.Properties).Count + @($status.notFound).Count + @($status.errors).Count
    if ($status.hooked -and $failed -eq 0) {
      Write-Host "Done: all $applied patches applied. Quests, the Shop and ad popups are gone." -ForegroundColor Green
    } else {
      Write-Host "Discord loaded, but $failed of $($applied + $failed) patches didn't apply, probably because Discord changed. Those parts of Discord stay as they were; check the project page for an update." -ForegroundColor Yellow
    }
  } catch {
    Write-Host "de-enshittify discord: $($_.Exception.Message)" -ForegroundColor Red
  }
}
