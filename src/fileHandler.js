/**
 * fileHandler.js - File parsing and data validation module
 * Handles importing consumption files in JSON and CSV formats
 * @module fileHandler
 */

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
  
  return donnees;
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

/**
 * Validate consumption record structure
 * @param {Object} record - Consumption record
 * @returns {boolean} True if valid
 */
export function isValidRecord(record) {
  return (
    record &&
    typeof record === 'object' &&
    record.dateDebut &&
    typeof record.valeur === 'number' &&
    record.valeur >= 0
  );
}

/**
 * Cache records in localStorage with versioning
 * @param {Array} records - Consumption records
 * @param {string} cacheKey - Storage key
 * @param {string} checksum - File checksum for validation
 * @returns {boolean} Success
 */
export function cacheRecords(records, cacheKey, checksum) {
  try {
    const cached = {
      version: 1,
      timestamp: new Date().toISOString(),
      checksum,
      count: records.length,
      data: records
    };
    
    localStorage.setItem(
      `comparatifElec.${cacheKey}`,
      JSON.stringify(cached)
    );
    
    return true;
  } catch (error) {
    console.warn('Cache write failed:', error);
    return false;
  }
}

/**
 * Retrieve cached records
 * @param {string} cacheKey - Storage key
 * @param {string} checksum - Expected file checksum
 * @returns {Array|null} Cached records if valid, null otherwise
 */
export function getCachedRecords(cacheKey, checksum) {
  try {
    const json = localStorage.getItem(`comparatifElec.${cacheKey}`);
    if (!json) return null;
    
    const cached = JSON.parse(json);
    
    // Validate cache
    if (cached.version !== 1 || cached.checksum !== checksum) {
      return null;
    }
    
    // Age check (1 week)
    const age = new Date() - new Date(cached.timestamp);
    if (age > 7 * 24 * 60 * 60 * 1000) {
      return null;
    }
    
    return cached.data || null;
  } catch (error) {
    console.warn('Cache read failed:', error);
    return null;
  }
}

/**
 * Compute simple checksum of file for cache validation
 * This is a simple hash, not for security purposes
 * @param {string} content - File content
 * @returns {string} Checksum
 */
export function computeFileChecksum(content) {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}
