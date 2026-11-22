# Deploy the web app to Vercel production from this machine (23 Nov 2026).
#   ./tools/deploy_web.ps1
# Why: MUSULabs/promptpres is a private organization repository, and the Vercel Hobby plan refuses Git
# deployments from it ("Cannot deploy from a private GitHub organization repository on the Hobby plan").
# `vercel build` cannot run here either (Windows blocks the symlinks it creates), so Vercel builds remotely
# exactly as a Git deployment would (Root Directory = web, web/vercel.json).
# Safety: only what is pushed to origin/main is deployed, and only web/ is uploaded (a temporary
# allowlist .vercelignore at the repository root keeps out data/, models/, .env and the Python code).
param([switch] $AllowUnpushed)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $root
$ignore = Join-Path $root '.vercelignore'
try {
    if (Test-Path -LiteralPath $ignore) { throw '.vercelignore already exists at the repository root; remove it first.' }
    if (-not $AllowUnpushed) {
        if (git status --porcelain) { throw 'Uncommitted changes: commit and push first (or pass -AllowUnpushed).' }
        git fetch --quiet origin main
        if ((git rev-parse HEAD) -ne (git rev-parse origin/main)) { throw 'HEAD is not origin/main: push first (or pass -AllowUnpushed).' }
    }
    $link = Join-Path $root '.vercel\project.json'
    if (-not (Test-Path -LiteralPath $link)) {
        New-Item -ItemType Directory -Force (Join-Path $root '.vercel') | Out-Null
        Copy-Item -LiteralPath (Join-Path $root 'web\.vercel\project.json') -Destination $link
    }
    @(
        '/*'
        '!/web'
        '/web/node_modules'
        '/web/dist'
        '/web/.vercel'
        '/web/test-results'
        '/web/playwright-report'
        '/web/tests'
        '/web/*.tsbuildinfo'
        '/web/.env*'
    ) | Set-Content -LiteralPath $ignore -Encoding utf8NoBOM
    $url = vercel deploy --prod --yes
    if ($LASTEXITCODE -ne 0) { throw 'vercel deploy failed.' }
    Write-Output "Deployed $(git rev-parse --short HEAD): $url"
} finally {
    Remove-Item -LiteralPath $ignore -ErrorAction SilentlyContinue
    Pop-Location
}
