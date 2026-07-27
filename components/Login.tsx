import React, { useState } from 'react';
import { login, setToken } from '../services/api';

interface LoginProps {
  onLoggedIn: (user: { id: string; firstName: string; lastName: string; email: string }) => void;
}

const Login: React.FC<LoginProps> = ({ onLoggedIn }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result?.token) {
        setToken(result.token);
        onLoggedIn(result.user);
      } else {
        setError('Login failed. Please try again.');
      }
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-surface p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-semibold mb-4" style={{ color: '#111827' }}>Sign in</h1>
        <p className="text-sm text-brand-text-light mb-6">Use your account to access the app.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#1f2937' }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border rounded px-3 py-2"
              placeholder="you@example.com"
              required
              style={{ color: '#111827', borderColor: '#D1D5DB' }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#1f2937' }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border rounded px-3 py-2"
              placeholder="••••••••"
              required
              style={{ color: '#111827', borderColor: '#D1D5DB' }}
            />
          </div>
          {error && <div className="text-red-600 text-sm">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-primary text-black font-semibold py-2 rounded hover:opacity-90 disabled:opacity-60"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
