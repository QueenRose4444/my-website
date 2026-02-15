import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useMedStore } from './store/useMedStore';
import { AuthManager } from './utils/AuthManager';
import { APP_NAME, ENVIRONMENT } from './constants';
import Dashboard from './components/Dashboard/Dashboard';
import Onboarding from './components/Onboarding/Onboarding';
import Login from './components/Auth/Login';
import MedicationDetails from './components/MedicationDetails/MedicationDetails';

const authManager = new AuthManager(APP_NAME, ENVIRONMENT);

function AppContent() {
  const { user, setUser, medications, loadData, isLoading } = useMedStore();
  const [init, setInit] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      const currentUser = await authManager.initialize();
      setUser(currentUser);
      if (currentUser) {
        await loadData();
      }
      setInit(false);
    };
    initAuth();
  }, [setUser, loadData]);

  if (init) {
    return <div className="flex h-screen items-center justify-center bg-slate-950 text-white">Loading...</div>;
  }

  if (!user) {
    return <Login />;
  }

  return (
    <Routes>
      <Route path="/" element={medications.length === 0 ? <Navigate to="/onboarding" /> : <Dashboard />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/medication/:id" element={<MedicationDetails />} />
      {/* Helper redirect */}
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}
