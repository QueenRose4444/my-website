import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { calculateMedicationLevels } from '../../utils/medicationMath';
import { useMedStore } from '../../store/useMedStore';
import { Plus } from 'lucide-react';

export default function MedicationCard({ medication }) {
    const navigate = useNavigate();
    const { logs, settings, addLog } = useMedStore();

    const medLogs = useMemo(() => logs.filter(l => l.medId === medication.id), [logs, medication.id]);

    // Calculate current level
    const currentData = useMemo(() => {
        const { values, timestamps } = calculateMedicationLevels(medLogs, 'week', settings, { [medication.id]: medication });
        const now = new Date();
        let currentLevel = 0;
        const index = timestamps.findIndex(t => t > now);
        if (index > 0) {
            currentLevel = values[index - 1];
        } else if (values.length > 0) {
            currentLevel = values[values.length - 1];
        }
        return currentLevel;
    }, [medLogs, settings, medication]);

    const handleQuickDose = (e) => {
        e.stopPropagation();
        const dose = prompt(`Enter dose for ${medication.name}:`, medication.defaultDoses ? medication.defaultDoses[0] : '');
        if (dose) {
            addLog({
                medId: medication.id,
                medication: medication.name,
                dose: parseFloat(dose),
                date: new Date().toISOString(),
                type: 'manual'
            });
        }
    };

    return (
        <div
            onClick={() => navigate(`/medication/${medication.id}`)}
            className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow relative cursor-pointer group"
        >
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full shadow-[0_0_10px]" style={{ backgroundColor: medication.color, boxShadow: `0 0 10px ${medication.color}` }}></div>
                    <div>
                        <h3 className="font-bold text-lg text-white leading-none group-hover:text-blue-400 transition-colors">{medication.name}</h3>
                        <span className="text-xs text-slate-500">{medication.halfLife}h Half-life</span>
                    </div>
                </div>
            </div>

            <div className="flex items-end justify-between">
                <div>
                    <p className="text-sm text-slate-400">Current Level</p>
                    <p className="text-2xl font-mono font-semibold text-white">
                        {currentData.toFixed(2)}
                        <span className="text-sm text-slate-500 font-normal ml-1">{medication.units || 'mg'}</span>
                    </p>
                </div>
            </div>

            <button
                onClick={handleQuickDose}
                className="absolute top-5 right-5 bg-slate-800 hover:bg-blue-600 border border-slate-700 hover:border-blue-500 p-2 rounded-lg text-white transition-all z-10"
            >
                <Plus size={18} />
            </button>
        </div>
    );
}
