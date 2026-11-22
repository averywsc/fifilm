param(
  [string]$PfxPath = "",
  [string]$Password = "",
  [switch]$SelfSigned
)

$ErrorActionPreference = "Stop"
$releaseDir = Join-Path $PSScriptRoot "..\release"
$exeFiles = Get-ChildItem -Path $releaseDir -Filter "Fifilm*.exe" -ErrorAction SilentlyContinue

if (-not $exeFiles -or $exeFiles.Count -eq 0) {
  Write-Error "No Fifilm*.exe files found in $releaseDir. Run 'npm run dist:win' first."
  exit 1
}

$cert = $null

if ($PfxPath) {
  if (-not (Test-Path $PfxPath)) {
    Write-Error "Certificate file not found: $PfxPath"
    exit 1
  }
  $secPwd = if ($Password) { ConvertTo-SecureString $Password -AsPlainText -Force } else { Read-Host "Enter PFX password" -AsSecureString }
  $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($PfxPath, $secPwd)
  Write-Host "Loaded code signing certificate: $($cert.Subject)"
} elseif ($SelfSigned) {
  Write-Host "NOTE: Self-signed certificates only remove warnings on PCs that manually trust the cert."
  Write-Host "For public users, use a trusted CA certificate (SignPath Foundation free for OSS, or Azure Trusted Signing)."
  $existing = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -eq "CN=Fifilm Local Dev" } | Select-Object -First 1
  if ($existing) {
    $cert = $existing
    Write-Host "Reusing existing local dev certificate: $($cert.Thumbprint)"
  } else {
    $cert = New-SelfSignedCertificate `
      -Type CodeSigningCert `
      -Subject "CN=Fifilm Local Dev" `
      -CertStoreLocation "Cert:\CurrentUser\My" `
      -KeyAlgorithm RSA `
      -KeyLength 2048 `
      -NotAfter (Get-Date).AddYears(3)
    Write-Host "Created local dev CodeSigningCert: $($cert.Thumbprint)"
  }
} else {
  Write-Host "Usage:"
  Write-Host "  Sign with a trusted .pfx certificate:"
  Write-Host "    powershell -ExecutionPolicy Bypass -File scripts/sign_exe.ps1 -PfxPath C:\path\to\cert.pfx"
  Write-Host "  Sign locally with a dev self-signed certificate (for local testing only):"
  Write-Host "    powershell -ExecutionPolicy Bypass -File scripts/sign_exe.ps1 -SelfSigned"
  exit 0
}

foreach ($file in $exeFiles) {
  Write-Host "Signing $($file.Name)..."
  $res = Set-AuthenticodeSignature `
    -FilePath $file.FullName `
    -Certificate $cert `
    -HashAlgorithm SHA256 `
    -TimestampServer "http://timestamp.digicert.com"
  Write-Host "  Status: $($res.Status) - $($res.StatusMessage)"
}
