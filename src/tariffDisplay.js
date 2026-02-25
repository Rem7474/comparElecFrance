/**
 * tariffDisplay.js - Tariff information display with visual cards
 * Renders tariff cards using data from JSON files
 * @module tariffDisplay
 */

/**
 * Generate a tariff card HTML element
 * @param {Object} tariff - Tariff object with id, name, type, description, prices, etc.
 * @param {Object} DEFAULTS - Current DEFAULTS to show which subscription is selected
 * @returns {HTMLElement} Card element
 */
export function createTariffCard(tariff, DEFAULTS) {
  const card = document.createElement('div');
  card.className = 'tariff-card';
  card.style.borderLeftColor = tariff.color || '#999';

  // Header with color and name
  const header = document.createElement('div');
  header.className = 'tariff-card-header';
  header.style.backgroundColor = tariff.color || '#999';
  
  const title = document.createElement('h4');
  title.textContent = tariff.name || tariff.id;
  title.style.color = 'white';
  title.style.margin = '0';
  
  const desc = document.createElement('p');
  desc.textContent = tariff.description || '';
  desc.style.color = 'rgba(255,255,255,0.9)';
  desc.style.fontSize = '0.85rem';
  desc.style.margin = '4px 0 0 0';
  
  header.appendChild(title);
  header.appendChild(desc);

  // Content
  const content = document.createElement('div');
  content.className = 'tariff-card-content';

  if (tariff.type === 'flat') {
    // Base tariff
    const row = document.createElement('div');
    row.className = 'tariff-row';
    row.innerHTML = `
      <span class="tariff-label">Tous horaires</span>
      <span class="tariff-price">${tariff.price?.toFixed(4) || '-'} €/kWh</span>
    `;
    content.appendChild(row);
  } else if (tariff.type === 'two-tier') {
    // HP/HC
    let hcRow = document.createElement('div');
    hcRow.className = 'tariff-row';
    hcRow.innerHTML = `
      <span class="tariff-label">Heures Creuses (${tariff.hcRange || '22-06'})</span>
      <span class="tariff-price">${tariff.phc?.toFixed(4) || '-'} €/kWh</span>
    `;
    content.appendChild(hcRow);

    let hpRow = document.createElement('div');
    hpRow.className = 'tariff-row';
    hpRow.innerHTML = `
      <span class="tariff-label">Heures Pleines</span>
      <span class="tariff-price">${tariff.php?.toFixed(4) || '-'} €/kWh</span>
    `;
    content.appendChild(hpRow);
  } else if (tariff.type === 'tempo') {
    // Tempo: 3 colors
    const colors = ['blue', 'white', 'red'];
    const pctLabels = { B: 'Bleu', W: 'Blanc', R: 'Rouge' };
    
    colors.forEach((color) => {
      const colorData = tariff[color];
      if (colorData) {
        const row = document.createElement('div');
        row.className = 'tariff-row';
        const label = pctLabels[color[0].toUpperCase()] || color;
        const pct = tariff.approxPct?.[color[0].toUpperCase()] 
          ? ` (${(tariff.approxPct[color[0].toUpperCase()] * 100).toFixed(0)}%)`
          : '';
        row.innerHTML = `
          <span class="tariff-label">${label}${pct}</span>
          <span class="tariff-prices">HC: ${colorData.hc?.toFixed(4) || '-'} | HP: ${colorData.hp?.toFixed(4) || '-'}</span>
        `;
        content.appendChild(row);
      }
    });
  } else if (tariff.type === 'three-tier') {
    // Total Charge Heures: HP/HC/HSC
    const ranges = [
      { name: 'Heures Pleines', price: tariff.php, range: tariff.hpRange },
      { name: 'Heures Creuses', price: tariff.phc, range: tariff.hcRange },
      { name: 'Heures Super Creuses', price: tariff.phsc, range: tariff.hscRange }
    ];
    
    ranges.forEach((r) => {
      if (r.price) {
        const row = document.createElement('div');
        row.className = 'tariff-row';
        row.innerHTML = `
          <span class="tariff-label">${r.name} ${r.range ? `(${r.range})` : ''}</span>
          <span class="tariff-price">${r.price.toFixed(4)} €/kWh</span>
        `;
        content.appendChild(row);
      }
    });
  }

  // Subscription info
  const subDiv = document.createElement('div');
  subDiv.className = 'tariff-subscription';
  
  const subTitle = document.createElement('strong');
  subTitle.textContent = 'Abonnements par puissance:';
  subDiv.appendChild(subTitle);
  
  const subList = document.createElement('div');
  subList.className = 'tariff-sub-list';
  
  for (const [kva, price] of Object.entries(tariff.subscriptions || {})) {
    const item = document.createElement('span');
    item.className = 'tariff-sub-item';
    item.textContent = `${kva} kVA: ${price.toFixed(2)} €/mois`;
    subList.appendChild(item);
  }
  
  subDiv.appendChild(subList);
  content.appendChild(subDiv);

  card.appendChild(header);
  card.appendChild(content);

  return card;
}

