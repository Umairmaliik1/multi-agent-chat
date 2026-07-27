import React, {useState, useEffect} from 'react';
import {PlusIcon, EditIcon, TrashIcon} from './Icons';
import {getUsers, createUser, updateUser} from "@/services/api.ts";
import {CreateUserData, Role} from "@/types.ts";

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: Role[];
}

interface UsersProps {
  roles: Role[];
}

const Users: React.FC<UsersProps> = ({roles}) => {
  const [users, setUsers] = useState<User[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [apiError, setApiError] = useState('');

  useEffect(() => {
    getUsers().then(res => setUsers(res));
  }, [])

  const handleAddUser = () => {
    setEditingUser(null);
    setIsModalOpen(true);
  };

  const handleEditUser = (user: User) => {
    setEditingUser(user);
    setIsModalOpen(true);
  };

  const handleDeleteUser = async (userId: string) => {
    if (window.confirm('Are you sure you want to delete this user?')) {
      try {
        // API call to delete user
        setUsers(users.filter(user => user.id !== userId));
      } catch (error) {
        console.error('Failed to delete user:', error);
      }
    }
  };

  const handleSubmit = async (data: CreateUserData) => {
    try {
      setApiError('');
      if (editingUser) {
        const updatedUser = await updateUser(editingUser.id, data);
        setUsers(users.map(user =>
          user.id === editingUser.id ? updatedUser : user
        ));
      } else {
        const newUser = await createUser(data);
        setUsers([...users, newUser]);
      }
      setIsModalOpen(false);
    } catch (error) {
      console.error('Failed to save user:', error);
      setApiError(error instanceof Error ? error.message : 'Failed to save user');
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 mb-8">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">Users</h1>
          <button
            onClick={handleAddUser}
            className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-brand-bg font-semibold rounded-lg shadow-md hover:bg-opacity-90 transition-all duration-200"
          >
            <PlusIcon className="w-5 h-5"/>
            New User
          </button>
        </div>
        <input
          type="text"
          placeholder="Search users..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full p-2 rounded-lg border border-brand-surface-light bg-brand-surface focus:outline-none focus:border-brand-primary"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full table-auto">
          <thead>
          <tr className="bg-brand-surface">
            <th
              className="px-6 py-3 text-left text-xs font-medium text-brand-text-light uppercase tracking-wider">Name
            </th>
            <th
              className="px-6 py-3 text-left text-xs font-medium text-brand-text-light uppercase tracking-wider">Email
            </th>
            <th
              className="px-6 py-3 text-left text-xs font-medium text-brand-text-light uppercase tracking-wider">Roles
            </th>
            <th
              className="px-6 py-3 text-right text-xs font-medium text-brand-text-light uppercase tracking-wider">Actions
            </th>
          </tr>
          </thead>
          {users
          .filter(user =>
            user.firstName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            user.lastName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            user.email.toLowerCase().includes(searchQuery.toLowerCase())
          )
          .map(user => (
            <tr key={user.id}
                className="bg-brand-surface border-b border-brand-surface-light hover:bg-brand-surface-light">
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm font-medium text-brand-primary">{user.firstName} {user.lastName}</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-brand-text-light">{user.email}</div>
              </td>
              <td className="px-6 py-4">
                <div className="flex flex-wrap gap-2">
                  {user.roles.map(role => (
                    <span key={role.id} className="text-xs px-2 py-1 bg-brand-surface-light rounded-full">
                      {role.name}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right">
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => handleEditUser(user)}
                    className="p-2 text-brand-text-light hover:text-brand-primary transition-colors"
                  >
                    <EditIcon className="w-5 h-5"/>
                  </button>
                  <button
                    onClick={() => handleDeleteUser(user.id)}
                    className="p-2 text-brand-text-light hover:text-red-500 transition-colors"
                  >
                    <TrashIcon className="w-5 h-5"/>
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-brand-surface-light rounded-lg p-6 w-full max-w-lg">
            <h2 className="text-xl font-bold mb-4">
              {editingUser ? 'Edit User' : 'Add New User'}
            </h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const password = formData.get('password') as string;
              const confirmPassword = formData.get('confirmPassword') as string;

              if ((password || confirmPassword) && password !== confirmPassword) {
                setPasswordError('Passwords do not match');
                return;
              }
              setPasswordError('');

              handleSubmit({
                firstName: formData.get('firstName') as string,
                lastName: formData.get('lastName') as string,
                email: formData.get('email') as string,
                password: password || undefined,
                roleIds: Array.from(formData.getAll('roles') as string[]),
              });
            }}>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-sm font-medium mb-1">First Name</label>
                    <input
                      name="firstName"
                      defaultValue={editingUser?.firstName}
                      className="w-full rounded px-3 py-2 bg-brand-surface"
                      required
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium mb-1">Last Name</label>
                    <input
                      name="lastName"
                      defaultValue={editingUser?.lastName}
                      className="w-full rounded px-3 py-2 bg-brand-surface"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Email</label>
                  <input
                    name="email"
                    type="email"
                    defaultValue={editingUser?.email}
                    className="w-full rounded px-3 py-2 bg-brand-surface"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Password {editingUser && '(Leave blank to keep current)'}
                  </label>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <input
                        name="password"
                        type="password"
                        className="w-full rounded px-3 py-2 bg-brand-surface"
                        required={!editingUser}
                        placeholder="Enter password"
                      />
                    </div>
                    <div className="flex-1">
                      <input
                        name="confirmPassword"
                        type="password"
                        className="w-full rounded px-3 py-2 bg-brand-surface"
                        required={!editingUser}
                        placeholder="Re-type password"
                      />
                    </div>
                  </div>
                </div>
                {passwordError && (
                  <div className="text-red-500 text-sm">{passwordError}</div>
                )}
                {apiError && (
                  <div className="text-red-500 text-sm">{apiError}</div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">Roles</label>
                  <div className="space-y-2">
                    {roles.map(role => (
                      <label key={role.id} className="flex items-center">
                        <input
                          type="checkbox"
                          name="roles"
                          value={role.id}
                          defaultChecked={editingUser?.roles.some(r => r.id === role.id)}
                          className="mr-2"
                        />
                        {role.name}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    setPasswordError('');
                  }}
                  className="px-4 py-2 text-gray-400 hover:text-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-primary text-brand-bg font-semibold rounded"
                >
                  {editingUser ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Users;
