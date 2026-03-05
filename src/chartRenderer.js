/**
 * chartRenderer.js - Chart rendering and management module
 * Handles creation, updating, and destruction of Chart.js instances
 * @module chartRenderer
 */

import { isHourHC } from './utils.js';

// Global chart instances cache (instead of window.chartName)
const chartInstances = {
  hourly: null,
  hpHc: null,
  monthly: null,
  monthlySavings: null,
  pvPower: null,
  pricePv: null,
  offers: null
};

/**
 * Get or create a chart instance
 * @param {string} name - Chart identifier
 * @returns {Chart|null} Chart instance
 */
export function getChartInstance(name) {
  return chartInstances[name] || null;
}

/**
 * Store a chart instance
 * @param {string} name - Chart identifier
 * @param {Chart} chart - Chart.js instance
 */
export function setChartInstance(name, chart) {
  chartInstances[name] = chart;
}

/**
 * Update chart data and refresh (instead of destroy/recreate)
 * @param {string} name - Chart identifier
 * @param {Object} newData - New chart data
 */
export function updateChart(name, newData) {
  const chart = chartInstances[name];
  if (!chart) return;
  
  chart.data = newData;
  chart.update('none'); // Skip animation for performance
}

/**
 * Destroy a specific chart instance
 * @param {string} name - Chart identifier
 */
export function destroyChart(name) {
  const chart = chartInstances[name];
  if (chart) {
    chart.destroy();
    chartInstances[name] = null;
  }
}

/**
 * Destroy all chart instances
 */
export function destroyAllCharts() {
  Object.keys(chartInstances).forEach(key => {
    destroyChart(key);
  });
}

/**
 * Render hourly consumption profile chart
 * @param {Object} stats - Hourly statistics {hourly: [], max: [], min: [], avg: []}
 * @param {HTMLElement} canvasElement - Canvas element
 * @returns {Chart} Chart instance
 */
export function renderHourlyChart(stats, canvasElement) {
  if (!canvasElement) return null;
  
  destroyChart('hourly');
  
  const ctx = canvasElement.getContext('2d');
  const avg = stats.hourly || [];
  const min = stats.min || [];
  const max = stats.max || [];
  const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}h`);
  
  const chart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Moyenne (kWh)', data: avg, backgroundColor: 'rgba(54,162,235,0.6)', yAxisID: 'y' },
        { type: 'line', label: 'Min (kWh)', data: min, borderColor: 'rgba(75,192,192,0.9)', borderWidth: 2, fill: false, yAxisID: 'y' },
        { type: 'line', label: 'Max (kWh)', data: max, borderColor: 'rgba(255,99,132,0.9)', borderWidth: 2, fill: false, yAxisID: 'y' }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      scales: { y: { beginAtZero: true, title: { display: true, text: 'kWh' } } },
      plugins: { datalabels: { display: false } }
    }
  });
  
  setChartInstance('hourly', chart);
  return chart;
}

/**
 * Render HP/HC breakdown pie chart
 * @param {Array} records - Consumption records
 * @param {Object} hcRange - HC time range config
 * @param {HTMLElement} canvasElement - Canvas element
 * @returns {Chart} Chart instance
 */
export function renderHpHcPie(records, hcRange, canvasElement) {
  if (!canvasElement || !records) return null;
  
  destroyChart('hpHc');
  
  let hpTotal = 0;
  let hcTotal = 0;
  
  for (const rec of records) {
    const date = new Date(rec.dateDebut);
    const hour = date.getHours();
    const value = Number(rec.valeur) || 0;
    
    if (isHourHC(hour, hcRange)) {
      hcTotal += value;
    } else {
      hpTotal += value;
    }
  }

  const total = hpTotal + hcTotal;
  const hpPct = total > 0 ? Math.round((hpTotal / total) * 1000) / 10 : 0;
  const hcPct = total > 0 ? Math.round((hcTotal / total) * 1000) / 10 : 0;
  
  const ctx = canvasElement.getContext('2d');
  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: [`Heures Pleines (${hpPct}%)`, `Heures Creuses (${hcPct}%)`],
      datasets: [
        {
          data: [hpTotal, hcTotal],
          backgroundColor: ['#f28e2b', '#59a14f'],
          borderColor: 'var(--bg-card)',
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        datalabels: {
          color: 'white',
          font: { weight: 'bold' },
          formatter: (value, context) => {
            const total = context.dataset.data.reduce((a, b) => a + b);
            const percent = ((value / total) * 100).toFixed(1);
            return `${percent}%`;
          }
        }
      }
    }
  });
  
  setChartInstance('hpHc', chart);
  return chart;
}

/**
 * Render offers comparison bar chart
 * @param {Array} offers - Offers with cost data
 * @param {boolean} isPvEnabled - Include PV comparison
 * @param {HTMLElement} canvasElement - Canvas element
 * @returns {Chart} Chart instance
 */
export function renderOffersChart(offers, isPvEnabled, canvasElement) {
  if (!canvasElement || !offers) return null;
  
  destroyChart('offers');
  
  const ctx = canvasElement.getContext('2d');
  const labels = [];
  const values = [];
  
  // Consistent color mapping based on offer ID
  const getOfferColor = (offerId) => {
    const colorMap = {
      'base': '#4e79a7',
      'hphc': '#f28e2b',
      'tempo': '#59a14f',
      'tempoOpt': '#117a8b',
      'tch': '#d62728'
    };
    return colorMap[offerId] || '#a0cbe8';
  };
  
  const colors = [];
  
  offers.forEach((ofr) => {
    // Use color from offer metadata if available, otherwise fallback to mapping
    const offerColor = ofr.color || getOfferColor(ofr.id);
    if (isPvEnabled) {
      labels.push(`${ofr.name} (sans PV)`);
      labels.push(`${ofr.name} (avec PV)`);
      values.push(ofr.costNoPV);
      values.push(ofr.costWithPV);
      colors.push(offerColor);
      colors.push(offerColor);
    } else {
      labels.push(ofr.name);
      values.push(ofr.costNoPV);
      colors.push(offerColor);
    }
  });
  
  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Coût annuel (€)',
          data: values,
          backgroundColor: colors
        }
      ]
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true } }
    }
  });
  
  setChartInstance('offers', chart);
  return chart;
}