/**
 * Render all tariff cards
 * @param {Object} tariffData - Object containing tariff information by type
 * @param {Object} DEFAULTS - Current DEFAULTS
 * @param {HTMLElement} container - Container to render cards into
 */
export function renderTariffCards(tariffData, DEFAULTS, container) {
  if (!container) return;
  
  container.innerHTML = '';
  container.className = 'tariff-cards-grid';

  // Order: Base, HP/HC, Tempo, Total Charge, Injection
  const tariffOrder = ['base', 'hphc', 'tempo', 'totalCharge', 'injection'];
  
  tariffOrder.forEach((key) => {
    const tariff = tariffData[key];
    if (tariff && tariff.id !== 'injection') {
      const card = createTariffCard(tariff, DEFAULTS);
      container.appendChild(card);
    }
  });

  // Injection info as special card
  const injection = tariffData.injection;
  if (injection) {
    const injCard = document.createElement('div');
    injCard.className = 'tariff-card tariff-card-injection';
    injCard.style.borderLeftColor = injection.color || '#ff9f43';
    
    const header = document.createElement('div');
    header.className = 'tariff-card-header';
    header.style.backgroundColor = injection.color || '#ff9f43';
    
    const title = document.createElement('h4');
    title.textContent = 'Revenu Export (Injection)';
    title.style.color = 'white';
    title.style.margin = '0';
    
    const desc = document.createElement('p');
    desc.textContent = injection.description || '';
    desc.style.color = 'rgba(255,255,255,0.9)';
    desc.style.fontSize = '0.85rem';
    desc.style.margin = '4px 0 0 0';
    
    header.appendChild(title);
    header.appendChild(desc);
    
    const content = document.createElement('div');
    content.className = 'tariff-card-content';
    
    const row = document.createElement('div');
    row.className = 'tariff-row';
    row.innerHTML = `
      <span class="tariff-label">Prix du kWh injecté</span>
      <span class="tariff-price">${(injection.injectionPrice || 0).toFixed(4)} €/kWh</span>
    `;
    content.appendChild(row);
    
    injCard.appendChild(header);
    injCard.appendChild(content);
    container.appendChild(injCard);
  }
}

/**
 * Fetch and parse all tariff JSON files
 * @returns {Promise<Object>} Object with all tariff data
 */
export async function loadAllTariffFiles() {
  const tariffFiles = [
    { key: 'base', path: 'tariffs/base.json' },
    { key: 'hphc', path: 'tariffs/hphc.json' },
    { key: 'tempo', path: 'tariffs/tempo.json' },
    { key: 'totalCharge', path: 'tariffs/total-charge-heures.json' },
    { key: 'injection', path: 'tariffs/injection.json' }
  ];

  const tariffData = {};

  for (const { key, path } of tariffFiles) {
    try {
      const resp = await fetch(path, { cache: 'no-cache' });
      if (resp.ok) {
        tariffData[key] = await resp.json();
      }
    } catch (err) {
      console.warn(`Failed to load ${path}:`, err);
    }
  }

  return tariffData;
}
