/**
 * exportManager.js - Export functionality for analysis results
 * Handles PDF, Excel, and shareable link generation
 * @module exportManager
 */

/**
 * Export analysis results as PDF with charts and tables
 * Requires: jsPDF and html2canvas libraries (loaded via CDN)
 * @param {Object} analysisData - Complete analysis results including charts
 * @param {Object} consumptionData - Consumption records and statistics
 * @param {Array} offers - Array of offer calculations with costs
 * @returns {Promise<void>} Downloads PDF file
 */
export async function exportToPDF(analysisData, consumptionData, offers) {
  try {
    // Check if jsPDF is available
    if (typeof window.jsPDF === 'undefined') {
      console.error('jsPDF library not loaded. Please include it via CDN.');
      alert('Erreur: Bibliothèque jsPDF non chargée. Contactez support.');
      return;
    }

    const { jsPDF } = window;
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    let yPosition = margin;

    // Title
    pdf.setFontSize(18);
    pdf.text('Analyse Consommation Électrique', margin, yPosition);
    yPosition += 10;

    // Date and summary
    pdf.setFontSize(10);
    const analysisDate = new Date().toLocaleDateString('fr-FR');
    pdf.text(`Rapport généré le: ${analysisDate}`, margin, yPosition);
    yPosition += 7;

    if (consumptionData?.total) {
      pdf.text(
        `Consommation annuelle: ${consumptionData.total.toFixed(0)} kWh`,
        margin,
        yPosition
      );
      yPosition += 7;
    }

    // Section: Key Metrics
    yPosition += 5;
    pdf.setFontSize(12);
    pdf.text('📊 RÉSUMÉ KEY METRICS', margin, yPosition);
    yPosition += 8;

    pdf.setFontSize(9);
    if (analysisData?.annualSummary) {
      const summary = analysisData.annualSummary;
      pdf.text(`Coût annuel (offre Base): ${summary.costBase?.toFixed(2) || 'N/A'} €`, margin, yPosition);
      yPosition += 5;
      pdf.text(`Consommation annuelle: ${summary.annualConsumption?.toFixed(0) || 'N/A'} kWh`, margin, yPosition);
      yPosition += 5;
      pdf.text(`Économies PV estimées: ${summary.pvSavings?.toFixed(2) || 'N/A'} €`, margin, yPosition);
      yPosition += 5;
    }

    // Section: Offers Comparison Table
    yPosition += 8;
    pdf.setFontSize(12);
    pdf.text('💰 COMPARAISON DES OFFRES', margin, yPosition);
    yPosition += 8;

    if (offers && offers.length > 0) {
      const tableData = offers.slice(0, 8).map(ofr => [
        ofr.name || 'N/A',
        ofr.costNoPV?.toFixed(2) || 'N/A',
        ofr.costWithPV?.toFixed(2) || 'N/A',
        (ofr.savings || 0).toFixed(2)
      ]);

      pdf.setFontSize(8);
      pdf.autoTable({
        startY: yPosition,
        head: [['Offre', 'Coût (€)', 'Avec PV (€)', 'Économies (€)']],
        body: tableData,
        margin: margin,
        styles: {
          fontSize: 8,
          cellPadding: 2
        },
        headStyles: {
          fillColor: [41, 128, 185],
          textColor: 255,
          fontStyle: 'bold'
        },
        alternateRowStyles: {
          fillColor: [240, 240, 240]
        }
      });

      yPosition = pdf.lastAutoTable.finalY + 10;
    }

    // Section: PV Simulation Info (if available)
    if (analysisData?.pvConfig) {
      if (yPosition > pageHeight - 40) {
        pdf.addPage();
        yPosition = margin;
      }

      pdf.setFontSize(12);
      pdf.text('☀️ SIMULATION PHOTOVOLTAÏQUE', margin, yPosition);
      yPosition += 8;

      pdf.setFontSize(9);
      const pv = analysisData.pvConfig;
      pdf.text(`Puissance installée: ${pv.kwp || 'N/A'} kWp`, margin, yPosition);
      yPosition += 5;
      pdf.text(`Région: ${pv.region || 'N/A'}`, margin, yPosition);
      yPosition += 5;
      pdf.text(`Production annuelle estimée: ${pv.annualProduction?.toFixed(0) || 'N/A'} kWh`, margin, yPosition);
      yPosition += 5;
      pdf.text(`Taux autoconsommation: ${(pv.autoconsumptionRate * 100)?.toFixed(1) || 'N/A'}%`, margin, yPosition);
      yPosition += 5;
    }

    // Add footer with disclaimer
    pdf.setFontSize(7);
    pdf.text(
      'Cet rapport est généré automatiquement. Les informations sont à titre indicatif.',
      margin,
      pageHeight - 5
    );

    // Save PDF
    pdf.save(`analyse-electricite-${analysisDate.replace(/\//g, '-')}.pdf`);
  } catch (error) {
    console.error('Erreur lors de l\'export PDF:', error);
    alert('Erreur lors de la génération du PDF. Veuillez réessayer.');
  }
}

