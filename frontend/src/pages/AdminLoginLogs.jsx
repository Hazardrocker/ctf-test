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
  const [autoRefresh, setAutoRefresh] = useState(true);

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

  // Auto-refresh every 5 seconds
  useEffect(() => {
    let interval;
    if (autoRefresh && token) {
      interval = setInterval(() => {
        fetchLogs();
      }, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh, token, page, filters]);

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
    const choice = window.confirm('Choose:\n\nOK = Clear logs older than 30 days\nCancel = Clear ALL logs\n\nClick OK for 30 days, Cancel for ALL');
    
    const confirmMessage = choice ? 
      'Are you sure you want to delete login logs older than 30 days?' :
      'Are you sure you want to delete ALL login logs? This cannot be undone!';
    
    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      const url = choice ? 
        '/api/auth/admin/login-logs?days=30' :
        '/api/auth/admin/login-logs?all=true';
        
      const response = await axios.delete(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      fetchLogs();
      alert(response.data.message || 'Login logs cleared successfully');
    } catch (err) {
      console.error('Error clearing logs:', err);
      setError('Failed to clear logs');
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
    // Format date in Indian timezone with proper formatting
    const date = new Date(dateString);
    return date.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
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
        <p>Monitor user login activities with real-time IP and device tracking</p>
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
          <button 
            onClick={() => setAutoRefresh(!autoRefresh)} 
            className={`auto-refresh-btn ${autoRefresh ? 'active' : ''}`}
          >
            {autoRefresh ? '⏸️ Stop Auto-Refresh' : '▶️ Start Auto-Refresh'}
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
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Email</th>
              <th>IP Address</th>
              <th>User Agent</th>
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
                <td>
                  <span className="ip-address" title={log.ipAddress}>
                    {log.ipAddress || 'Unknown'}
                  </span>
                </td>
                <td>
                  <span className="user-agent" title={log.userAgent}>
                    {log.userAgent ? log.userAgent.substring(0, 50) + (log.userAgent.length > 50 ? '...' : '') : 'Unknown'}
                  </span>
                </td>
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