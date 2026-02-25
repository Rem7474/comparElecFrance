# Script to remove dead code from analysisEngine.js

$file = 'src/analysisEngine.js'
$content = Get-Content $file -Raw

# Find line numbers using string matching
$lines = $content -split "`n"
$startLine = -1
$endLine = -1

for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -like "*export function compareAllOffers*") {
    $startLine = $i - 8
    Write-Host "Found compareAllOffers at line $($i+1), starting deletion from line $($startLine+1)"
  }
  if ($lines[$i] -like "*export function buildOffersData*") {
    $endLine = $i - 5
    Write-Host "Found buildOffersData at line $($i+1), ending deletion at line $($endLine+1)"
    break  
  }
}

if ($startLine -ge 0 -and $endLine -gt $startLine) {
  $newLines = @()
  # Keep lines before compareAllOffers
  for ($i = 0; $i -lt $startLine; $i++) {
    $newLines += $lines[$i]
  }
  # Keep lines from buildOffersData comment onward
  for ($i = $endLine; $i -lt $lines.Count; $i++) {
    $newLines += $lines[$i]
  }
  
  # Write back
  $newContent = $newLines -join "`n"
  Set-Content -Path $file -Value $newContent
  Write-Host "Successfully removed compareAllOffers function ($($endLine - $startLine) lines deleted)"
} else {
  Write-Host "ERROR: Could not find boundaries. startLine=$startLine, endLine=$endLine"
}
