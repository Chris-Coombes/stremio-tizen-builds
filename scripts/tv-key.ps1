<#
Press real remote keys on the Samsung TV over its remote-control websocket.

  pwsh -File scripts/tv-key.ps1 -Key KEY_ENTER
  pwsh -File scripts/tv-key.ps1 -Key KEY_DOWN,KEY_RIGHT -DelayMs 700

Synthetic KeyboardEvents over CDP drive the shim and the spatial-navigation
polyfill, but they carry no event.code and nothing guarantees they take the
same path through stremio-web's shortcuts or a button's Enter-to-click as a
real press. Prove remote behaviour with real keys. Needs the pairing token the
TV issued (Settings > General > External Device Manager > Device Connect
Manager), kept OUTSIDE the repo. The old copy lived in C:\tmpxl as tv.ps1 and
was lost when that directory was cleaned.
#>
param(
    [string]$TvIp = '192.168.1.211',
    [string[]]$Key = @('KEY_ENTER'),
    [int]$DelayMs = 600,
    [string]$TokenFile = (Join-Path $HOME '.config\samsung-tv\token.txt')
)

# A scriptblock cannot be a TLS callback (no runspace on that thread), so the
# TV's self-signed certificate is accepted through a compiled delegate.
if (-not ('CertOK' -as [type])) {
    Add-Type -TypeDefinition @'
using System.Net.Security; using System.Security.Cryptography.X509Certificates;
public static class CertOK {
  public static bool Any(object s, X509Certificate c, X509Chain ch, SslPolicyErrors e) { return true; }
  public static RemoteCertificateValidationCallback Cb = new RemoteCertificateValidationCallback(Any);
}
'@
}

$token = (Get-Content -Raw -LiteralPath $TokenFile).Trim()
$name = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('ClaudeRemote'))
$uri = "wss://${TvIp}:8002/api/v2/channels/samsung.remote.control?name=$name&token=$token"

$h = [System.Net.Http.SocketsHttpHandler]::new()
$h.SslOptions.RemoteCertificateValidationCallback = [CertOK]::Cb
$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$ws.ConnectAsync([Uri]$uri, [System.Net.Http.HttpMessageInvoker]::new($h),
    [Threading.CancellationTokenSource]::new(10000).Token).GetAwaiter().GetResult()

# Wait for ms.channel.connect; unauthorized means the token is no longer accepted.
$buf = [byte[]]::new(65536)
$r = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf),
    [Threading.CancellationTokenSource]::new(10000).Token).GetAwaiter().GetResult()
$hello = [Text.Encoding]::UTF8.GetString($buf, 0, $r.Count)
if ($hello -notmatch 'ms.channel.connect') { throw "TV refused the connection: $hello" }

# pwsh -File passes "A,B" as one string, so split it here.
foreach ($k in ($Key -split ',')) {
    $msg = @{ method = 'ms.remote.control'; params = @{
        Cmd = 'Click'; DataOfCmd = $k; Option = 'false'; TypeOfRemote = 'SendRemoteKey' } } |
        ConvertTo-Json -Compress
    $b = [Text.Encoding]::UTF8.GetBytes($msg)
    $ws.SendAsync([ArraySegment[byte]]::new($b), 'Text', $true,
        [Threading.CancellationTokenSource]::new(5000).Token).GetAwaiter().GetResult()
    "sent $k"
    Start-Sleep -Milliseconds $DelayMs
}
$ws.Dispose()
