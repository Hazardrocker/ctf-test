import { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import AuthContext from '../context/AuthContext';
import './AdminCreateTeam.css';

function AdminCreateTeam() {
  const { isAuthenticated, user, token } = useContext(AuthContext);
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    members: []
  });

  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    } else if (user && user.role !== 'admin') {
      navigate('/');
    }
  }, [isAuthenticated, user, navigate]);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const config = {
          headers: {
            Authorization: `Bearer ${token}`
          }
        };

        const res = await axios.get('/api/auth/users?all=true', config);
        // Filter out admin users but show all users (including those with teams)
        const allUsers = (res.data.users || []).filter(u => u.role !== 'admin');
        setUsers(allUsers);
        setIsLoading(false);
      } catch (err) {
        console.error('Error fetching users:', err);
        setError('Failed to fetch users');
        setIsLoading(false);
      }
    };

    if (token) {
      fetchUsers();
    }
  }, [token]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value
    });
    setError('');
  };

  const handleMemberChange = (e) => {
    const selected = Array.from(e.target.selectedOptions, option => option.value);
    setFormData({
      ...formData,
      members: selected
    });
    setError('');
  };

  const validateForm = () => {
    if (!formData.name.trim()) {
      setError('Team name is required');
      return false;
    }

    if (formData.members.length < 1) {
      setError('Please select at least 1 member for the team');
      return false;
    }

    if (formData.members.length > 2) {
      setError('Teams can have maximum 2 members');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const config = {
        headers: {
          Authorization: `Bearer ${token}`
        }
      };

      await axios.post(
        '/api/teams',
        {
          name: formData.name,
          description: formData.description,
          members: formData.members
        },
        config
      );

      setSuccessMessage('Team created successfully!');
      setFormData({
        name: '',
        description: '',
        members: []
      });

      setTimeout(() => {
        navigate('/admin');
      }, 2000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create team');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="admin-create-team">
        <div className="create-team-container">
          <p>Loading users...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-create-team">
      <div className="create-team-container">
        <div className="create-team-header">
          <h1>Create New <span className="highlight">Team</span></h1>
          <p>Add a new team with 1-2 members</p>
        </div>

        {error && <div className="error-message">{error}</div>}
        {successMessage && <div className="success-message">{successMessage}</div>}

        <form onSubmit={handleSubmit} className="create-team-form">
          <div className="form-group">
            <label htmlFor="name">Team Name *</label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="Enter team name"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="description">Description (Optional)</label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Enter team description"
              rows="4"
            />
          </div>

          <div className="form-group">
            <label htmlFor="members">
              Select Members * (1-2 members)
            </label>
            <select
              id="members"
              multiple
              value={formData.members}
              onChange={handleMemberChange}
              required
              size={Math.min(users.length, 6)}
            >
              {users.map(u => (
                <option 
                  key={u._id} 
                  value={u._id}
                  disabled={u.team && !formData.members.includes(u._id)}
                  style={{
                    color: u.team ? '#888' : '#fff',
                    fontStyle: u.team ? 'italic' : 'normal'
                  }}
                >
                  {u.username} ({u.email}){u.team ? ' - Already in team' : ''}
                </option>
              ))}
            </select>
            <span className="form-hint">
              Hold Ctrl/Cmd to select/deselect multiple users
            </span>
          </div>

          <div className="members-preview">
            <h3>Selected Members ({formData.members.length}):</h3>
            <div className="members-list">
              {formData.members.length === 0 ? (
                <p className="no-members">No members selected</p>
              ) : (
                formData.members.map(memberId => {
                  const memberUser = users.find(u => u._id === memberId);
                  return (
                    <div key={memberId} className="member-badge">
                      <span>{memberUser?.username}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setFormData({
                            ...formData,
                            members: formData.members.filter(m => m !== memberId)
                          });
                        }}
                        className="remove-btn"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate('/admin')}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating...' : 'Create Team'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AdminCreateTeam;
