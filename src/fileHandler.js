/**
 * fileHandler.js - File parsing, data validation, and record caching
 * Handles importing consumption files in JSON and CSV formats,
 * plus buildFileCacheKey / parseFilesToRecords / getRecordsFromCache.
 * @module fileHandler
 */

import { appState } from './state.js';
import { appendLog, getAnalysisLog } from './logger.js';

/**
 * Parse Enedis JSON format
 * @param {Object} json - Parsed JSON object from Enedis export
 * @returns {Array} Array of consumption records with dateDebut, dateFin, valeur
 */
export function parseEnedisJson(json) {
  if (!json || typeof json !== 'object') return [];
  
  // Enedis format: { cons: { aggregats: { heure: { donnees: [...] } } } }
  const donnees = json?.cons?.aggregats?.heure?.donnees || [];
  if (!Array.isArray(donnees)) return [];

  const parseValue = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;

    const normalized = value
      .trim()
      .replace(/\s+/g, '')
      .replace(/\u00A0/g, '')
      .replace(',', '.');

    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };

  // Normalize imported records so downstream computations can safely use Number(rec.valeur).
  const normalizedRecords = [];
  for (const rec of donnees) {
    if (!rec || typeof rec !== 'object') continue;
    if (!rec.dateDebut || !rec.dateFin) continue;

    const parsedValue = parseValue(rec.valeur);
    if (parsedValue == null) continue;

    normalizedRecords.push({
      dateDebut: rec.dateDebut,
      dateFin: rec.dateFin,
      valeur: parsedValue,
    });
  }

  return normalizedRecords;
}

/**
 * Parse CSV format (basic electricity consumption data)
 * Expected columns: dateDebut, dateFin, valeur (or Date, Duration, Consumption)
 * @param {string} csvText - Raw CSV text content
 * @returns {Array} Array of consumption records
 */
export function parseCSV(csvText) {
  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const dateIdx = header.findIndex(h => h.includes('date'));
  const valueIdx = header.findIndex(h => h.includes('valeur') || h.includes('consumption') || h.includes('conso'));
  
  if (dateIdx === -1 || valueIdx === -1) return [];
  
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    if (cells.length > Math.max(dateIdx, valueIdx)) {
      const dateStr = cells[dateIdx].trim();
      const valeur = parseFloat(cells[valueIdx]);
      
      if (dateStr && !isNaN(valeur)) {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          records.push({
            dateDebut: dateStr,
            dateFin: dateStr,
            valeur: valeur
          });
        }
      }
    }
  }
  
  return records;
}

/**
 * Deduplicate records by dateDebut during parsing (optimal approach)
 * @param {Array} records - Consumption records
 * @returns {Array} Deduplicated records
 */
export function deduplicateRecords(records) {
  const seen = new Map();
  const unique = [];
  
  for (const rec of records) {
    const key = rec.dateDebut;
    if (!seen.has(key)) {
      seen.set(key, true);
      unique.push(rec);
    }
  }
  
  return unique;
}

/**
 * Sort records by date
 * @param {Array} records - Consumption records
 * @returns {Array} Sorted records
 */
export function sortRecordsByDate(records) {
  return records.slice().sort((a, b) => {
    const dateA = new Date(a.dateDebut);
    const dateB = new Date(b.dateDebut);
    return dateA.getTime() - dateB.getTime();
  });
}

/**
 * Parse file input and extract records
 * @param {File} file - File object from input
 * @returns {Promise<Array>} Consumption records
 */
export async function parseFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file provided'));
    
    const reader = new FileReader();
    
    reader.onload = (event) => {
      try {
        const content = event.target.result;
        let records = [];
        
        if (file.name.endsWith('.json')) {
          const json = JSON.parse(content);
          records = parseEnedisJson(json);
        } else if (file.name.endsWith('.csv')) {
          records = parseCSV(content);
        } else {
          // Try JSON first, then CSV
          try {
            const json = JSON.parse(content);
            records = parseEnedisJson(json);
          } catch (e) {
            records = parseCSV(content);
          }
        }
        
        if (!records || records.length === 0) {
          return reject(new Error('No valid consumption data found in file'));
        }
        
        // Process: deduplicate -> sort -> return
        const deduplicated = deduplicateRecords(records);
        const sorted = sortRecordsByDate(deduplicated);
        
        resolve(sorted);
      } catch (error) {
        reject(new Error(`File parsing error: ${error.message}`));
      }
    };
    
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsText(file);
  });
}

