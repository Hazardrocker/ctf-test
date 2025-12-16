import { useState, useEffect, useContext } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import axios from 'axios'
import AuthContext from '../context/AuthContext'
import Logger from '../utils/logger'
import './Challenges.css'

const FlagSubmissionModal = ({ challenge, onClose, onSubmit }) => {
  const [flag, setFlag] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!flag.trim()) {
      setError('Please enter a flag');
      return;
    }

    setIsSubmitting(true);
    setError('');
    setSuccess('');

    try {
      await onSubmit(flag);
      setSuccess('Flag submitted successfully!');
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      setError(err.message || 'Failed to submit flag');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Submit Flag: {challenge.title}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {error && <div className="modal-error">{error}</div>}
        {success && <div className="modal-success">{success}</div>}

        <form onSubmit={handleSubmit} className="flag-form">
          <div className="form-group">
            <label htmlFor="flag">Flag</label>
            <input
              type="text"
              id="flag"
              value={flag}
              onChange={(e) => setFlag(e.target.value)}
              placeholder="Enter the flag SECE{Flag}"
              disabled={isSubmitting || success}
            />
          </div>

          <button
            type="submit"
            className="submit-flag-button"
            disabled={isSubmitting || success}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Flag'}
          </button>
        </form>
      </div>
    </div>
  );
};

function Challenges() {
  const [activeCategory, setActiveCategory] = useState('all')
  const [challenges, setChallenges] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalChallenges, setTotalChallenges] = useState(0)
  const { user, isAuthenticated, token, updateUserData } = useContext(AuthContext)
  const itemsPerPage = 12

  const categories = [
    { id: 'all', name: 'All Challenges' },
    { id: 'web', name: 'Web Exploitation' },
    { id: 'crypto', name: 'Cryptography' },
    { id: 'forensics', name: 'Forensics' },
    { id: 'reverse', name: 'Reverse Engineering' },
    { id: 'osint', name: 'OSINT' },
    { id: 'misc', name: 'Miscellaneous' }
  ]

  const fetchChallenges = async (page = 1) => {
    try {
      setLoading(true);
      Logger.info('FETCH_CHALLENGES_START', { page, itemsPerPage });
      
      const config = token ? {
        headers: {
          Authorization: `Bearer ${token}`
        }
      } : {};

      const res = await axios.get(`/api/challenges?page=${page}&limit=${itemsPerPage}`, config);

      if (!res.data.data || !Array.isArray(res.data.data)) {
        setChallenges([]);
        setTotalPages(1);
        setTotalChallenges(0);
        setLoading(false);
        return;
      }

      const visibleChallenges = user?.role === 'admin'
        ? res.data.data
        : res.data.data.filter(challenge => challenge.isVisible === true);

      setChallenges(visibleChallenges);
      setTotalPages(res.data.pages || 1);
      setTotalChallenges(res.data.total || 0);
      setCurrentPage(page);
      setLoading(false);
      Logger.info('FETCH_CHALLENGES_SUCCESS', { 
        count: visibleChallenges.length, 
        totalPages: res.data.pages,
        currentPage: page 
      });
    } catch (err) {
      Logger.error('FETCH_CHALLENGES_ERROR', { error: err.message });
      setError('Failed to fetch challenges. Please try again.');
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChallenges(1);
    setCurrentPage(1);
  }, [user?.role, token, isAuthenticated]);

  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages) {
      fetchChallenges(page);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const openModal = (challenge) => {
    // Always redirect to challenge details page
    navigate(`/challenges/${challenge._id}`);
  };



  const navigate = useNavigate();

  const handleChallengeClick = (challenge) => {
    navigate(`/challenges/${challenge._id}`);
  };

  const filteredChallenges = activeCategory === 'all'
    ? challenges
    : challenges.filter(challenge => challenge.category === activeCategory)

  if (loading) {
    return (
      <div className="challenges-container">
        <div className="loading">Loading challenges...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="challenges-container">
        <div className="error">{error}</div>
      </div>
    )
  }

  return (
    <div className="challenges-container">
      <div className="challenges-header">
        <div className="header-content">
          <h1 className="page-title">Challenges</h1>
          
          {!isAuthenticated && (
            <div className="auth-notice">
              <p>🔒 You can view challenges, but you need to <Link to="/login">login</Link> to solve them and earn points!</p>
            </div>
          )}

          <div className="category-nav">
            {categories.map(category => (
              <button
                key={category.id}
                className={`category-button ${activeCategory === category.id ? 'active' : ''}`}
                onClick={() => setActiveCategory(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>

          {isAuthenticated && user?.role === 'admin' && (
            <Link to="/create-challenge" className="create-challenge-button" style={{marginTop: '1rem', display: 'inline-block'}}>
              Create Challenge
            </Link>
          )}
        </div>
      </div>

      <div className="challenges-main">
        <div className="challenges-grid">
          {challenges.length === 0 && !loading ? (
            <div className="no-challenges">
              <p>No challenges available at the moment. Please check back later!</p>
            </div>
          ) : filteredChallenges.length === 0 ? (
            <div className="no-challenges">
              <p>No challenges found in this category.</p>
            </div>
          ) : (
            filteredChallenges.map(challenge => {
              const isSolved = user?.solvedChallenges?.includes(challenge._id);
              return (
                <div
                  key={challenge._id}
                  className={`challenge-card ${isSolved ? 'solved' : ''}`}
                  onClick={() => handleChallengeClick(challenge)}
                >
                  <div className="challenge-header">
                    <span className={`difficulty-badge ${challenge.difficulty.toLowerCase()}`}>
                      {challenge.difficulty}
                    </span>
                    <span className="points-badge">{challenge.points} pts</span>
                  </div>
                  <h3 className="challenge-title">
                    {challenge.title}
                    {isSolved && <span className="solved-badge">✓</span>}
                  </h3>
                  <div className="challenge-footer">
                    <span className="solved-count">{challenge.solvedBy?.length || 0} solves</span>
                    <button
                      className={`solve-button ${isSolved ? 'solved' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleChallengeClick(challenge);
                      }}
                    >
                      {isSolved ? 'Solved ✓' : 'View Challenge'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        
        {totalPages > 1 && (
          <div className="pagination">
            <button 
              onClick={() => handlePageChange(currentPage - 1)} 
              disabled={currentPage === 1}
              className="pagination-btn"
            >
              Previous
            </button>
            
            <div className="pagination-numbers">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                
                return (
                  <button
                    key={pageNum}
                    onClick={() => handlePageChange(pageNum)}
                    className={`pagination-number ${currentPage === pageNum ? 'active' : ''}`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            
            <button 
              onClick={() => handlePageChange(currentPage + 1)} 
              disabled={currentPage === totalPages}
              className="pagination-btn"
            >
              Next
            </button>
            
            <span className="pagination-info">
              Page {currentPage} of {totalPages} ({totalChallenges} challenges)
            </span>
          </div>
        )}
      </div>


    </div>
  )
}

export default Challenges