// Quick verification script for the modular tariff system
// Copy and paste this in the browser console (F12) after the page loads

console.log('=== MODULAR TARIFF SYSTEM VERIFICATION ===\n');

// 1. Check if tariffs were loaded
console.log('1. TARIFFS loaded:');
console.log('   Count:', Object.keys(TARIFFS).length);
console.log('   IDs:', Object.keys(TARIFFS));

// 2. Check DEFAULTS wrapper
console.log('\n2. DEFAULTS wrapper:');
console.log('   base:', TARIFFS.base ? '✅' : '❌');
console.log('   hphc:', TARIFFS.hphc ? '✅' : '❌');
console.log('   tempo:', TARIFFS.tempo ? '✅' : '❌');
console.log('   totalCharge:', TARIFFS.totalCharge ? '✅' : '❌');

// 3. Check tariff structure
console.log('\n3. Tariff structure (example: base):');
const baseTariff = TARIFFS.base;
console.log('   id:', baseTariff?.id);
console.log('   name:', baseTariff?.name);
console.log('   type:', baseTariff?.type);
console.log('   price:', baseTariff?.price);
console.log('   subscriptions:', Object.keys(baseTariff?.subscriptions || {}).length, 'levels');

// 4. Check helper functions
console.log('\n4. Helper functions:');
console.log('   getActiveTariffIds():', typeof getActiveTariffIds);
console.log('   getTariff():', typeof getTariff);
console.log('   getPriceForPower():', typeof getPriceForPower);

// 5. Test price lookup
console.log('\n5. Test price lookup for 9 kVA:');
['base', 'hphc', 'tempo', 'totalCharge'].forEach(type => {
  const price = getPriceForPower(type, 9);
  console.log(`   ${type}: ${price} €/month`);
});

// 6. Check solar weights
console.log('\n6. Solar weights (normalized):');
console.log('   Count:', DEFAULTS.monthlySolarWeights?.length);
console.log('   Sum:', DEFAULTS.monthlySolarWeights?.reduce((a,b) => a+b, 0).toFixed(3));

console.log('\n✅ Modular tariff system is ready!');
console.log('\nNext steps:');
console.log('  1. Import an electricity consumption file');
console.log('  2. Check if all tariffs compute costs correctly');
console.log('  3. Verify charts display all offers');
