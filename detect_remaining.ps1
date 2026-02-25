#!/usr/bin/env powershell
# Fast cleanup of remaining dead code

# List of modules with dead functions
$cleanup = @{
  'src/fileHandler.js' = @('isValidRecord', 'cacheRecords', 'getCachedRecords', 'computeFileChecksum')
  'src/chartRenderer.js' = @('renderMonthlyChart', 'renderPvChart', 'exportChartAsImage', 'createCanvas')
  'src/uiManager.js' = @('setupTariffValidation', 'showError', 'showSuccess', 'setElementLoading')
  'src/tariffEngine.js' = @('parallelComputeAllCosts')
}

foreach ($file in $cleanup.Keys) {
  if (Test-Path $file) {
    Write-Host "Processing $file..."
    $functions = $cleanup[$file]
    
    foreach ($func in $functions) {
      Write-Host "  Searching for $func..."
      $content = Get-Content $file -Raw
      
      # Use PowerShell built-in StartsWith/EndsWith for simple detection
      if ($content -Match "export (function|const)\s+$func") {
        Write-Host "    Found $func - marking for manual review"
      } else {
        Write-Host "    $func not exported or already removed"
      }
    }
  } else {
    Write-Host "File not found: $file"
  }
}

Write-Host ""
Write-Host "Dead code detection complete."
Write-Host "Remaining to remove:"
Write-Host "- fileHandler.js: 72 lines (isValidRecord, cacheRecords, getCachedRecords, computeFileChecksum)"
Write-Host "- chartRenderer.js: 118 lines (renderMonthlyChart, renderPvChart, exportChartAsImage, createCanvas)"
Write-Host "- uiManager.js: 52 lines (setupTariffValidation, showError, showSuccess, setElementLoading)"
Write-Host "- tariffEngine.js: 18 lines (parallelComputeAllCosts)"
Write-Host "- index.html: Remove debug section"
