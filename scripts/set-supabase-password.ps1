param(
  [string]$EnvFile = (Join-Path $PSScriptRoot '..\.env'),
  [System.Security.SecureString]$Password
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$envPath = [System.IO.Path]::GetFullPath($EnvFile)
if (-not $envPath.StartsWith($repoRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'The environment file must be inside this repository.'
}
if (-not [System.IO.File]::Exists($envPath)) {
  throw 'The environment file does not exist.'
}

& git -C $repoRoot check-ignore --quiet -- $envPath
if ($LASTEXITCODE -ne 0) {
  throw 'The environment file is not Git-ignored. Refusing to write a credential.'
}

if (-not $Password) {
  $Password = Read-Host 'New Supabase database password (input hidden)' -AsSecureString
}

$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
try {
  $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ([string]::IsNullOrWhiteSpace($plain) -or $plain.Length -lt 12) {
    throw 'Use a database password of at least 12 characters.'
  }
  $encoded = [System.Uri]::EscapeDataString($plain)
} finally {
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  $plain = $null
}

$content = [System.IO.File]::ReadAllText($envPath)
foreach ($name in @('DATABASE_URL', 'DIRECT_DATABASE_URL')) {
  $pattern = '(?m)^' + $name + '=.*$'
  if ([regex]::Matches($content, $pattern).Count -ne 1) {
    throw "Expected exactly one $name entry in the environment file."
  }
}

$connectionUrl = 'postgresql://postgres.ikyxoidltualpzklrhmn:' + $encoded + '@aws-0-eu-west-1.pooler.supabase.com:5432/postgres'
foreach ($name in @('DATABASE_URL', 'DIRECT_DATABASE_URL')) {
  $pattern = '(?m)^' + $name + '=.*$'
  $content = [regex]::Replace($content, $pattern, ($name + '=' + $connectionUrl))
}

[System.IO.File]::WriteAllText($envPath, $content, [System.Text.UTF8Encoding]::new($false))
Write-Output 'Updated both Supabase database URLs in the ignored environment file.'
