# Roda SQL no projeto cms-portal pela API de gestão do Supabase.
# Uso: powershell -File supabase/scripts/sql.ps1 -Arquivo caminho.sql
#      powershell -File supabase/scripts/sql.ps1 -Sql "select 1"
# O token fica na variável de usuário SUPABASE_ACCESS_TOKEN (nunca no repositório).
param([string]$Arquivo, [string]$Sql, [string]$Projeto = 'rczlnuemmluhkgwzdino')
$token = [Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN', 'User')
if (-not $token) { throw 'SUPABASE_ACCESS_TOKEN não configurado' }
if ($Arquivo) { $Sql = [IO.File]::ReadAllText((Resolve-Path $Arquivo), [Text.Encoding]::UTF8) }
$body = [Text.Encoding]::UTF8.GetBytes((@{ query = $Sql } | ConvertTo-Json -Compress))
try {
  $r = Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Projeto/database/query" `
    -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json; charset=utf-8' -Body $body -ErrorAction Stop
  $r | ConvertTo-Json -Depth 6
} catch {
  $msg = $_.ErrorDetails.Message; if (-not $msg) { $msg = $_.Exception.Message }
  Write-Output "ERRO: $msg"; exit 1
}