/**
 * Export analysis results as Excel workbook with multiple sheets
 * Requires: XLSX library (xlsx.js loaded via CDN)
 * @param {Object} analysisData - Complete analysis results
 * @param {Array} monthlyBreakdown - Monthly cost breakdown per tariff
 * @param {Array} offers - Array of offer calculations
 * @returns {Promise<void>} Downloads Excel file
 */
export async function exportToExcel(analysisData, monthlyBreakdown, offers) {
  try {
    // Check if XLSX is available
    if (typeof window.XLSX === 'undefined') {
      console.error('XLSX library not loaded. Please include it via CDN.');
      alert('Erreur: Bibliothèque XLSX non chargée. Contactez support.');
      return;
    }

    const XLSX = window.XLSX;

    // Sheet 1: Summary
    const summaryData = [
      ['RÉSUMÉ DE L\'ANALYSE ÉLECTRIQUE'],
      [],
      ['Date de rapport', new Date().toLocaleDateString('fr-FR')],
      ['Consommation annuelle (kWh)', analysisData?.annualConsumption || 'N/A'],
      ['Coût annuel (offre Base)', analysisData?.costBase || 'N/A'],
      ['Économies PV estimées', analysisData?.pvSavings || 'N/A'],
      []
    ];

    // Sheet 2: Offers Comparison
    const offersData = [
      ['COMPARAISON OFFRES'],
      ['Offre', 'Coût sans PV (€)', 'Coût avec PV (€)', 'Économies (€)', 'Couleur']
    ];

    if (offers && offers.length > 0) {
      offers.forEach(ofr => {
        offersData.push([
          ofr.name || 'N/A',
          ofr.costNoPV?.toFixed(2) || 'N/A',
          ofr.costWithPV?.toFixed(2) || 'N/A',
          (ofr.savings || 0).toFixed(2),
          ofr.color || ''
        ]);
      });
    }

    // Sheet 3: Monthly Breakdown
    const monthlyData = [
      ['VENTILATION MENSUELLE'],
      ['Mois', 'Consommation (kWh)', ...offers.map(o => o.name || 'Offre')]
    ];

    if (monthlyBreakdown && Array.isArray(monthlyBreakdown)) {
      monthlyBreakdown.forEach(row => {
        const rowData = [row.month || 'N/A', row.consumption?.toFixed(1) || 'N/A'];
        offers.forEach(ofr => {
          const monthlyCost = row[ofr.id] || row[ofr.name?.toLowerCase()] || 0;
          rowData.push(monthlyCost.toFixed(2));
        });
        monthlyData.push(rowData);
      });
    }

    // Sheet 4: Raw Data (if available)
    const rawData = [
      ['DONNÉES BRUTES HORAIRES'],
      ['Date', 'Heure', 'Consommation (kWh)']
    ];

    if (analysisData?.rawRecords && Array.isArray(analysisData.rawRecords)) {
      analysisData.rawRecords.slice(0, 365).forEach(rec => {
        const date = new Date(rec.dateDebut);
        rawData.push([
          date.toLocaleDateString('fr-FR'),
          date.getHours() + 'h',
          (Number(rec.valeur) || 0).toFixed(3)
        ]);
      });
    }

    // Create workbook with multiple sheets
    const workbook = XLSX.utils.book_new();
    
    const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, ws1, 'Résumé');

    const ws2 = XLSX.utils.aoa_to_sheet(offersData);
    XLSX.utils.book_append_sheet(workbook, ws2, 'Offres');

    const ws3 = XLSX.utils.aoa_to_sheet(monthlyData);
    XLSX.utils.book_append_sheet(workbook, ws3, 'Mensuel');

    const ws4 = XLSX.utils.aoa_to_sheet(rawData);
    XLSX.utils.book_append_sheet(workbook, ws4, 'Données Brutes');

    // Set column widths
    ws1['!cols'] = [{ wch: 30 }, { wch: 20 }];
    ws2['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 15 }, { wch: 15 }];
    ws3['!cols'] = [{ wch: 15 }, { wch: 18 }, { wch: 18 }];
    ws4['!cols'] = [{ wch: 15 }, { wch: 12 }, { wch: 18 }];

    // Save Excel
    const fileName = `analyse-electricite-${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  } catch (error) {
    console.error('Erreur lors de l\'export Excel:', error);
    alert('Erreur lors de la génération du fichier Excel. Veuillez réessayer.');
  }
}

/**
 * Save analysis to browser localStorage for later retrieval
 * @param {Object} analysisData - Complete analysis results
 * @param {string} label - User-given label for this analysis
 * @returns {Object} Saved analysis with timestamp and ID
 */
export function saveToHistory(analysisData, label = '') {
  try {
    const history = JSON.parse(localStorage.getItem('analysisHistory') || '[]');
    
    const record = {
      id: `analysis_${Date.now()}`,
      timestamp: new Date().toISOString(),
      label: label || `Analyse ${new Date().toLocaleDateString('fr-FR')}`,
      data: {
        annualConsumption: analysisData?.annualConsumption,
        costBase: analysisData?.costBase,
        pvSavings: analysisData?.pvSavings,
        temperature: analysisData?.temperature,
        offers: analysisData?.offers?.map(o => ({
          name: o.name,
          costNoPV: o.costNoPV,
          costWithPV: o.costWithPV
        }))
      }
    };

    history.push(record);

    // Keep only last 20 analyses
    if (history.length > 20) {
      history.shift();
    }

    localStorage.setItem('analysisHistory', JSON.stringify(history));
    return record;
  } catch (error) {
    console.error('Erreur lors de la sauvegarde dans l\'historique:', error);
    return null;
  }
}

/**
 * Retrieve analysis history from localStorage
 * @returns {Array} Array of saved analyses with timestamps
 */
export function getAnalysisHistory() {
  try {
    return JSON.parse(localStorage.getItem('analysisHistory') || '[]');
  } catch (error) {
    console.error('Erreur lors de la récupération de l\'historique:', error);
    return [];
  }
}

/**
 * Delete a specific analysis from history
 * @param {string} analysisId - ID of analysis to delete
 * @returns {boolean} Success status
 */
export function deleteFromHistory(analysisId) {
  try {
    const history = JSON.parse(localStorage.getItem('analysisHistory') || '[]');
    const filtered = history.filter(a => a.id !== analysisId);
    localStorage.setItem('analysisHistory', JSON.stringify(filtered));
    return true;
  } catch (error) {
    console.error('Erreur lors de la suppression:', error);
    return false;
  }
}

/**
 * Generate shareable URL with encoded analysis data
 * Note: For production, use backend API to generate shortlinks
 * @param {Object} analysisData - Analysis results to share
 * @returns {string} URL with encoded data (base64)
 */
export function generateShareableLink(analysisData) {
  try {
    const shareData = {
      consumption: analysisData?.annualConsumption,
      region: analysisData?.pvConfig?.region,
      offers: analysisData?.offers?.map(o => ({
        name: o.name,
        cost: o.costNoPV,
        costWithPV: o.costWithPV
      }))
    };

    const encoded = btoa(JSON.stringify(shareData));
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?share=${encoded}`;
  } catch (error) {
    console.error('Erreur lors de la génération du lien:', error);
    return null;
  }
}

/**
 * Parse shared analysis from URL parameter
 * @returns {Object|null} Decoded analysis data or null if not found
 */
export function parseSharedAnalysis() {
  try {
    const params = new URLSearchParams(window.location.search);
    const shareParam = params.get('share');
    
    if (!shareParam) return null;
    
    return JSON.parse(atob(shareParam));
  } catch (error) {
    console.error('Erreur lors du parsing du lien partagé:', error);
    return null;
  }
}
