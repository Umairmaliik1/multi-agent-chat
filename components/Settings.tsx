import React, {useState} from 'react';
import {updateUserProfile} from '../services/api';

const Settings = ({ user }) => {
  const [firstName, setFirstName] = useState(user.firstName || '');
  const [lastName, setLastName] = useState(user.lastName || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (password && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      await updateUserProfile({firstName, lastName, password});
      setSuccess('Profile updated successfully');
      setPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err?.message || 'Failed to update profile');
    } finally {
      setLoading(false);
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen bg-brand-surface p-4">
      <div
        className="w-full max-w-md mx-auto bg-brand-surface-light rounded-lg shadow-lg border border-brand-surface-light p-6">
      <h1 className="text-2xl font-semibold mb-4">Settings</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{color: '#1f2937'}}>First Name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full border rounded px-3 py-2 bg-brand-surface focus:border-brand-primary transition-colors"
              placeholder="Enter first name"
              style={{borderColor: '#111827'}}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{color: '#1f2937'}}>Last Name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full border rounded px-3 py-2 bg-brand-surface focus:border-brand-primary transition-colors"
              placeholder="Enter last name"
              style={{borderColor: '#111827'}}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{color: '#1f2937'}}>New Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border rounded px-3 py-2 bg-brand-surface focus:border-brand-primary transition-colors"
              placeholder="Enter new password"
              style={{borderColor: '#111827'}}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{color: '#1f2937'}}>Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full border rounded px-3 py-2 bg-brand-surface focus:border-brand-primary transition-colors"
              placeholder="Confirm new password"
              style={{borderColor: '#111827'}}
            />
          </div>
          {error && <div className="text-red-600 text-sm">{error}</div>}
          {success && <div className="text-green-600 text-sm">{success}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-primary text-black font-semibold py-2 rounded hover:opacity-90 disabled:opacity-60"
          >
            {loading ? 'Updating...' : 'Update Profile'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Settings;
