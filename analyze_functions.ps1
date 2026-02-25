# Careful removal of dead functions from analysisEngine.js

$file = 'src/analysisEngine.js'
$content = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)

# Function 1: Remove compareAllOffers
# Pattern: from export function compareAllOffers to return { offers, best, exportIncome };
$pattern1 = @'
export function compareAllOffers\(records, isPvEnabled, pvParams, defaults\) \{
  if \(\!records \|\| records\.length === 0\) \{
    return \{ offers: \[\], best: null, exportIncome: 0 \};
  \}

  // Build per-hour annual profile
  const perHourAnnual = Array\(24\)\.fill\(0\);
  const uniqueMonths = new Set\(\);
  
  for \(const rec of records\) \{
    const value = Number\(rec\.valeur\) \|\| 0;
    const date = new Date\(rec\.dateDebut\);
    
    perHourAnnual\[date\.getHours\(\)\] \+= value;
    uniqueMonths\.add\(`\$\{date\.getFullYear\(\)\}-\$\{date\.getMonth\(\)\}`\);
  \}

  const monthsCount = Math\.max\(1, uniqueMonths\.size\);

  // Prepare costs
  const priceBase = Number\(defaults\.priceBase\) \|\| 0\.18;
  const hpParams = \{
    mode: 'hp-hc',
    php: Number\(defaults\.hp\.php\) \|\| 0\.2,
    phc: Number\(defaults\.hp\.phc\) \|\| 0\.12,
    hcRange: defaults\.hp\.hcRange \|\| '22-06'
  \};

  const subBase = \(Number\(defaults\.subBase\) \|\| 0\) \* monthsCount;
  const subHp = \(Number\(defaults\.hp\.sub\) \|\| 0\) \* monthsCount;
  const subTempo = \(Number\(defaults\.tempo\.sub\) \|\| 0\) \* monthsCount;
  const subTch = \(Number\(defaults\.totalChargeHeures\?\.sub\) \|\| 0\) \* monthsCount;

  // Compute costs without PV
  const baseCostNoPV = computeCostWithProfile\(perHourAnnual, priceBase, \{ mode: 'base' \}\)\.cost \+ subBase;
  const hpCostNoPV = computeCostWithProfile\(perHourAnnual, priceBase, hpParams\)\.cost \+ subHp;
  const tempoResNoPV = computeCostTempo\(records, \{\}, defaults\.tempo\);
  tempoResNoPV\.cost \+= subTempo;
  const tempoOptResNoPV = computeCostTempoOptimized\(records, \{\}, defaults\.tempo\);
  if \(tempoOptResNoPV && typeof tempoOptResNoPV\.cost === 'number'\) \{
    tempoOptResNoPV\.cost \+= subTempo;
  \}
  const tchResNoPV = computeCostTotalCharge\(records, defaults\.totalChargeHeures\);
  tchResNoPV\.cost \+= subTch;

  // PV calculation
  let exportIncome = 0;
  let baseCostWithPV = baseCostNoPV;
  let hpCostWithPV = hpCostNoPV;
  let tempoResWithPV = \{ cost: tempoResNoPV\.cost \};
  let tempoOptResWithPV = \{ cost: tempoOptResNoPV\?\.cost \|\| tempoResNoPV\.cost \};
  let tchResWithPV = \{ cost: tchResNoPV\.cost \};

  if \(isPvEnabled\) \{
    const annualProduction = \(pvParams\.kwp \|\| 0\) \* pvYieldPerKwp\(pvParams\.region \|\| 'centre'\);
    const exportPrice = Number\(defaults\.injectionPrice\) \|\| 0;

    const pvSim = simulatePVEffect\(
      records,
      annualProduction,
      exportPrice,
      pvParams\.standby \|\| 0,
      \[\] // monthlyWeights would be passed here
    \);

    const perHourWithPV = perHourAnnual\.map\(\(v, h\) =>
      Math\.max\(0, v - \(pvSim\.consumedByHour\[h\] \|\| 0\)\)
    \);

    baseCostWithPV = computeCostWithProfile\(perHourWithPV, priceBase, \{ mode: 'base' \}\)\.cost \+ subBase;
    hpCostWithPV = computeCostWithProfile\(perHourWithPV, priceBase, hpParams\)\.cost \+ subHp;

    const recordsWithPV = records\.map\(rec => \(\{ \.\.\.rec \}\)\);
    for \(const rec of recordsWithPV\) \{
      const reduction = \(pvSim\.allocatedByTimestamp && pvSim\.allocatedByTimestamp\[rec\.dateDebut\]\) \|\| 0;
      rec\.valeur = Math\.max\(0, Number\(rec\.valeur \|\| 0\) - reduction\);
    \}

    tempoResWithPV = computeCostTempo\(recordsWithPV, \{\}, defaults\.tempo\);
    tempoResWithPV\.cost \+= subTempo;

    tchResWithPV = computeCostTotalCharge\(recordsWithPV, defaults\.totalChargeHeures\);
    tchResWithPV\.cost \+= subTch;

    tempoOptResWithPV = computeCostTempoOptimized\(recordsWithPV, \{\}, defaults\.tempo\);
    tempoOptResWithPV\.cost = \(tempoOptResWithPV\?\.cost \|\| tempoResWithPV\.cost\) \+ subTempo;

    exportIncome = pvSim\.exported \* exportPrice;
  \}

  // Build offers list
  const offers = \[\];

  if \(defaults && defaults\.priceBase != null\) \{
    offers\.push\(\{
      id: 'base',
      name: 'Base',
      costNoPV: baseCostNoPV,
      costWithPV: baseCostWithPV
    \}\);
  \}

  if \(defaults && defaults\.hp\) \{
    offers\.push\(\{
      id: 'hphc',
      name: 'Heures Pleines / Creuses',
      costNoPV: hpCostNoPV,
      costWithPV: hpCostWithPV
    \}\);
  \}

  if \(defaults && defaults\.tempo\) \{
    offers\.push\(\{
      id: 'tempo',
      name: 'Tempo \(Classique\)',
      costNoPV: tempoResNoPV\.cost \|\| 0,
      costWithPV: tempoResWithPV\.cost \|\| 0
    \}\);

    offers\.push\(\{
      id: 'tempoOpt',
      name: 'Tempo \(Optimisé\)',
      costNoPV: \(tempoOptResNoPV\?\.cost \|\| 0\),
      costWithPV: tempoOptResWithPV\.cost \|\| 0
    \}\);
  \}

  if \(defaults && defaults\.totalChargeHeures\) \{
    offers\.push\(\{
      id: 'tch',
      name: 'Total Charge'Heures',
      costNoPV: tchResNoPV\.cost \|\| 0,
      costWithPV: tchResWithPV\.cost \|\| 0
    \}\);
  \}

  // Find best
  const sortedByCost = offers\.slice\(\)\.sort\(\(a, b\) => a\.costWithPV - b\.costWithPV\);
  const best = sortedByCost\[0\] \|\| null;

  return \{ offers, best, exportIncome \};
\}
'@

# Simpler approach: Just look for the export function and manually cut each one
# Let's identify line numbers and remove by line numbers only
$lines = $content -split "`n"

# Count how many lines matched compareAllOffers
Write-Host "File has $($lines.Count) total lines"
Write-Host "Searching for dead code functions..."

for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -like "*export function compareAllOffers*") {
    Write-Host "Found compareAllOffers at line $($i+1)"
  }
  if ($lines[$i] -like "*export function buildOffersData*") {
    Write-Host "Found buildOffersData at line $($i+1)"
  }
}
