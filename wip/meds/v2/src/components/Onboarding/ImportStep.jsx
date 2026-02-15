import React, { useState } from 'react';
import { Upload, Check, AlertCircle, FileJson } from 'lucide-react';
import { useMedStore } from '../../store/useMedStore';
import { PRESET_MEDICATIONS } from '../../constants';

export default function ImportStep({ onComplete, onSkip }) {
    const [error, setError] = useState(null);
    const [importStats, setImportStats] = useState(null);
    const { addMedication, addLog, updateSettings, settings: currentSettings } = useMedStore();

    const handleFileUpload = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                processImport(data);
            } catch (err) {
                setError("Invalid JSON file. Please upload a valid export from the old site.");
                console.error(err);
            }
        };
        reader.readAsText(file);
    };

    const processImport = (data) => {
        // Validate basic structure
        if (!data.shotHistory && !data.weightHistory) {
            setError("No history data found in file.");
            return;
        }

        const stats = {
            medsCreated: 0,
            logsImported: 0,
            weightsImported: 0
        };

        // 1. Process Medications & Logs
        if (data.shotHistory && Array.isArray(data.shotHistory)) {
            // Group by medication name to create Med objects
            const shotsByMed = {};

            data.shotHistory.forEach(shot => {
                const name = shot.medication || 'Unknown';
                if (!shotsByMed[name]) shotsByMed[name] = [];
                shotsByMed[name].push(shot);
            });

            Object.keys(shotsByMed).forEach(medName => {
                // Check if matches preset (case-insensitive)
                const presetKey = Object.keys(PRESET_MEDICATIONS).find(k => PRESET_MEDICATIONS[k].name.toLowerCase() === medName.toLowerCase());

                const medId = crypto.randomUUID();
                let medData = {
                    id: medId,
                    name: medName,
                    active: true,
                    archived: false,
                    // Default Fallbacks
                    color: '#94a3b8',
                    halfLife: 0,
                    units: 'mg',
                    defaultDoses: [2.5, 5, 7.5, 10, 12.5, 15] // Generic guess
                };

                if (presetKey) {
                    medData = { ...medData, ...PRESET_MEDICATIONS[presetKey] };
                } else if (medName.toLowerCase().includes('mounjaro') || medName.toLowerCase().includes('tirzepatide')) {
                    medData = { ...medData, ...PRESET_MEDICATIONS['mounjaro'] };
                } else if (medName.toLowerCase().includes('wegovy') || medName.toLowerCase().includes('semaglutide') || medName.toLowerCase().includes('ozempic')) {
                    medData = { ...medData, ...PRESET_MEDICATIONS['wegovy'] };
                }

                // Create Med
                addMedication(medData);
                stats.medsCreated++;

                // Create Logs
                shotsByMed[medName].forEach(shot => {
                    addLog({
                        id: crypto.randomUUID(),
                        medId: medId,
                        medication: medName,
                        dose: parseFloat(shot.dose),
                        date: new Date(shot.dateTime).toISOString(),
                        location: shot.location || null,
                        type: 'imported'
                    });
                    stats.logsImported++;
                });
            });
        }

        // 2. Process Weight
        // We need to access the store state properly for this. 
        // Actually, useMedStore exposes `setState` logic via actions, but weightHistory is simple array.
        // We need a specific action for bulk importing weight? 
        // Or just assume `loadData` handles it?
        // Wait, define `importWeight` in store or just use `useMedStore.setState`?
        // Let's add an action to store for this or just hack it here if we exported setState?
        // `useMedStore` hook returns bindings. We need to add `addWeightEntry` or `setWeightHistory`.

        if (data.weightHistory && Array.isArray(data.weightHistory)) {
            // We need to implement this in the store. 
            // For now, let's just log it and maybe direct manipulate if store allows?
            // I'll add a `importData` action to the store in the next step to handle this cleanly.
            useMedStore.getState().importWeights(data.weightHistory.map(w => ({
                date: new Date(w.dateTime).toISOString(),
                weight: parseFloat(w.weightKg)
            })));
            stats.weightsImported = data.weightHistory.length;
        }

        // 3. Settings
        if (data.userSettings) {
            updateSettings(data.userSettings);
        }

        setImportStats(stats);
    };

    if (importStats) {
        return (
            <div className="space-y-6 text-center animate-in fade-in zoom-in duration-300">
                <div className="w-16 h-16 bg-green-900/30 rounded-full flex items-center justify-center mx-auto border border-green-500/50">
                    <Check size={32} className="text-green-500" />
                </div>
                <h2 className="text-2xl font-bold text-white">Import Successful!</h2>
                <div className="bg-slate-900 rounded-xl p-4 space-y-2 text-sm text-slate-300">
                    <p>Created <span className="text-white font-bold">{importStats.medsCreated}</span> medications</p>
                    <p>Imported <span className="text-white font-bold">{importStats.logsImported}</span> dose entries</p>
                    <p>Imported <span className="text-white font-bold">{importStats.weightsImported}</span> weight entries</p>
                </div>
                <button
                    onClick={onComplete}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-lg font-bold"
                >
                    Continue to Dashboard
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="text-center space-y-2">
                <h2 className="text-xl font-semibold text-white">Import Existing Data</h2>
                <p className="text-slate-400 text-sm">
                    If you have a JSON backup file from the old version of the site, you can restore it here.
                </p>
            </div>

            <div className="border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-xl p-8 transition-colors bg-slate-900/50">
                <label className="flex flex-col items-center cursor-pointer">
                    <Upload size={32} className="text-slate-400 mb-2" />
                    <span className="text-blue-400 font-medium hover:text-blue-300">Click to Upload JSON</span>
                    <span className="text-slate-600 text-xs mt-1">.json files only</span>
                    <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
                </label>
            </div>

            {error && (
                <div className="p-3 bg-red-900/20 border border-red-900/50 rounded-lg flex items-center gap-2 text-red-200 text-sm">
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            <div className="pt-4 border-t border-slate-800">
                <button onClick={onSkip} className="w-full text-slate-500 hover:text-white py-2 text-sm">
                    Skip Import
                </button>
            </div>
        </div>
    );
}
