import React from 'react';
import { useMedStore } from '../../store/useMedStore';
import { AuthManager } from '../../utils/AuthManager';

const authManager = new AuthManager('med-tracker', 'wip');

export default function Login() {
    const setUser = useMedStore(state => state.setUser);

    const handleLogin = async (e) => {
        e.preventDefault();
        // Implementation later
        const user = await authManager.login('test', 'password'); // Dummy
        setUser(user);
    };

    return (
        <div className="p-4 flex flex-col items-center justify-center h-screen bg-slate-900 text-white">
            <h1 className="text-2xl font-bold mb-4">Login</h1>
            <button onClick={() => setUser({ username: 'Demo' })} className="bg-blue-500 px-4 py-2 rounded">
                Demo Login
            </button>
        </div>
    );
}
