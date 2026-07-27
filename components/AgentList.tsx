
import React from 'react';
import type { Agent } from '../types';
import { PlusIcon, ChatBubbleIcon, CopyIcon, TrashIcon, EditIcon } from './Icons';

interface AgentListProps {
  agents: Agent[];
  onChat: (agentId: string) => void;
  onCopy: (agentId: string) => void;
  onDelete: (agentId: string) => void;
  onCreate: () => void;
  onEdit: (agentId: string) => void;
}

const AgentCard: React.FC<{ agent: Agent, onChat: () => void, onCopy: () => void, onEdit: () => void, onDelete: () => void }> = ({ agent, onChat, onCopy, onEdit, onDelete }) => (
  <div className="bg-brand-surface rounded-lg p-6 flex flex-col justify-between shadow-lg hover:shadow-brand-primary/20 hover:-translate-y-1 transition-all duration-300">
    <div>
      <h3 className="text-lg font-bold text-brand-primary truncate">{agent.name}</h3>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <span className="inline-block text-[11px] px-2 py-0.5 rounded-full bg-brand-surface-light text-brand-text-light border border-brand-surface-light" title="Model used by this agent">
          {agent.model}
        </span>
        {agent.roleName && (
          <span className="inline-block text-[11px] px-2 py-0.5 rounded-full bg-brand-surface-light text-brand-text-light border border-brand-surface-light" title="Role for this agent">
            {agent.roleName}
          </span>
        )}
      </div>
      <p className="text-brand-text-light mt-3 text-sm line-clamp-3 h-[60px]">{agent.masterPrompt}</p>
    </div>
    <div className="mt-6 flex items-center justify-between">
      <button
        onClick={onChat}
        className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-brand-bg font-semibold rounded-md text-sm hover:bg-opacity-90 transition-colors">
        <ChatBubbleIcon className="w-4 h-4" />
        Chat
      </button>
      <div className="flex items-center gap-2">
        <button onClick={onEdit} className="p-2 text-brand-text-light hover:text-brand-primary transition-colors" title="Copy Agent">
            <EditIcon className="w-5 h-5" />
        </button>
        <button onClick={onCopy} className="p-2 text-brand-text-light hover:text-brand-primary transition-colors" title="Copy Agent">
          <CopyIcon className="w-5 h-5" />
        </button>
        <button onClick={onDelete} className="p-2 text-brand-text-light hover:text-red-500 transition-colors" title="Delete Agent">
          <TrashIcon className="w-5 h-5" />
        </button>
      </div>
    </div>
  </div>
);


const AgentList: React.FC<AgentListProps> = ({ agents, onChat, onEdit, onCopy, onDelete, onCreate }) => {
  const [searchQuery, setSearchQuery] = React.useState('');
  return (
    <div className="w-full max-w-7xl mx-auto p-4 ">
      <div className="flex flex-col gap-4 mb-8">
        <div className="max-[768px]:pl-[50px] flex justify-between items-center">
          <h1 className="text-2xl font-bold concate">Your Agents</h1>
          <button
            onClick={onCreate}
            className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-brand-bg font-semibold rounded-lg shadow-md hover:bg-opacity-90 transition-all duration-200 max-[768px]:px-2">
            <PlusIcon className="w-5 h-5"/>
            <span className='max-[768px]:hidden'>New Agent</span>
          </button>
        </div>
        <input
          type="text"
          placeholder="Search agents..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full p-2 rounded-lg border border-brand-surface-light bg-brand-surface focus:outline-none focus:border-brand-primary"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {agents
          .filter(agent => agent.name.toLowerCase().includes(searchQuery.toLowerCase()))
          .map(agent => (
            <AgentCard
            key={agent.id}
            agent={agent}
            onChat={() => onChat(agent.id)}
            onEdit={() => onEdit(agent.id)}
            onCopy={() => onCopy(agent.id)}
            onDelete={() => onDelete(agent.id)}
          />
        ))}
      </div>
    </div>
  );
};

export default AgentList;
