import React, { useState, useCallback, useEffect, useRef } from 'react';
import {BrowserRouter, Routes, Route} from 'react-router-dom';
import type { Agent, Conversation, Role } from './types';
import AgentList from './components/AgentList';
import AgentForm from './components/AgentForm';
import ChatView from './components/ChatView';
import Login from './components/Login';
import { getAgents, getRoles as apiGetRoles, createAgent as apiCreateAgent, updateAgent as apiUpdateAgent, deleteAgent as apiDeleteAgent, duplicateAgent as apiDuplicateAgent, getConversations as apiGetConversations, replaceConversations as apiReplaceConversations, me as apiMe, getToken, setToken } from './services/api';
import Sidebar from "@/components/SideBar.tsx";
import Settings from "@/components/Settings.tsx";
import Users from "@/components/Users.tsx";
import { BarsIcon } from "@/components/Icons.tsx";

type View = 'AGENT_LIST' | 'CHAT';
type ConversationsState = Record<string, Conversation[]>;

function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState<boolean>(false);
  const [conversations, setConversations] = useState<ConversationsState>({});
  const [view, setView] = useState<View>('AGENT_LIST');
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const saveTimers = useRef<Record<string, number>>({});
  const [user, setUser] = useState<{ id: string; firstName: string; lastName: string; email: string } | null>(null);
  const [checkingAuth, setCheckingAuth] = useState<boolean>(true);
  const [roles, setRoles] = useState<Role[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Validate existing token and load initial data
  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        const token = getToken();
        if (token) {
          const u = await apiMe();
          if (!mounted) return;
          setUser(u);
          // Load roles and agents after auth
          setIsLoadingAgents(true);
          try {
            const [rolesData, agentsData] = await Promise.all([
              apiGetRoles().catch(() => [] as Role[]),
              getAgents().catch((err) => {
                console.error('Failed to load agents:', err);
                return [] as Agent[];
              })
            ]);
            if (!mounted) return;
            setRoles(rolesData);
            setAgents(agentsData);
          } catch (e) {
            console.error('Error loading data:', e);
            if (!mounted) return;
            setRoles([]);
            setAgents([]);
          } finally {
            if (mounted) setIsLoadingAgents(false);
          }
        }
      } catch (e) {
        // Only clear token on 401 (invalid/expired); preserve on network/5xx errors
        if (e instanceof Error && e.message === 'Unauthorized') {
          console.log('Unauthorized error during init, clearing token');
          setToken(null);
          setUser(null);
        } else {
          console.error('Non-401 error during init:', e);
        }
      } finally {
        if (mounted) setCheckingAuth(false);
        if (mounted) setIsLoadingAgents(false);
      }
    }
    init();

    const onUnauthorized = () => {
      setToken(null);
      setUser(null);
      setAgents([]);
      setConversations({});
      setActiveAgentId(null);
      setView('AGENT_LIST');
    };
    window.addEventListener('unauthorized', onUnauthorized);
    return () => {
      mounted = false;
      window.removeEventListener('unauthorized', onUnauthorized);
    };
  }, []);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // After successful login, fetch agents
  const handleLoggedIn = async (_user: { id: string; firstName: string; lastName: string; email: string }) => {
    setUser(_user);
    setIsLoadingAgents(true);
    try {
      const [rolesData, agentsData] = await Promise.all([
        apiGetRoles().catch(() => [] as Role[]),
        getAgents().catch((err) => {
          console.error('Failed to load agents:', err);
          return [] as Agent[];
        })
      ]);
      setRoles(rolesData);
      setAgents(agentsData);
    } catch (e) {
      console.error('Error loading data after login:', e);
      setRoles([]);
      setAgents([]);
    } finally {
      setIsLoadingAgents(false);
    }
  };

  // Logout: clear token and reset all state back to initial
  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setAgents([]);
    setConversations({});
    setActiveAgentId(null);
    setView('AGENT_LIST');
    setIsSidebarOpen(false);
  };

  const handleCreateNewAgent = () => {
    setEditingAgent(null);
    setIsFormVisible(true);
  };

  const handleFilterAgents = (roleId?: string | null) => {
    if (roleId === null) {
      setAgents(agents);
    } else {
      getAgents(roleId).then(agents => {
        setAgents(agents);
      })
    }
  }

  const handleEditAgent = (agentId: string) => {
    const agentToEdit = agents.find(a => a.id === agentId);
    if (agentToEdit) {
      setEditingAgent(agentToEdit);
      setIsFormVisible(true);
    }
  };

  const handleSaveAgent = async (agentData: { name: string; masterPrompt: string; model: string; roleId?: string }) => {
    try {
      if (editingAgent) {
        const updated = await apiUpdateAgent(editingAgent.id, agentData);
        setAgents(prev => prev.map(a => (a.id === editingAgent.id ? updated : a)));
      } else {
        const created = await apiCreateAgent(agentData);
        setAgents(prev => [...prev, created]);
      }
    } catch (e) {
      console.error(e);
      alert('Failed to save agent. See console for details.');
    } finally {
      setIsFormVisible(false);
      setEditingAgent(null);
    }
  };

  const handleCopyAgent = async (agentId: string) => {
    try {
      const duplicated = await apiDuplicateAgent(agentId);
      setAgents(prev => [...prev, duplicated]);
    } catch (e) {
      console.error(e);
      alert('Failed to duplicate agent.');
    }
  };

  const handleDeleteAgent = async (agentId: string) => {
    if (!window.confirm("Are you sure you want to delete this agent and all its conversations?")) return;
    try {
      await apiDeleteAgent(agentId);
      setAgents(prev => prev.filter(a => a.id !== agentId));
      setConversations(prev => {
        const next = { ...prev };
        delete next[agentId];
        return next;
      });
      if (activeAgentId === agentId) {
        setActiveAgentId(null);
        setView('AGENT_LIST');
      }
    } catch (e) {
      console.error(e);
      alert('Failed to delete agent.');
    }
  };

  const handleSelectChat = async (agentId: string) => {
    setActiveAgentId(agentId);
    try {
      const convs = await apiGetConversations(agentId);
      setConversations(prev => ({ ...prev, [agentId]: convs }));
    } catch (e) {
      console.error(e);
    }
    setView('CHAT');
  };

  const handleBackToAgentList = () => {
    setActiveAgentId(null);
    setView('AGENT_LIST');
  };

  const updateConversationsForAgent = useCallback((agentId: string, updatedConversations: Conversation[]) => {
      setConversations(prev => ({
          ...prev,
          [agentId]: updatedConversations,
      }));
      // Debounce save to backend to avoid excessive writes during streaming
      const timers = saveTimers.current;
      if (timers[agentId]) {
        clearTimeout(timers[agentId]);
      }
      timers[agentId] = window.setTimeout(async () => {
        try {
          await apiReplaceConversations(agentId, updatedConversations);
        } catch (e) {
          console.error('Failed to save conversations', e);
        }
      }, 500);
  }, [setConversations]);

  const renderContent = () => {
    if (view === 'CHAT' && activeAgentId) {
      const agent = agents.find(a => a.id === activeAgentId);
      if (agent) {
        return <ChatView
          agent={agent}
          conversations={conversations[activeAgentId] || []}
          onBack={handleBackToAgentList}
          updateConversations={updateConversationsForAgent}
        />;
      }
    }

    if (isLoadingAgents) {
      return (
        <div className="w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
          <div className="flex items-center gap-3 text-brand-text-light">
            <svg className="animate-spin h-5 w-5 text-brand-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
            </svg>
            <span>Loading your agents…</span>
          </div>
        </div>
      );
    }

    return <AgentList
      agents={agents}
      onChat={handleSelectChat}
      onEdit={handleEditAgent}
      onCopy={handleCopyAgent}
      onDelete={handleDeleteAgent}
      onCreate={handleCreateNewAgent}
    />;
  };

  useEffect(() => {
    return () => {
      const timers = saveTimers.current;
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  if (checkingAuth) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-brand-text-light">
          <svg className="animate-spin h-5 w-5 text-brand-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
          </svg>
          <span>Checking authentication…</span>
        </div>
      </main>
    );
  }

  if (!user) {
    return <Login onLoggedIn={handleLoggedIn} />;
  }

  const Layout = ({children}: { children: React.ReactNode }) => (
    <div className="flex h-screen overflow-hidden">
      {view !== "CHAT" && (
        <>
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="fixed top-4 left-4 z-50 p-2 bg-brand-surface border border-brand-surface-light rounded hover:bg-brand-surface-light"
            aria-label="Toggle sidebar"
          >
            <BarsIcon className="w-5 h-5" />
          </button>
          <Sidebar
            user={user}
            roles={roles}
            handleFilterAgents={handleFilterAgents}
            handleLogout={handleLogout}
            isOpen={isSidebarOpen}
            isMobile={isMobile}
            onClose={() => setIsSidebarOpen(false)}
          />
        </>
      )}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  );

  return (
    <BrowserRouter>
      <main className="h-screen overflow-hidden">
        <Routes>
          <Route path="/" element={<Layout>{renderContent()}</Layout>}/>
          <Route path="/settings" element={
            <Layout>
              <Settings user={user} />
            </Layout>
          }/>
          <Route path="/users" element={
            <Layout>
              <Users roles={roles} />
            </Layout>
          }/>
        </Routes>
        {isFormVisible && (
          <AgentForm
            agent={editingAgent}
            roles={roles}
            onSave={handleSaveAgent}
            onClose={() => setIsFormVisible(false)}
          />
        )}
      </main>
    </BrowserRouter>
  );
}

export default App;
