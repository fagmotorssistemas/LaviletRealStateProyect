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

Write-Host "Assert single RPC signature (Nest p_limit)..."
Invoke-SqlInContainer (Join-Path $Here "15_assert_single_signature.sql")

Write-Host "Running RPC cases..."
Invoke-SqlInContainer (Join-Path $Here "20_cases.sql")

Write-Host "Concurrency: two simultaneous connections..."
Invoke-SqlInContainer (Join-Path $Here "25_seed_concurrency.sql")
$recoverSql = "SELECT public.lv_recover_missing_meta_schedule_outbox(50);"
$jobA = Start-Job -ScriptBlock {
  param($Container, $Sql)
  docker exec $Container psql -U postgres -d schedule_test -v ON_ERROR_STOP=1 -tAc $Sql
  if ($LASTEXITCODE -ne 0) { throw "parallel recover A failed" }
} -ArgumentList $Name, $recoverSql
$jobB = Start-Job -ScriptBlock {
  param($Container, $Sql)
  docker exec $Container psql -U postgres -d schedule_test -v ON_ERROR_STOP=1 -tAc $Sql
  if ($LASTEXITCODE -ne 0) { throw "parallel recover B failed" }
} -ArgumentList $Name, $recoverSql
$done = Wait-Job $jobA, $jobB -Timeout 60
if ($done.Count -lt 2) {
  Stop-Job $jobA, $jobB -ErrorAction SilentlyContinue
  throw "parallel recover timed out"
}
$outA = (Receive-Job $jobA -ErrorAction Stop | Out-String).Trim()
$outB = (Receive-Job $jobB -ErrorAction Stop | Out-String).Trim()
Remove-Job $jobA, $jobB -Force -ErrorAction SilentlyContinue
$nA = 0; $nB = 0
[void][int]::TryParse($outA, [ref]$nA)
[void][int]::TryParse($outB, [ref]$nB)
Write-Host "parallel recover results: A=$nA B=$nB sum=$($nA+$nB)"
if (($nA + $nB) -ne 1) {
  throw "concurrency expected exactly one insert across two connections, got A=$nA B=$nB"
}
Invoke-SqlInContainer (Join-Path $Here "30_assert_concurrency.sql")

Write-Host "PASS: isolated recover DB checks"
docker rm -f $Name | Out-Null
