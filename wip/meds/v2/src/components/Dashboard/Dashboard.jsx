import React, { useState } from 'react';
import { useMedStore } from '../../store/useMedStore';
import MedicationCard from './MedicationCard';
import { Plus, Settings as SettingsIcon, Trash2, Search } from 'lucide-react';
import MedicationForm from '../Medications/MedicationForm';
import TrashModal from './TrashModal';

export default function Dashboard() {
    const { medications, addMedication } = useMedStore();
    const [showAddModal, setShowAddModal] = useState(false);
    const [showTrash, setShowTrash] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Filter active meds
    const activeMeds = medications.filter(m =>
        !m.archived &&
        !m.deletedAt &&
        m.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const deletedCount = medications.filter(m => m.deletedAt).length;

    const handleAddSubmit = (med) => {
        addMedication(med);
        setShowAddModal(false);
    };

    return (
        <div className="min-h-screen bg-slate-950 text-white p-4 pb-20">
            {/* Header */}
            <header className="flex justify-between items-center mb-8 pt-4">
                <div>
                    <h1 className="text-2xl font-bold">My Meds</h1>
                    <p className="text-sm text-slate-400">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowTrash(true)}
                        className="p-2 bg-slate-900 rounded-full border border-slate-800 text-slate-400 hover:text-red-400 relative"
                    >
                        <Trash2 size={20} />
                        {deletedCount > 0 && <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border-2 border-slate-900"></span>}
                    </button>
                    <button className="p-2 bg-slate-900 rounded-full border border-slate-800 text-slate-400 hover:text-white">
                        <SettingsIcon size={20} />
                    </button>
                </div>
            </header>

            {/* Search Bar */}
            <div className="mb-6 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search size={18} className="text-slate-500" />
                </div>
                <input
                    type="text"
                    placeholder="Search medications..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-white focus:outline-none focus:border-blue-500 transition-colors placeholder-slate-600"
                />
            </div>

            {/* Stats / Graph Area Placeholder */}
            {!searchQuery && (
                <div className="mb-8 p-4 bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl border border-slate-700/50 aspect-[2/1] flex items-center justify-center">
                    <span className="text-slate-500">Combined Graph Coming Soon</span>
                </div>
            )}

            {/* Medications List */}
            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <h2 className="font-semibold text-slate-300">Active Medications ({activeMeds.length})</h2>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 font-medium"
                    >
                        <Plus size={16} /> Add New
                    </button>
                </div>

                {activeMeds.length === 0 && searchQuery && (
                    <div className="text-center text-slate-500 py-10">
                        No medications found for "{searchQuery}"
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {activeMeds.map(med => (
                        <MedicationCard key={med.id} medication={med} />
                    ))}
                </div>
            </div>

            {/* Add Modal (Simple overlay for now) */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-900 w-full max-w-md rounded-2xl border border-slate-800 p-6 relative">
                        <button
                            onClick={() => setShowAddModal(false)}
                            className="absolute top-4 right-4 text-slate-400 hover:text-white"
                        >
                            ✕
                        </button>
                        <MedicationForm onSubmit={handleAddSubmit} />
                    </div>
                </div>
            )}

            {showTrash && <TrashModal onClose={() => setShowTrash(false)} />}
        </div>
    );
}
