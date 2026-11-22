# Create or replace the Modal Secret `promptpres-secrets` (D-062) from Code/promptpres/.env without printing values.
#   ./tools/set_modal_secret.ps1 -Origin "https://www.promptpres.app,https://promptpres.app,https://promptpres.vercel.app" -DirectOrigin https://<workspace>--promptpres-web.us-east.modal.run -Replace
# -Origin: the web app address(es), comma-separated; the first is the canonical one (a custom domain can be added later).
# -DirectOrigin: the Modal web URL (printed by `modal deploy`); empty on the very first deploy.
# Reads from .env (the last line of a key wins, like python-dotenv): DATABASE_URL (Supabase session pooler),
# PROMPTPRES_SESSION_SECRET, OPENROUTER_API_KEY, OPENROUTER_MODEL.
param(
    [Parameter(Mandatory)] [string] $Origin,
    [string] $DirectOrigin = '',
    [string] $EnvFile = (Join-Path $PSScriptRoot '..' '.env'),
    [switch] $Replace
)
$ErrorActionPreference = 'Stop'
$values = @{}
foreach ($line in Get-Content -LiteralPath $EnvFile -Encoding utf8) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
        $values[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
    }
}
foreach ($key in 'DATABASE_URL', 'PROMPTPRES_SESSION_SECRET', 'OPENROUTER_API_KEY') {
    if (-not $values[$key]) { throw "$key is missing in $EnvFile" }
}
$database = [Uri] $values['DATABASE_URL']
if ($database.Scheme -notin 'postgresql', 'postgres' -or $database.Host -in 'localhost', '127.0.0.1', 'db') {
    throw 'The last DATABASE_URL in .env must be the cloud PostgreSQL (Supabase session pooler) URL.'
}
$origins = @($Origin.Split(',') | ForEach-Object { $_.Trim().TrimEnd('/') } | Where-Object { $_ })
$DirectOrigin = $DirectOrigin.Trim().TrimEnd('/')
foreach ($candidate in $origins + @($DirectOrigin | Where-Object { $_ })) {
    if ($candidate -notmatch '^https://[a-z0-9.-]+(?::\d+)?$') { throw "Not an HTTPS origin: $candidate" }
}
$signing = $values['PROMPTPRES_SESSION_SECRET']
if ($signing.Length -lt 32 -or $signing -notmatch '^[A-Za-z0-9_-]+$') {
    throw 'PROMPTPRES_SESSION_SECRET must be URL-safe and at least 32 characters.'
}
$model = if ($values['OPENROUTER_MODEL']) { $values['OPENROUTER_MODEL'] } else { 'google/gemini-2.5-flash-lite' }
$lines = @(
    "DATABASE_URL=$($values['DATABASE_URL'])"
    "PROMPTPRES_SESSION_SECRET=$signing"
    "OPENROUTER_API_KEY=$($values['OPENROUTER_API_KEY'])"
    "OPENROUTER_MODEL=$model"
    "PROMPTPRES_PUBLIC_ORIGIN=$($origins -join ',')"
)
if ($DirectOrigin) { $lines += "PROMPTPRES_DIRECT_ORIGIN=$DirectOrigin" }
if ($lines | Where-Object { $_ -match "['`"#\s]" }) { throw 'A value contains a quote, # or space; fix it in .env first.' }
$file = [IO.Path]::GetTempFileName()
try {
    $lines | Set-Content -LiteralPath $file -Encoding utf8NoBOM
    # Build a real array: `if` unrolls a one-item array to a string, which splats as single characters.
    $flags = @(); if ($Replace) { $flags += '--force' }
    modal secret create --from-dotenv $file @flags promptpres-secrets | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Modal secret create failed.' }
    Write-Output "promptpres-secrets set: $($lines.Count) keys (values not shown)"
} finally {
    Remove-Item -LiteralPath $file
}
