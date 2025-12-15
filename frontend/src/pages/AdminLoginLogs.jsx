import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import AuthContext from '../context/AuthContext';
import './AdminLoginLogs.css';

function AdminLoginLogs() {
  const { isAuthenticated, user, token } = useContext(AuthContext);
  const navigate = useNavigate();

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);
  const [filters, setFilters] = useState({
    status: '',
    search: ''
  });

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    } else if (user && user.role !== 'admin') {
      navigate('/');
    }
  }, [isAuthenticated, user, navigate]);

  useEffect(() => {
    fetchLogs();
  }, [page, filters, token]);

  const fetchLogs = async () => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20'
      });

      if (filters.status) params.append('status', filters.status);
      if (filters.search) params.append('search', filters.search);

      const res = await axios.get(`/api/auth/admin/login-logs?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setLogs(res.data.logs);
      setTotalPages(res.data.pages);
      setTotalLogs(res.data.total);
    } catch (err) {
      console.error('Error fetching login logs:', err);
      setError('Failed to fetch login logs');
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
    setPage(1);
  };

  const clearOldLogs = async () => {
    if (!window.confirm('Are you sure you want to delete login logs older than 30 days?')) {
      return;
    }

    try {
      await axios.delete('/api/auth/admin/login-logs?days=30', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      fetchLogs();
      alert('Old login logs cleared successfully');
    } catch (err) {
      console.error('Error clearing logs:', err);
      setError('Failed to clear old logs');
    }
  };

  const getStatusBadge = (status) => {
    return (
      <span className={`status-badge ${status}`}>
        {status === 'success' ? '✓ Success' : '✗ Failed'}
      </span>
    );
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  if (loading && logs.length === 0) {
    return (
      <div className="admin-login-logs">
        <div className="loading">Loading login logs...</div>
      </div>
    );
  }

  return (
    <div className="admin-login-logs">
      <div className="logs-header">
        <h1>Login <span className="highlight">Logs</span></h1>
        <p>Monitor user login activities and security events</p>
        <button className="back-button" onClick={() => navigate('/admin')}>
          ← Back to Dashboard
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="logs-controls">
        <div className="filters">
          <input
            type="text"
            name="search"
            placeholder="Search by email or username..."
            value={filters.search}
            onChange={handleFilterChange}
            className="search-input"
          />
          <select
            name="status"
            value={filters.status}
            onChange={handleFilterChange}
            className="filter-select"
          >
            <option value="">All Status</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div className="actions">
          <button onClick={clearOldLogs} className="clear-logs-btn">
            Clear Old Logs
          </button>
          <button onClick={fetchLogs} className="refresh-btn">
            Refresh
          </button>
        </div>
      </div>

      <div className="logs-stats">
        <div className="stat-item">
          <span className="stat-number">{totalLogs}</span>
          <span className="stat-label">Total Logs</span>
        </div>
        <div className="stat-item">
          <span className="stat-number">
            {logs.filter(log => log.status === 'success').length}
          </span>
          <span className="stat-label">Successful</span>
        </div>
        <div className="stat-item">
          <span className="stat-number">
            {logs.filter(log => log.status === 'failed').length}
          </span>
          <span className="stat-label">Failed</span>
        </div>
      </div>

      <div className="logs-table-container">
        <table className="logs-table">
          {/* IP Address and Device columns removed for privacy */}
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Email</th>
              <th>Status</th>
              <th>Failure Reason</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(log => (
              <tr key={log._id} className={`log-row ${log.status}`}>
                <td>{formatDate(log.loginTime)}</td>
                <td>
                  <div className="user-info">
                    <span className="username">{log.username}</span>
                    {log.user && (
                      <span className={`role-badge ${log.user.role}`}>
                        {log.user.role}
                      </span>
                    )}
                  </div>
                </td>
                <td>{log.email}</td>
                <td>{getStatusBadge(log.status)}</td>
                <td>
                  {log.failureReason && (
                    <span className="failure-reason">{log.failureReason}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="pagination-btn"
          >
            Previous
          </button>
          <span className="pagination-info">
            Page {page} of {totalPages} ({totalLogs} total logs)
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="pagination-btn"
          >
            Next
          </button>
        </div>
      )}

      {logs.length === 0 && !loading && (
        <div className="no-logs">
          <h3>No login logs found</h3>
          <p>No login activities match your current filters.</p>
        </div>
      )}
    </div>
  );
}

export default AdminLoginLogs;