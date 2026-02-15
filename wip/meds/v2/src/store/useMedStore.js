import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { AuthManager } from '../utils/AuthManager';
import { defaultSettings, APP_NAME, ENVIRONMENT } from '../constants';

const authManager = new AuthManager(APP_NAME, ENVIRONMENT);

export const useMedStore = create(
  persist(
    (set, get) => ({
      // --- State ---
      user: null,
      settings: defaultSettings,
      medications: [], // Array of { id, name, ... }
      logs: [], // Array of { id, medId, date, dose }
      weightHistory: [],
      
      // UI State
      isLoading: true,
      lastSyncTime: null,

      // --- Actions ---
      setUser: (user) => set({ user }),
      
      // Settings
      updateSettings: (newSettings) => set(state => ({ 
        settings: { ...state.settings, ...newSettings } 
      })),

      // Medications
      addMedication: (med) => {
        set(state => ({ 
          medications: [...state.medications, { ...med, id: med.id || crypto.randomUUID(), active: true, archived: false }] 
        }));
        get().saveData();
      },
      
      updateMedication: (id, updates) => {
        set(state => ({
          medications: state.medications.map(m => m.id === id ? { ...m, ...updates } : m)
        }));
        get().saveData();
      },

      deleteMedication: (id) => {
        set(state => ({
          medications: state.medications.map(m => m.id === id ? { ...m, active: false, deletedAt: new Date().toISOString() } : m)
        }));
        get().saveData();
      },

      restoreMedication: (id) => {
        set(state => ({
          medications: state.medications.map(m => m.id === id ? { ...m, active: true, deletedAt: null } : m)
        }));
        get().saveData();
      },

      permanentlyDeleteMedication: (id) => {
        set(state => ({
          medications: state.medications.filter(m => m.id !== id),
          logs: state.logs.filter(l => l.medId !== id) // Cleanup logs too
        }));
        get().saveData();
      },

      // Logs (Doses)
      addLog: (log) => {
        set(state => ({
          logs: [...state.logs, { ...log, id: crypto.randomUUID(), timestamp: new Date().toISOString() }]
        }));
        get().saveData();
      },

      deleteLog: (id) => {
        set(state => ({
          logs: state.logs.filter(l => l.id !== id)
        }));
        get().saveData();
      },

      // Sync / Data Management
      loadData: async () => {
        set({ isLoading: true });
        try {
            await authManager.initialize();
            const user = authManager.currentUser;
            set({ user });

            if (user) {
                // Fetch from backend
                try {
                    const response = await authManager.fetchWithAuth(authManager.endpoints.data, { method: 'GET' });
                    if (response.ok) {
                        const data = await response.json();
                        // Merge backend data with local or overwrite? 
                        // For now, overwrite if backend exists (simple sync)
                        if (data) {
                            set({
                                medications: data.medications || [],
                                logs: data.logs || [],
                                weightHistory: data.weightHistory || [],
                                settings: { ...defaultSettings, ...(data.settings || {}) },
                                lastSyncTime: new Date().toISOString()
                            });
                        }
                    }
                } catch (err) {
                    console.error("Failed to fetch backend data:", err);
                    // Fallback to local handled by persist middleware automatically?
                    // Actually persist middleware loads generic storage on init.
                    // This function is for explicit backend sync.
                }
            }
        } catch (e) {
            console.error("Load data error", e);
        } finally {
            set({ isLoading: false });
        }
      },

      saveData: async () => {
        const state = get();
        if (!state.user) return; // Only sync if logged in

        const dataToSave = {
            medications: state.medications,
            logs: state.logs,
            weightHistory: state.weightHistory,
            settings: state.settings,
            lastUpdated: new Date().toISOString()
        };

        try {
            await authManager.fetchWithAuth(authManager.endpoints.data, {
                method: 'POST',
                body: JSON.stringify(dataToSave)
            });
            set({ lastSyncTime: new Date().toISOString() });
        } catch (e) {
            console.error("Failed to save to backend", e);
        }
      },
      
      // Import Actions
      importWeights: (weights) => {
          set({ weightHistory: weights });
          get().saveData();
      }
    }),
    {
      name: 'med-tracker-storage', // name of item in the storage (must be unique)
      storage: createJSONStorage(() => localStorage), // (optional) by default, 'localStorage' is used
      partialize: (state) => ({ 
          medications: state.medications, 
          logs: state.logs, 
          weightHistory: state.weightHistory, 
          settings: state.settings 
      }), // Only persist data, not UI state
    }
  )
);
