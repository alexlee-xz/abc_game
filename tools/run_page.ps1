# Usage: powershell tools\run_page.ps1 art_check [virtual-time-ms]
# Needs a static server already running:  python -m http.server 8765   (in the project root)
# Opens tools/<name>.html in headless Edge and prints the text of <pre id="out">.
param([string]$Name = "browser_test", [int]$Budget = 30000)
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$prof = Join-Path $env:TEMP ("abc_edge_" + [guid]::NewGuid().ToString("N"))
$dom = & $edge --headless --disable-gpu --no-first-run --user-data-dir=$prof --virtual-time-budget=$Budget --dump-dom "http://localhost:8765/tools/$Name.html" 2>$null | Out-String
Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue
if($dom -match '(?s)<pre id="out">(.*?)</pre>'){ [System.Net.WebUtility]::HtmlDecode($Matches[1]) } else { "NO OUTPUT" }