/**
 * Parse multiple files
 * @param {FileList|Array} files - Files to parse
 * @returns {Promise<Array>} Combined consumption records
 */
export async function parseMultipleFiles(files) {
  if (!files || files.length === 0) {
    throw new Error('No files provided');
  }

  const allRecords = [];

  for (let i = 0; i < files.length; i++) {
    const records = await parseFile(files[i]);
    allRecords.push(...records);
  }

  // Final deduplication and sort across all files
  const deduplicated = deduplicateRecords(allRecords);
  const sorted = sortRecordsByDate(deduplicated);

  return sorted;
}

// ─── File caching ────────────────────────────────────────────────────────────

/**
 * Build a cache key from a FileList (name + size + lastModified)
 * @param {FileList} fileList
 * @returns {string}
 */
export function buildFileCacheKey(fileList) {
  return Array.from(fileList)
    .map(file => `${file.name}:${file.size}:${file.lastModified}`)
    .join('|');
}

/**
 * Parse a FileList to records, logging progress.
 * Handles JSON (Enedis) and CSV (via window.csvToEnedisJson) files.
 * @param {FileList} fileList
 * @returns {Promise<Array>} Sorted, deduplicated records
 */
export async function parseFilesToRecords(fileList) {
  const analysisLog = getAnalysisLog();
  const records = [];
  const csvFiles = [];
  const otherFiles = [];

  for (const file of fileList) {
    const name = (file.name || '').toLowerCase();
    appendLog(analysisLog, `Lecture: ${file.name}`);
    if (name.endsWith('.csv') || (file.type && file.type.toLowerCase().includes('csv'))) {
      csvFiles.push(file);
    } else if (name.endsWith('.json') || file.type.includes('json') || name.endsWith('.txt')) {
      otherFiles.push(file);
    } else {
      appendLog(analysisLog, `${file.name} ignoré (formats supportés: JSON/CSV).`);
    }
  }

  if (otherFiles.length > 0) {
    try {
      const parsed = await parseMultipleFiles(otherFiles);
      records.push(...parsed);
    } catch (err) {
      appendLog(analysisLog, `Erreur lecture fichiers JSON: ${err && err.message ? err.message : err}`);
    }
  }

  for (const file of csvFiles) {
    try {
      const txt = await file.text();
      if (typeof window.csvToEnedisJson !== 'function') throw new Error('convertisseur CSV indisponible');
      const json = window.csvToEnedisJson(txt);
      const donnees = json?.cons?.aggregats?.heure?.donnees;
      if (Array.isArray(donnees)) {
        for (const rec of donnees) {
          const val = Number(rec.valeur);
          if (Number.isNaN(val)) continue;
          records.push({ dateDebut: rec.dateDebut, dateFin: rec.dateFin, valeur: val });
        }
        appendLog(analysisLog, `Converti depuis CSV: ${donnees.length} enregistrements`);
      } else {
        appendLog(analysisLog, `CSV non reconnu: aucune donnée horaire trouvée dans ${file.name}`);
      }
    } catch (err) {
      appendLog(analysisLog, `Erreur conversion CSV (${file.name}): ${err && err.message ? err.message : err}`);
    }
  }

  const dedup = deduplicateRecords(records);
  const sorted = sortRecordsByDate(dedup);
  appendLog(analysisLog, `Total enregistrements valides: ${sorted.length}`);
  return sorted;
}

/**
 * Return records from cache if file list unchanged, otherwise re-parse.
 * @param {FileList} fileList
 * @returns {Promise<Array>}
 */
export async function getRecordsFromCache(fileList) {
  if (!fileList || fileList.length === 0) return [];
  const key = buildFileCacheKey(fileList);
  if (appState.recordsCacheKey === key && appState.records.length) {
    return appState.records;
  }
  const records = await parseFilesToRecords(fileList);
  appState.setState({ records, recordsCacheKey: key }, 'FILES_LOADED');
  return records;
}
