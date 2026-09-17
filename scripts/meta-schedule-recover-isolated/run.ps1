# Isolated Postgres test for Schedule recover migrations/RPCs.
$ErrorActionPreference = "Stop"
$Here = $PSScriptRoot
$Root = Resolve-Path (Join-Path $Here "..\..")
$Mig = Join-Path $Root "supabase\migrations"
$Name = "lv-meta-schedule-recover-test"
$Port = 55432

Write-Host "Root=$Root"
Write-Host "Starting isolated Postgres on :$Port ..."
docker rm -f $Name 2>$null | Out-Null
docker run -d --name $Name `
  -e POSTGRES_PASSWORD=test `
  -e POSTGRES_USER=postgres `
  -e POSTGRES_DB=schedule_test `
  -p "${Port}:5432" `
  postgres:16 | Out-Null

$ok = $false
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep -Seconds 1
  docker exec $Name pg_isready -U postgres -d schedule_test 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ok = $true; break }
}
if (-not $ok) { throw "Postgres did not become ready" }

function Invoke-SqlInContainer([string]$HostPath) {
  $leaf = Split-Path $HostPath -Leaf
  docker cp $HostPath "${Name}:/tmp/$leaf" | Out-Null
  docker exec $Name psql -U postgres -d schedule_test -v ON_ERROR_STOP=1 -f "/tmp/$leaf"
  if ($LASTEXITCODE -ne 0) { throw "SQL failed: $HostPath" }
}

Write-Host "Applying schema + migrations..."
Invoke-SqlInContainer (Join-Path $Here "00_schema.sql")
Invoke-SqlInContainer (Join-Path $Mig "20260917152000_meta_capi_outbox_review_hold.sql")
Invoke-SqlInContainer (Join-Path $Mig "20260917160000_meta_schedule_recovery.sql")
Invoke-SqlInContainer (Join-Path $Mig "20260917170000_meta_schedule_recover_pre_intent.sql")

Write-Host "Running RPC cases..."
Invoke-SqlInContainer (Join-Path $Here "20_cases.sql")

Write-Host "PASS: isolated recover DB checks"
docker rm -f $Name | Out-Null
