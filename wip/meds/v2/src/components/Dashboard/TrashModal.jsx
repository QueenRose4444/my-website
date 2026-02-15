import React from 'react';
import { useMedStore } from '../../store/useMedStore';
import { RotateCcw, Trash2, X } from 'lucide-react';
import { format } from 'date-fns';

export default function TrashModal({ onClose }) {
    const { medications, restoreMedication, permanentlyDeleteMedication } = useMedStore();

    const deletedMeds = medications.filter(m => m.deletedAt);

    // Sort by deleted date (newest first)
    deletedMeds.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 w-full max-w-lg rounded-2xl border border-slate-800 p-6 relative max-h-[80vh] flex flex-col">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Trash2 className="text-red-400" /> Trash
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-white bg-slate-800 p-1 rounded-full"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                    {deletedMeds.length === 0 && (
                        <div className="text-center text-slate-500 py-10">
                            Trash is empty.
                        </div>
                    )}

                    {deletedMeds.map(med => (
                        <div key={med.id} className="bg-slate-950 border border-slate-800 p-4 rounded-xl flex justify-between items-center">
                            <div>
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: med.color }}></div>
                                    <span className="font-semibold text-white">{med.name}</span>
                                </div>
                                <p className="text-xs text-slate-500 mt-1">
                                    Deleted: {format(new Date(med.deletedAt), 'MMM d, yyyy HH:mm')}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => restoreMedication(med.id)}
                                    className="p-2 bg-slate-900 text-blue-400 hover:text-white rounded-lg border border-slate-800 hover:bg-blue-600/20"
                                    title="Restore"
                                >
                                    <RotateCcw size={18} />
                                </button>
                                <button
                                    onClick={() => {
                                        if (confirm("Permanently delete? This cannot be undone and will delete all associated logs.")) {
                                            permanentlyDeleteMedication(med.id);
                                        }
                                    }}
                                    className="p-2 bg-slate-900 text-red-400 hover:text-white rounded-lg border border-slate-800 hover:bg-red-600/20"
                                    title="Delete Forever"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-6 pt-4 border-t border-slate-800 text-center">
                    <button onClick={onClose} className="text-slate-400 hover:text-white text-sm">Close</button>
                </div>
            </div>
        </div>
    );
}
