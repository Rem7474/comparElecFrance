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
  const avg = stats.avg || stats.hourly || [];
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
  
  const ctx = canvasElement.getContext('2d');
  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Heures Pleines', 'Heures Creuses'],
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
 * Render monthly comparison chart
 * @param {Array} data - Monthly breakdown data
 * @param {Array} labels - Month labels
 * @param {HTMLElement} canvasElement - Canvas element
 * @returns {Chart} Chart instance
 */
export function renderMonthlyChart(data, labels, canvasElement) {
  if (!canvasElement) return null;
  
  destroyChart('monthly');
  
  const ctx = canvasElement.getContext('2d');
  const datasets = [
    {
      label: 'Base',
      data: data.map(m => m.base?.total),
      backgroundColor: '#4e79a7'
    },
    {
      label: 'HP/HC',
      data: data.map(m => m.hphc?.total),
      backgroundColor: '#f28e2b'
    },
    {
      label: 'Tempo',
      data: data.map(m => m.tempo?.total),
      backgroundColor: '#59a14f'
    }
  ];
  
  const chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      scales: {
        y: { beginAtZero: true }
      },
      interaction: { mode: 'index' }
    }
  });
  
  setChartInstance('monthly', chart);
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
  const bgColors = ['#4e79a7', '#f28e2b', '#59a14f', '#d62728', '#117a8b'];
  const colors = [];
  
  offers.forEach((ofr, idx) => {
    if (isPvEnabled) {
      labels.push(`${ofr.name} (sans PV)`);
      labels.push(`${ofr.name} (avec PV)`);
      values.push(ofr.costNoPV);
      values.push(ofr.costWithPV);
      colors.push(bgColors[idx % bgColors.length]);
      colors.push(bgColors[(idx + 1) % bgColors.length]);
    } else {
      labels.push(ofr.name);
      values.push(ofr.costNoPV);
      colors.push(bgColors[idx % bgColors.length]);
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

/**
 * Render PV production breakdown
 * @param {Array} data - Monthly data with PV info
 * @param {Array} labels - Month labels
 * @param {HTMLElement} canvasElement - Canvas element
 * @returns {Chart} Chart instance
 */
export function renderPvChart(data, labels, canvasElement) {
  if (!canvasElement) return null;
  
  destroyChart('pvPower');
  
  const ctx = canvasElement.getContext('2d');
  const datasets = [
    {
      label: 'Production PV (kWh)',
      data: data.map(m => m.monthPV),
      backgroundColor: '#f1c40f'
    },
    {
      label: 'Autoconsommation (kWh)',
      data: data.map(m => m.monthSelf),
      backgroundColor: '#4e79a7'
    },
    {
      label: 'Injection (kWh)',
      data: data.map(m => Math.max(0, (m.monthPV || 0) - (m.monthSelf || 0))),
      backgroundColor: '#ff9f43'
    }
  ];
  
  const chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true } }
    }
  });
  
  setChartInstance('pvPower', chart);
  return chart;
}

/**
 * Export chart as image
 * @param {string} name - Chart identifier
 * @param {string} filename - Output filename
 */
export function exportChartAsImage(name, filename = 'chart.png') {
  const chart = chartInstances[name];
  if (!chart) return;
  
  const image = chart.toBase64Image();
  const link = document.createElement('a');
  link.href = image;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Create a responsive canvas wrapper
 * @param {string} containerId - Container element ID
 * @param {number} width - Default width
 * @param {number} height - Default height
 * @returns {HTMLCanvasElement} Canvas element
 */
export function createCanvas(containerId, width = 400, height = 300) {
  const container = document.getElementById(containerId);
  if (!container) return null;
  
  container.innerHTML = `<canvas style="max-width: 100%; height: auto;"></canvas>`;
  const canvas = container.querySelector('canvas');
  
  return canvas;
}
