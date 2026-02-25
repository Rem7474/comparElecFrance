class AppStateManager {
  constructor() {
    this.listeners = [];
    this.state = {
      records: [],
      recordsCacheKey: null,
      tariffs: {},
      tempoDayMap: null,
      tempoSourceMap: null,
      detectedKva: null,
      currentKva: 6
    };
  }

  getState() { return { ...this.state }; }

  setState(updates, reason = '') {
    const hasChanges = Object.keys(updates).some(k => this.state[k] !== updates[k]);
    if (!hasChanges) return;
    this.state = { ...this.state, ...updates };
    this.listeners.forEach(cb => { try { cb(this.state, updates, reason); } catch (e) { /* ignore */ } });
  }

  subscribe(callback) {
    this.listeners.push(callback);
    return () => { this.listeners = this.listeners.filter(l => l !== callback); };
  }

  // Convenience getters for backward compatibility
  get records() { return this.state.records; }
  get recordsCacheKey() { return this.state.recordsCacheKey; }
  get tempoDayMap() { return this.state.tempoDayMap; }
  get detectedKva() { return this.state.detectedKva; }
  get currentKva() { return this.state.currentKva; }
}

export const appState = new AppStateManager();
