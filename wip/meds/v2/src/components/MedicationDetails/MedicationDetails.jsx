import React, { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMedStore } from '../../store/useMedStore';
import { calculateMedicationLevels } from '../../utils/medicationMath';
import { ArrowLeft, Trash2, Edit, AlertTriangle } from 'lucide-react';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    TimeScale
} from 'chart.js';
import 'chartjs-adapter-date-fns';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    TimeScale
);

export default function MedicationDetails() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { medications, logs, settings, deleteMedication, deleteLog } = useMedStore();
    const [view, setView] = useState('month'); // week, month, 90days

    const medication = medications.find(m => m.id === id);
    const medLogs = logs.filter(l => l.medId === id).sort((a, b) => new Date(b.date) - new Date(a.date));

    if (!medication) return <div className="p-10 text-white">Medication not found</div>;

    // Chart Data
    const chartData = useMemo(() => {
        // We explicitly pass the medication info map
        const mathResult = calculateMedicationLevels(medLogs, view, settings, { [id]: medication });

        // Transform for Chart.js
        return {
            labels: mathResult.timestamps,
            datasets: [
                {
                    label: 'Level',
                    data: mathResult.values,
                    borderColor: medication.color || '#4bc0c0',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    tension: 0.3,
                    pointRadius: 0,
                    fill: true,
                }
            ]
        };

    }, [medication, medLogs, view, settings, id]);

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: {
                type: 'time',
                time: {
                    unit: view === 'week' ? 'day' : 'week'
                },
                grid: { color: '#334155' },
                ticks: { color: '#94a3b8' }
            },
            y: {
                grid: { color: '#334155' },
                ticks: { color: '#94a3b8' }
            }
        },
        plugins: {
            legend: { display: false },
            tooltip: {
                mode: 'index',
                intersect: false,
            }
        }
    };

    const handleDelete = () => {
        if (confirm(`Are you sure you want to delete ${medication.name}? It will move to trash.`)) {
            deleteMedication(id);
            navigate('/');
        }
    };

    const handleDeleteLog = (logId) => {
        if (confirm("Delete this entry?")) {
            deleteLog(logId);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 text-white p-4 pb-20">
            <button onClick={() => navigate('/')} className="flex items-center text-slate-400 hover:text-white mb-4">
                <ArrowLeft size={20} className="mr-1" /> Back
            </button>

            <div className="flex justify-between items-start mb-6">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: medication.color }}></div>
                        {medication.name}
                    </h1>
                    <p className="text-slate-400">Current Dose: {medication.defaultDoses?.[0]} {medication.units}</p>
                </div>
                <div className="flex gap-2">
                    <button className="p-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-400 hover:text-white">
                        <Edit size={20} />
                    </button>
                    <button onClick={handleDelete} className="p-2 bg-slate-900 border border-slate-800 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-900/20">
                        <Trash2 size={20} />
                    </button>
                </div>
            </div>

            {/* Chart Section */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6">
                <div className="flex justify-between mb-4">
                    <h2 className="font-semibold">Levels</h2>
                    <div className="flex gap-1 text-xs">
                        {['week', 'month', '90days'].map(v => (
                            <button
                                key={v}
                                onClick={() => setView(v)}
                                className={`px-3 py-1 rounded-full ${view === v ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                            >
                                {v}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="h-64">
                    <Line data={chartData} options={chartOptions} />
                </div>
            </div>

            {/* History Section */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-slate-800">
                    <h2 className="font-semibold">History</h2>
                </div>
                <div className="divide-y divide-slate-800">
                    {medLogs.map(log => (
                        <div key={log.id} className="p-4 flex justify-between items-center hover:bg-slate-800/50">
                            <div>
                                <p className="font-medium text-white">{new Date(log.date).toLocaleDateString()} {new Date(log.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                <p className="text-sm text-slate-400">{log.dose}{medication.units} • {log.type || 'Manual'}</p>
                            </div>
                            <button onClick={() => handleDeleteLog(log.id)} className="text-slate-600 hover:text-red-400">
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))}
                    {medLogs.length === 0 && <div className="p-6 text-center text-slate-500">No logs found.</div>}
                </div>
            </div>
        </div>
    );
}
