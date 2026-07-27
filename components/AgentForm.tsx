import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Agent, Role } from '../types';

interface AgentFormProps {
  agent: Agent | null;
  roles?: Role[];
  onSave: (agentData: { name: string; masterPrompt: string; model: string; roleId?: string }) => void;
  onClose: () => void;
}

const AgentForm: React.FC<AgentFormProps> = ({ agent, roles = [], onSave, onClose }) => {
  const [name, setName] = useState('');
  const [masterPrompt, setMasterPrompt] = useState('');
  const [model, setModel] = useState('gemini-3-pro-preview');
  const [roleId, setRoleId] = useState<string>('');

  useEffect(() => {
    if (agent) {
      setName(agent.name);
      setMasterPrompt(agent.masterPrompt);
      setModel(agent.model || 'gemini-3-pro-preview');
      setRoleId(agent.roleId || '');
    } else {
      setName('');
      setMasterPrompt('');
      setModel('gemini-3-pro-preview');
      // default to the only role if exactly one, else empty
      if (roles.length === 1) setRoleId(roles[0].id);
      else setRoleId('');
    }
  }, [agent, roles]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && masterPrompt.trim()) {
      const payload: any = { name, masterPrompt, model };
      if (!agent) {
        // Creating: include roleId if provided (required on backend when multiple roles)
        if (roleId) payload.roleId = roleId;
      }
      onSave(payload);
    }
  };

  const multipleRoles = !agent && roles && roles.length > 1;

  const modalContent = (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black bg-opacity-70 transition-opacity" onClick={onClose}></div>
        
        <div className="relative bg-brand-surface rounded-lg shadow-2xl w-full max-w-2xl p-8 animate-fade-in-up" onClick={(e) => e.stopPropagation()}>
          <h2 className="text-2xl font-bold mb-6">{agent ? 'Edit Agent' : 'Create New Agent'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="agent-name" className="block text-sm font-medium text-brand-text-light mb-2">Agent Name</label>
            <input
              id="agent-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., 'Creative Writer'"
              className="w-full bg-brand-surface-light border border-brand-surface-light rounded-md px-3 py-2 focus:ring-2 focus:ring-brand-primary focus:outline-none transition-all"
              required
            />
          </div>
          <div className="mb-6">
            <label htmlFor="master-prompt" className="block text-sm font-medium text-brand-text-light mb-2">Master Prompt (System Instruction)</label>
            <textarea
              id="master-prompt"
              value={masterPrompt}
              onChange={(e) => setMasterPrompt(e.target.value)}
              placeholder="e.g., 'You are a helpful assistant that specializes in writing short, creative stories.'"
              rows={5}
              className="w-full bg-brand-surface-light border border-brand-surface-light rounded-md px-3 py-2 focus:ring-2 focus:ring-brand-primary focus:outline-none transition-all"
              required
            />
          </div>
          <div className="mb-6">
            <label htmlFor="model" className="block text-sm font-medium text-brand-text-light mb-2">Model</label>
            <select
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-brand-surface-light border border-brand-surface-light rounded-md px-3 py-2 focus:ring-2 focus:ring-brand-primary focus:outline-none transition-all"
            >
              <optgroup label="Gemini">
                <option value="gemini-3-pro-preview">gemini-3-pro-preview</option>
                {/* <option value="gemini-3-pro-image-preview">Nano Banana Pro (gemini-3-pro-image-preview)</option>
                <option value="gemini-2.5-flash-image">Nano Banana (gemini-2.5-flash-image)</option>
                <option value="veo-3.1-generate-preview">veo-3.1-generate-preview</option> */}
                <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
              </optgroup>
              <optgroup label="OpenAI">
                <option value="gpt-5">gpt-5</option>
                <option value="gpt-5-mini">gpt-5-mini</option>
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
              </optgroup>
              <optgroup label="Anthropic">
              <option value="claude-opus-4-6">claude-opus-4-6</option>
                <option value="claude-sonnet-4-5">claude-sonnet-4-5</option>
                <option value="claude-haiku-4-5">claude-haiku-4-5</option>
                <option value="claude-opus-4-1">claude-opus-4-1</option>
                <option value="claude-sonnet-4-0">claude-sonnet-4-0</option>
                <option value="claude-opus-4-0">claude-opus-4-0</option>
                <option value="claude-3-7-sonnet-latest">claude-3-7-sonnet-latest</option>
                <option value="claude-3-5-haiku-latest">claude-3-5-haiku-latest</option>
              </optgroup>
            </select>
            <p className="text-xs text-brand-text-light mt-2">Choose which provider/model this agent will use during chats.</p>
          </div>

          {agent ? (
            <div className="mb-6">
              <label className="block text-sm font-medium text-brand-text-light mb-2">Role</label>
              <div className="text-sm text-brand-text-light">{agent.roleName || '—'}</div>
            </div>
          ) : (
            <>
              {roles && roles.length === 1 ? (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-brand-text-light mb-2">Role</label>
                  <div className="text-sm text-brand-text-light">{roles[0].name}</div>
                </div>
              ) : null}
              {multipleRoles && (
                <div className="mb-6">
                  <label htmlFor="role" className="block text-sm font-medium text-brand-text-light mb-2">Role</label>
                  <select
                    id="role"
                    value={roleId}
                    onChange={(e) => setRoleId(e.target.value)}
                    className="w-full bg-brand-surface-light border border-brand-surface-light rounded-md px-3 py-2 focus:ring-2 focus:ring-brand-primary focus:outline-none transition-all"
                    required
                  >
                    <option value="" disabled>Select role</option>
                    {roles.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-brand-text-light mt-2">Select which role this agent belongs to.</p>
                </div>
              )}
            </>
          )}

          <div className="flex justify-end gap-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-brand-surface-light rounded-md hover:bg-opacity-80 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-brand-primary text-brand-bg font-semibold rounded-md hover:bg-opacity-90 transition-colors"
            >
              Save Agent
            </button>
          </div>
        </form>
        </div>
      </div>
       <style>{`
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-up {
          animation: fade-in-up 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  );

  return createPortal(modalContent, document.body);
};

export default AgentForm;
