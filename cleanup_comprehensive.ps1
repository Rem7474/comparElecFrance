# Comprehensive cleanup of analysisEngine.js dead code

$file = 'src/analysisEngine.js'
$content = Get-Content $file -Raw
$lines = $content -split "`n"

# Find and remove orphaned JSDoc lines and buildOffersData
$newLines = @()
$skipMode = $false
$skipUntilExport = $false

for ($i = 0; $i -lt $lines.Count; $i++) {
  $line = $lines[$i]
  
  # Skip orphaned JSDoc lines (after compareAllOffers removal)
  if ($line -match '^\s*\*\s*@param\s+\{Array\}\s+records' -and $skipMode -eq $false) {
    # Check if this is orphaned (previous line should not be export function)
    if ($i -gt 0 -and $lines[$i-1] -like "*export function*" -eq $false) {
      Write-Host "Found orphaned JSDoc at line $($i+1)"
      # Skip this and related orphaned lines
      while ($i -lt $lines.Count -and ($lines[$i] -match '^\s*\*' -or $lines[$i] -match '^\s*\/' -or $lines[$i] -match '^\s*$')) {
        $i++
        if ($i -lt $lines.Count -and $lines[$i] -like "*export function buildOffersData*") {
          break
        }
      }
      $i-- # Back up one since the for loop will increment
      continue
    }
  }
  
  # Start skipping when we hit buildOffersData
  if ($line -like "*export function buildOffersData*") {
    Write-Host "Found buildOffersData at line $($i+1), skipping until next export..."
    $skipUntilExport = $true
    # Also skip the JSDoc comment before it
    # Go back and remove the JSDoc
    while ($newLines.Count -gt 0 -and ($newLines[-1] -match '^\s*\*|^\s*/$|^\s*/**|^\s*$')) {
      Write-Host "Removing JSDoc line: $($newLines[-1])"
      $newLines = $newLines[0..($newLines.Count-2)]
    }
    continue
  }
  
  # Stop skipping when we find the next export or const declaration at start of line
  if ($skipUntilExport -and $line -match '^\s*export\s+(function|const)' -and $line -notlike "*buildOffersData*") {
    Write-Host "Found next function at line $($i+1), resuming..."
    $skipUntilExport = $false
  }
  
  if ($skipUntilExport) {
    continue
  }
  
  $newLines += $line
}

$newContent = $newLines -join "`n"
Set-Content -Path $file -Value $newContent
Write-Host "Cleanup complete. File now has $($newLines.Count) lines (was $($lines.Count) lines)"
