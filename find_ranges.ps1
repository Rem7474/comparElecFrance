# Remove dead functions from analysisEngine.js using line deletion

$file = 'src/analysisEngine.js'
$lines = @(Get-Content $file)

Write-Host "Total lines: $($lines.Count)"

# Find exact line ranges for dead functions
$compareAllOffersStart = -1
$compareAllOffersEnd = -1
$buildOffersDataStart = -1
$buildOffersDataEnd = -1

# Find compareAllOffers
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -like "*export function compareAllOffers*") {
    # Go back to find /**
    for ($j = $i - 1; $j -ge 0; $j--) {
      if ($lines[$j] -like "/**") {
        $compareAllOffersStart = $j
        break
      }
    }
    
    # Find the return statement and closing brace
    for ($j = $i; $j -lt $lines.Count; $j++) {
      if ($lines[$j] -match 'return.*offers.*best.*exportIncome' -and $j+1 -lt $lines.Count -and $lines[$j+1] -like "}") {
        $compareAllOffersEnd = $j + 1
        break
      }
    }
    break
  }
}

# Find buildOffersData
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -like "*export function buildOffersData*") {
    # Go back to find /**
    for ($j = $i - 1; $j -ge 0; $j--) {
      if ($lines[$j] -like "/**") {
        $buildOffersDataStart = $j
        break
      }
    }
    
    # Find the return statement and closing brace
    for ($j = $i; $j -lt $lines.Count; $j++) {
      if ($lines[$j] -match 'return.*{' -and $lines[$j] -match 'offers.*stats.*pv' -and $j+4 -lt $lines.Count) {
        # This is at least 3 more lines
        $k = $j
        while ($k -lt $lines.Count -and $lines[$k] -notmatch '^\};\s*$') {
          $k++
        }
        if ($lines[$k] -match '^\}') {
          $buildOffersDataEnd = $k
          break
        }
      }
    }
    break
  }
}

Write-Host "compareAllOffers: lines $($compareAllOffersStart+1) to $($compareAllOffersEnd+1)"
Write-Host "buildOffersData: lines $($buildOffersDataStart+1) to $($buildOffersDataEnd+1)"

# Verify the ranges
if ($compareAllOffersStart -ge 0 -and $compareAllOffersEnd -gt $compareAllOffersStart) {
  Write-Host ""
  Write-Host "=== compareAllOffers function ==="
  for ($i = $compareAllOffersStart; $i -le [Math]::Min($compareAllOffersStart + 3, $compareAllOffersEnd); $i++) {
    Write-Host "Line $($i+1): $($lines[$i])"
  }
  Write-Host "..."
  for ($i = [Math]::Max($compareAllOffersStart, $compareAllOffersEnd - 3); $i -le $compareAllOffersEnd; $i++) {
    Write-Host "Line $($i+1): $($lines[$i])"
  }
}

if ($buildOffersDataStart -ge 0 -and $buildOffersDataEnd -gt $buildOffersDataStart) {
  Write-Host ""
  Write-Host "=== buildOffersData function ==="
  for ($i = $buildOffersDataStart; $i -le [Math]::Min($buildOffersDataStart + 3, $buildOffersDataEnd); $i++) {
    Write-Host "Line $($i+1): $($lines[$i])"
  }
  Write-Host "..."
  for ($i = [Math]::Max($buildOffersDataStart, $buildOffersDataEnd - 3); $i -le $buildOffersDataEnd; $i++) {
    Write-Host "Line $($i+1): $($lines[$i])"
  }
}
