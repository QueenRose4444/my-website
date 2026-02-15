import React, { useState, useMemo } from 'react';
import { addDays, subDays, format, differenceInDays } from 'date-fns';
import { Check, AlertCircle } from 'lucide-react';

export default function HistoryEstimator({ medication, onConfirm, onSkip }) {
    const [hasStarted, setHasStarted] = useState(null); // null, true, false
    const [currentDose, setCurrentDose] = useState(medication.defaultDoses ? medication.defaultDoses[0] : '');
    const [startDate, setStartDate] = useState(format(subDays(new Date(), 28), 'yyyy-MM-dd'));
    const [frequency, setFrequency] = useState(7); // Days
    const [estimationMode, setEstimationMode] = useState('simple'); // 'simple' (auto-ramp) or 'manual' (not implemented yet)

    // Logic to generate proposed history
    const proposedLogs = useMemo(() => {
        if (!hasStarted) return [];

        const logs = [];
        const start = new Date(startDate);
        const now = new Date();
        const daysDiff = differenceInDays(now, start);

        if (daysDiff < 0) return []; // Start date in future?

        let current = start;
        let doseIndex = 0;
        const doses = medication.defaultDoses || [currentDose];

        // Simple logic: If they are on a high dose, we can't easily guess WHEN they stepped up without asking.
        // For MVP/V2 initial: Just log the *current* dose back to the start date? 
        // OR: The user requirement: "assume (based on default/normal timetable of dosesages moving to their current one)"
        // Mounjaro normal timetable: 4 weeks at 2.5, 4 weeks at 5, 4 weeks at 7.5...

        // Let's implement a "Smart Ramp" if it's a preset with doses
        if (estimationMode === 'simple' && medication.defaultDoses) {
            // We need to work BACKWARDS from current dose? Or Forwards from start?
            // User said: "based on default/normal timetable... moving to their current one"
            // This implies starting at lowest, 4 weeks, next, 4 weeks, until we hit current.

            let rampDoseIndex = 0;
            let weeksOnDose = 0;

            while (current <= now) {
                let doseToLog = doses[rampDoseIndex];

                // Cap at current dose provided by user
                if (parseFloat(doseToLog) > parseFloat(currentDose)) {
                    doseToLog = currentDose;
                }

                logs.push({
                    date: new Date(current), // Clone
                    dose: doseToLog,
                    medId: medication.id,
                    medication: medication.name,
                    type: 'estimated'
                });

                current = addDays(current, frequency);
                weeksOnDose++;

                // Standard Mounjaro schedule: 4 weeks per dose
                if (weeksOnDose >= 4 && rampDoseIndex < doses.length - 1) {
                    // Check if the NEXT dose is <= user's current dose
                    if (parseFloat(doses[rampDoseIndex + 1]) <= parseFloat(currentDose)) {
                        rampDoseIndex++;
                        weeksOnDose = 0;
                    }
                }
            }
        } else {
            // Just flat logs
            while (current <= now) {
                logs.push({
                    date: new Date(current),
                    dose: currentDose,
                    medId: medication.id,
                    medication: medication.name,
                    type: 'estimated'
                });
                current = addDays(current, frequency);
            }
        }

        return logs;
    }, [hasStarted, currentDose, startDate, frequency, medication, estimationMode]);


    if (hasStarted === null) {
        return (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h2 className="text-xl font-semibold text-white">Have you already started taking {medication.name}?</h2>
                <div className="grid grid-cols-2 gap-4">
                    <button onClick={() => setHasStarted(true)} className="p-4 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700">
                        <span className="text-green-400 font-bold text-lg">Yes</span>
                        <p className="text-sm text-slate-400">I have history to log</p>
                    </button>
                    <button onClick={onSkip} className="p-4 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700">
                        <span className="text-blue-400 font-bold text-lg">No</span>
                        <p className="text-sm text-slate-400">I'm just starting</p>
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-xl font-semibold text-white">History Estimation</h2>

            <div className="space-y-4">
                <div>
                    <label className="block text-sm text-slate-400 mb-1">Current Dose</label>
                    {medication.defaultDoses ? (
                        <select
                            value={currentDose}
                            onChange={e => setCurrentDose(e.target.value)}
                            className="w-full bg-slate-800 border-slate-700 rounded p-2 text-white"
                        >
                            {medication.defaultDoses.map(d => (
                                <option key={d} value={d}>{d} {medication.units}</option>
                            ))}
                        </select>
                    ) : (
                        <input
                            type="number"
                            value={currentDose}
                            onChange={e => setCurrentDose(e.target.value)}
                            className="w-full bg-slate-800 border-slate-700 rounded p-2 text-white"
                        />
                    )}
                </div>

                <div>
                    <label className="block text-sm text-slate-400 mb-1">Start Date</label>
                    <input
                        type="date"
                        value={startDate}
                        onChange={e => setStartDate(e.target.value)}
                        className="w-full bg-slate-800 border-slate-700 rounded p-2 text-white"
                    />
                </div>

                <div className="bg-slate-900 p-4 rounded-lg border border-slate-800">
                    <div className="flex items-center gap-2 mb-2 text-yellow-400">
                        <AlertCircle size={16} />
                        <span className="font-semibold text-sm">Proposed History</span>
                    </div>
                    <p className="text-xs text-slate-500 mb-3">
                        Based on a standard 4-week titration schedule.
                    </p>
                    <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                        {proposedLogs.map((log, i) => (
                            <div key={i} className="flex justify-between text-sm text-slate-300 border-b border-slate-800 pb-1 last:border-0">
                                <span>{format(log.date, 'MMM d, yyyy')}</span>
                                <span className="font-mono text-blue-400">{log.dose}{medication.units}</span>
                            </div>
                        ))}
                        {proposedLogs.length === 0 && <span className="text-slate-600 text-sm">No logs generated. Check start date.</span>}
                    </div>
                </div>

                <button
                    onClick={() => onConfirm(proposedLogs)}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2"
                >
                    <Check size={20} /> Import {proposedLogs.length} Entries
                </button>

                <button onClick={onSkip} className="w-full text-slate-500 text-sm hover:text-white">Skip History</button>
            </div>
        </div>
    );
}
