<#
Evaluate JavaScript inside the Stremio app running on the Samsung TV, via the
Tizen web inspector (Chrome DevTools Protocol).

  pwsh -File scripts/cdp.ps1 -Port <port> -Expr "document.title"
  pwsh -File scripts/cdp.ps1 -Port <port> -File snippet.js

The port changes on every `sdb shell 0 debug <appid>` launch - read it from that
command's output rather than reusing an old one. Lived in C:\tmpxl until that
directory was cleaned; keep it in the repo so it survives.
#>
param(
    [string]$TvIp = '192.168.1.211',
    [int]$Port    = 39235,
    [string]$Expr  = '',
    [string]$File  = '',
    [int]$TimeoutSec = 30
)

if ($File) { $Expr = Get-Content -Raw -LiteralPath $File }
if (-not $Expr) { throw "Provide -Expr or -File" }

$targets = Invoke-RestMethod "http://${TvIp}:${Port}/json/list" -TimeoutSec 10
$page = @($targets) | Where-Object { $_.type -eq 'page' } | Select-Object -First 1
if (-not $page) { throw "No page target on ${TvIp}:${Port}" }

$ws  = [System.Net.WebSockets.ClientWebSocket]::new()
$cts = [System.Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($TimeoutSec))
$ws.ConnectAsync([Uri]$page.webSocketDebuggerUrl, $cts.Token).GetAwaiter().GetResult()

function Send-Cdp {
    param([int]$Id, [string]$Method, $Params)
    $msg = @{ id = $Id; method = $Method; params = $Params } | ConvertTo-Json -Depth 10 -Compress
    $b = [Text.Encoding]::UTF8.GetBytes($msg)
    $ws.SendAsync([ArraySegment[byte]]::new($b), 'Text', $true, $cts.Token).GetAwaiter().GetResult() | Out-Null
}
function Receive-Until {
    param([int]$Id)
    $buf = [byte[]]::new(1048576)
    $seg = [ArraySegment[byte]]::new($buf)
    while ($true) {
        $sb = [Text.StringBuilder]::new()
        do {
            # Without this guard a cancelled token leaves the socket Aborted and
            # the loop spins forever writing errors (55MB in one run).
            try {
                $r = $ws.ReceiveAsync($seg, $cts.Token).GetAwaiter().GetResult()
            } catch {
                throw "CDP receive aborted (timeout ${TimeoutSec}s?): $($_.Exception.Message)"
            }
            [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $r.Count))
        } while (-not $r.EndOfMessage)
        $o = $sb.ToString() | ConvertFrom-Json
        if ($o.id -eq $Id) { return $o }
    }
}

Send-Cdp -Id 1 -Method 'Runtime.evaluate' -Params @{
    expression    = $Expr
    returnByValue = $true
    awaitPromise  = $true
}
$res = Receive-Until -Id 1

if ($res.result.exceptionDetails) {
    Write-Host "EXCEPTION: $($res.result.exceptionDetails.text) $($res.result.exceptionDetails.exception.description)"
} else {
    $v = $res.result.result.value
    if ($null -eq $v) { Write-Host "(type=$($res.result.result.type)) $($res.result.result.description)" }
    elseif ($v -is [string]) { Write-Host $v }
    else { Write-Host ($v | ConvertTo-Json -Depth 8) }
}
try { $ws.Dispose() } catch {}
