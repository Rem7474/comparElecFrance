# Remove buildOffersData from analysisEngine.js

$file = 'src/analysisEngine.js'
$content = Get-Content $file -Raw
$lines = $content -split "`n"

$startLine = -1
$endLine = -1

for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -like "*export function buildOffersData*") {
    $startLine = $i - 8
    Write-Host "Found buildOffersData at line $($i+1), starting deletion from line $($startLine+1)"
  }
  # Find the next export function or EOF
  if ($startLine -ge 0 -and $i -gt $startLine) {
    if ($lines[$i] -like "*export function *" -or $lines[$i] -like "*export const *") {
      # Line 493 should be around here - the computeCostWithProfile function
      if ($lines[$i] -match '^export (function|const)' -and $i -gt $startLine + 50) {
        $endLine = $i - 8
        Write-Host "Found end of buildOffersData at line $($i+1), will delete until line $($endLine+1)"
        break
      }
    }
  }
}

# If we can't find the next function, estimate based on file size
if ($endLine -lt 0 -and $startLine -ge 0) {
  # buildOffersData should be around 166 lines based on audit
  $endLine = $startLine + 166
  Write-Host "Estimated end of buildOffersData at line $($endLine+1)"
}

if ($startLine -ge 0 -and $endLine -gt $startLine) {
  $newLines = @()
  for ($i = 0; $i -lt $startLine; $i++) {
    $newLines += $lines[$i]
  }
  for ($i = $endLine; $i -lt $lines.Count; $i++) {
    $newLines += $lines[$i]
  }
  
  $newContent = $newLines -join "`n"
  Set-Content -Path $file -Value $newContent
  Write-Host "Successfully removed buildOffersData function ($($endLine - $startLine) lines deleted)"
} else {
  Write-Host "ERROR: Could not find boundaries. startLine=$startLine, endLine=$endLine"
}
