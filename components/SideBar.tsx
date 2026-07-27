import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { XIcon } from "./Icons";

interface SidebarProps {
  user: {
    firstName: string;
    roles?: string[];
  };
  roles: Array<{ id: string; name: string }>;
  handleFilterAgents: (roleId?: string) => void;
  handleLogout: () => void;
  isOpen: boolean;
  isMobile: boolean;
  onClose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({user, roles, handleFilterAgents, handleLogout, isOpen, isMobile, onClose}) => {
  const navigate = useNavigate();

  return (
    <div className={`w-64 transition-all duration-300 bg-brand-surface border-r border-brand-surface-light flex flex-col overflow-y-auto ${isMobile ? 'fixed left-0 top-0 h-full z-50' : 'fixed left-0 top-0 h-full z-40'} ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      {isMobile && isOpen && (
        <div className="flex justify-end p-2">
          <button onClick={onClose} className="p-2 hover:bg-brand-surface-light rounded">
            <XIcon className="w-5 h-5" />
          </button>
        </div>
      )}
      <div>
        <div className={`text-md font-medium my-6 px-3 ${isOpen ? 'block' : 'hidden'}`}>{user?.firstName}</div>
        {roles.length > 0 && (
          <nav className="mb-4">
            <button
              className="w-full text-left px-5 py-2 text-sm hover:bg-brand-surface-light"
              onClick={() => {
                handleFilterAgents();
                navigate("/");
              }}
            >
              {isOpen ? "All Agents" : ""}
            </button>
            {roles.length > 1 && roles.map(role => (
              <button
                key={role.id}
                className="w-full text-left px-5 py-2 text-sm hover:bg-brand-surface-light"
                onClick={() => {
                  handleFilterAgents(role.id);
                  navigate("/");
                }}
              >
                {isOpen ? `${role.name} Agents` : ""}
              </button>
            ))}
          </nav>
        )}
      </div>
      <div className="mt-auto py-4">
        <nav>
          {roles.some(role => role.name === 'Admin') && (
            <>
              <Link
                to="/settings"
                className="block w-full text-left px-5 py-2 text-sm hover:bg-brand-surface-light rounded"
                aria-label="Settings"
              >
                {isOpen ? "Settings" : ""}
              </Link>
              <Link
                to="/users"
                className="block w-full text-left px-5 py-2 text-sm hover:bg-brand-surface-light rounded"
                aria-label="User Management"
              >
                {isOpen ? "User Management" : ""}
              </Link>
            </>
          )}
          <button
            onClick={handleLogout}
            className="w-full text-left px-5 py-2 text-sm hover:bg-brand-surface-light rounded"
            aria-label="Log out"
          >
            {isOpen ? "Log out" : ""}
          </button>
        </nav>
      </div>
    </div>
  );
};

export default Sidebar;
