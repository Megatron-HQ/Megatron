param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = [System.IO.Path]::Combine($PSHOME, 'Modules')
$signature = Get-AuthenticodeSignature -LiteralPath $Path
if ($signature.Status -ne 'Valid' -or $null -eq $signature.TimeStamperCertificate) {
    throw 'A valid, timestamped Authenticode signature is required.'
}
if ([string]::IsNullOrWhiteSpace($env:MEGATRON_WINDOWS_PUBLISHER)) {
    throw 'MEGATRON_WINDOWS_PUBLISHER must contain the expected certificate subject.'
}
if ($signature.SignerCertificate.Subject -ne $env:MEGATRON_WINDOWS_PUBLISHER) {
    throw 'The signing certificate does not match the expected publisher.'
}
