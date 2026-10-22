# Run every check:  powershell -NoProfile -File tests\run_all.ps1
#   - node tests (play layer, speak/recording, srs + accounts + transfer link, cloud sync incl. the Worker on SQLite)
#   - headless Edge pages (art_check, browser_test) against a temporary local server on :8765
# Needs node and the project's Python venv (..\.venv) for the static server.
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$fail = 0

foreach($t in "test_play", "test_speak", "test_srs", "test_sync", "test_alpha", "test_ipa"){
    $out = (& node "tests/$t.js" 2>&1 | Out-String)
    $ok = $LASTEXITCODE -eq 0 -and $out -match "ALL OK"
    "{0,-12} {1}" -f $t, $(if($ok){"ok"}else{"FAILED"})
    if(-not $ok){ $fail++; $out }
}

$py = Join-Path $root "..\.venv\Scripts\python.exe"
if(-not (Test-Path $py)){ $py = "python" }
$srv = Start-Process -FilePath $py -ArgumentList "-m", "http.server", "8765" -WorkingDirectory $root -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2
try{
    $art = & powershell -NoProfile -File "$PSScriptRoot\run_page.ps1" art_check 20000 | Out-String
    $ok = $art -match "ART OK"
    "{0,-12} {1}" -f "art_check", $(if($ok){"ok"}else{"FAILED"})
    if(-not $ok){ $fail++; $art }

    $br = & powershell -NoProfile -File "$PSScriptRoot\run_page.ps1" browser_test 120000 | Out-String
    $bad = $br -split "`n" | Where-Object { $_ -match "^(ERROR|REJECT|NOT FOUND|TEST ERROR)|NO OUTPUT" }
    $game = $br -match "game: rounds advanced=8 stuckAt=-1 finished=true"
    $ok = (-not $bad) -and $game
    "{0,-12} {1}" -f "browser_test", $(if($ok){"ok"}else{"FAILED"})
    if(-not $ok){ $fail++; $bad; $br }
}finally{
    Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue
}
if($fail){ "`n$fail check(s) failed"; exit 1 } else { "`nALL OK" }
