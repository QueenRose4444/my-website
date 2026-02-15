import React, { useState } from 'react';
import { PRESET_MEDICATIONS } from '../../constants';
import { ChevronRight, Check } from 'lucide-react';

export default function MedicationForm({ onSubmit, initialData = {} }) {
    const [step, setStep] = useState('select-type'); // select-type, details, review
    const [formData, setFormData] = useState(initialData);
    const [customMed, setCustomMed] = useState({ name: '', halfLife: 0, color: '#3b82f6' });

    const handlePresetSelect = (key) => {
        const preset = PRESET_MEDICATIONS[key];
        setFormData({ ...formData, type: 'preset', presetId: key, ...preset });
        setStep('details');
    };

    const handleCustomSubmit = (e) => {
        e.preventDefault();
        setFormData({ ...formData, type: 'custom', ...customMed });
        setStep('details'); // Or directly to review? details might be 'current dose'
    };

    if (step === 'select-type') {
        return (
            <div className="space-y-4">
                <h2 className="text-xl font-semibold text-white">Select Medication</h2>
                <div className="grid grid-cols-1 gap-2">
                    {Object.entries(PRESET_MEDICATIONS).map(([key, med]) => (
                        <button
                            key={key}
                            onClick={() => handlePresetSelect(key)}
                            className="flex items-center justify-between p-4 bg-slate-800 rounded-lg hover:bg-slate-700 transition"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: med.color }}></div>
                                <span className="text-white font-medium">{med.name}</span>
                            </div>
                            <ChevronRight className="text-slate-400" />
                        </button>
                    ))}
                    <div className="relative">
                        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-700"></div></div>
                        <div className="relative flex justify-center text-sm"><span className="px-2 bg-slate-900 text-slate-500">Or custom</span></div>
                    </div>
                    <form onSubmit={handleCustomSubmit} className="bg-slate-800 p-4 rounded-lg space-y-3">
                        <input
                            type="text"
                            placeholder="Medication Name"
                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                            value={customMed.name}
                            onChange={e => setCustomMed({ ...customMed, name: e.target.value })}
                            required
                        />
                        <div className="flex gap-2">
                            <input
                                type="number"
                                placeholder="Half Life (hours)"
                                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                                value={customMed.halfLife}
                                onChange={e => setCustomMed({ ...customMed, halfLife: parseFloat(e.target.value) })}
                                required
                            />
                            <input
                                type="color"
                                className="h-10 w-20 bg-slate-900 border border-slate-700 rounded p-1"
                                value={customMed.color}
                                onChange={e => setCustomMed({ ...customMed, color: e.target.value })}
                            />
                        </div>
                        <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded font-medium">Add Custom</button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white">Details for {formData.name}</h2>
            {/* Configuration for dose, etc would go here */}
            <div className="bg-slate-800 p-4 rounded text-slate-300 text-sm">
                <p>Half Life: {formData.halfLife} hours</p>
                <p>Units: {formData.units || 'mg'}</p>
            </div>

            <button
                onClick={() => onSubmit(formData)}
                className="w-full bg-green-600 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2"
            >
                <Check size={20} /> Confirm
            </button>
            <button onClick={() => setStep('select-type')} className="w-full text-slate-400 py-2">Back</button>
        </div>
    );
}
