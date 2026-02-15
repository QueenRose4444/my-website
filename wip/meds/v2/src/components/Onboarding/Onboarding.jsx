import React, { useState } from 'react';
import MedicationForm from '../Medications/MedicationForm';
import HistoryEstimator from './HistoryEstimator';
import { useMedStore } from '../../store/useMedStore';

export default function Onboarding() {
    const [step, setStep] = useState(1);
    const [tempMed, setTempMed] = useState(null);
    const { addMedication, addLog } = useMedStore();

    const handleMedicationSubmit = (medData) => {
        // Don't add to store yet, keep in temp
        setTempMed(medData);
        setStep(2);
    };

    const handleHistoryConfirm = (logs) => {
        // Commit medication and logs
        const med = { ...tempMed, id: crypto.randomUUID() };
        addMedication(med);

        logs.forEach(log => {
            addLog({ ...log, medId: med.id });
        });

        // Finished - App.jsx handles redirection based on store state
    };

    const handleHistorySkip = () => {
        const med = { ...tempMed, id: crypto.randomUUID() };
        addMedication(med);
    };

    return (
        <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center p-4">
            <div className="w-full max-w-md space-y-8 mt-10">
                <div className="text-center">
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 text-transparent bg-clip-text">Get Started</h1>
                    <p className="text-slate-400 mt-2">Let's set up your first medication tracking.</p>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl shadow-xl">
                    {step === 1 && <MedicationForm onSubmit={handleMedicationSubmit} />}
                    {step === 2 && tempMed && (
                        <HistoryEstimator
                            medication={tempMed}
                            onConfirm={handleHistoryConfirm}
                            onSkip={handleHistorySkip}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
