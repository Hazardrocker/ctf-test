const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Challenge = require('../models/Challenge');
const { protect, authorize } = require('../middleware/auth');

// @route   GET /api/analytics/overview
// @desc    Get platform overview metrics
// @access  Private/Admin
router.get('/overview', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } });
    const adminUsers = await User.countDocuments({ role: 'admin' });
    const blockedUsers = await User.countDocuments({ isBlocked: true });
    const totalChallenges = await Challenge.countDocuments();
    const visibleChallenges = await Challenge.countDocuments({ isVisible: true });

    const allUsers = await User.find().select('solvedChallenges points createdAt');
    const totalSubmissions = allUsers.reduce((sum, user) => sum + (user.solvedChallenges?.length || 0), 0);
    const totalPoints = allUsers.reduce((sum, user) => sum + (user.points || 0), 0);
    const avgPointsPerUser = totalUsers > 0 ? (totalPoints / totalUsers).toFixed(2) : 0;

    res.json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          active: activeUsers,
          admins: adminUsers,
          blocked: blockedUsers
        },
        challenges: {
          total: totalChallenges,
          visible: visibleChallenges,
          hidden: totalChallenges - visibleChallenges
        },
        submissions: {
          total: totalSubmissions,
          avgPerUser: avgPointsPerUser,
          totalPoints: totalPoints
        }
      }
    });
  } catch (err) {
    console.error('Error fetching analytics overview:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
});

// @route   GET /api/analytics/user-engagement
// @desc    Get user engagement metrics
// @access  Private/Admin
router.get('/user-engagement', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const users = await User.find()
      .select('username createdAt solvedChallenges points isBlocked')
      .sort({ createdAt: -1 });

    const engagementData = users.map(user => ({
      username: user.username,
      joinedDate: user.createdAt,
      challengesSolved: user.solvedChallenges?.length || 0,
      points: user.points || 0,
      isActive: !user.isBlocked,
      daysActive: Math.floor((Date.now() - new Date(user.createdAt)) / (1000 * 60 * 60 * 24))
    }));

    const engagement = {
      highEngagement: engagementData.filter(u => u.challengesSolved >= 5 && u.isActive).length,
      mediumEngagement: engagementData.filter(u => u.challengesSolved >= 2 && u.challengesSolved < 5 && u.isActive).length,
      lowEngagement: engagementData.filter(u => u.challengesSolved < 2 && u.isActive).length,
      inactive: engagementData.filter(u => !u.isActive).length
    };

    res.json({
      success: true,
      data: {
        summary: engagement,
        users: engagementData
      }
    });
  } catch (err) {
    console.error('Error fetching user engagement:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
});

// @route   GET /api/analytics/challenge-stats
// @desc    Get challenge statistics with solved users
// @access  Private/Admin
router.get('/challenge-stats', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const challenges = await Challenge.find()
      .select('title category difficulty points solvedBy isVisible')
      .populate('solvedBy', 'username email points')
      .lean();

    const stats = {
      byCategory: {},
      byDifficulty: {},
      topChallenges: [],
      leastSolved: [],
      solvedChallenges: []
    };

    challenges.forEach(challenge => {
      if (!stats.byCategory[challenge.category]) {
        stats.byCategory[challenge.category] = { count: 0, solved: 0 };
      }
      stats.byCategory[challenge.category].count++;
      stats.byCategory[challenge.category].solved += challenge.solvedBy?.length || 0;

      if (!stats.byDifficulty[challenge.difficulty]) {
        stats.byDifficulty[challenge.difficulty] = { count: 0, avgPoints: 0 };
      }
      stats.byDifficulty[challenge.difficulty].count++;
      stats.byDifficulty[challenge.difficulty].avgPoints += challenge.points;

      // Add solved challenges with users
      if (challenge.solvedBy && challenge.solvedBy.length > 0) {
        stats.solvedChallenges.push({
          title: challenge.title,
          category: challenge.category,
          difficulty: challenge.difficulty,
          points: challenge.points,
          solvedBy: challenge.solvedBy.map(user => ({
            username: user.username,
            email: user.email,
            points: user.points
          }))
        });
      }
    });

    stats.topChallenges = challenges
      .sort((a, b) => (b.solvedBy?.length || 0) - (a.solvedBy?.length || 0))
      .slice(0, 5)
      .map(c => ({
        title: c.title,
        solves: c.solvedBy?.length || 0,
        points: c.points
      }));

    stats.leastSolved = challenges
      .sort((a, b) => (a.solvedBy?.length || 0) - (b.solvedBy?.length || 0))
      .slice(0, 5)
      .map(c => ({
        title: c.title,
        solves: c.solvedBy?.length || 0,
        points: c.points
      }));

    res.json({
      success: true,
      data: stats
    });
  } catch (err) {
    console.error('Error fetching challenge stats:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
});

// @route   GET /api/analytics/traffic
// @desc    Get traffic statistics
// @access  Private/Admin
router.get('/traffic', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const totalUsersLast30 = await User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } });
    const totalUsersLast7 = await User.countDocuments({ createdAt: { $gte: sevenDaysAgo } });
    const totalUsersToday = await User.countDocuments({ createdAt: { $gte: today } });

    const usersPerDay = {};
    const users = await User.find({ createdAt: { $gte: thirtyDaysAgo } }).select('createdAt').lean();
    
    users.forEach(user => {
      const day = new Date(user.createdAt).toISOString().split('T')[0];
      usersPerDay[day] = (usersPerDay[day] || 0) + 1;
    });

    res.json({
      success: true,
      data: {
        last30Days: totalUsersLast30,
        last7Days: totalUsersLast7,
        today: totalUsersToday,
        dailyBreakdown: usersPerDay
      }
    });
  } catch (err) {
    console.error('Error fetching traffic stats:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
});

// @route   GET /api/analytics/leaderboard-stats
// @desc    Get leaderboard statistics
// @access  Private/Admin
router.get('/leaderboard-stats', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const topUsers = await User.find()
      .select('username points solvedChallenges')
      .sort({ points: -1 })
      .limit(10)
      .lean();

    const topUsersData = topUsers.map((user, index) => ({
      rank: index + 1,
      username: user.username,
      points: user.points,
      challengesSolved: user.solvedChallenges?.length || 0
    }));

    res.json({
      success: true,
      data: topUsersData
    });
  } catch (err) {
    console.error('Error fetching leaderboard stats:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
});

// @route   GET /api/analytics/submissions
// @desc    Get detailed submission analytics with all attempts
// @access  Private/Admin
router.get('/submissions', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const Submission = require('../models/Submission');
    
    // Get all submissions with user and challenge details
    const submissions = await Submission.find()
      .populate('user', 'username email points')
      .populate('challenge', 'title category difficulty points')
      .sort({ submittedAt: -1 })
      .lean();

    const totalSubmissions = submissions.length;
    const successfulSubmissions = submissions.filter(s => s.isCorrect).length;
    const failedSubmissions = submissions.filter(s => !s.isCorrect).length;
    const successRate = totalSubmissions > 0 ? ((successfulSubmissions / totalSubmissions) * 100).toFixed(2) : 0;
    const failureRate = (100 - successRate).toFixed(2);

    // Group by user
    const submissionsByUser = {};
    submissions.forEach(sub => {
      const userId = sub.user._id.toString();
      if (!submissionsByUser[userId]) {
        submissionsByUser[userId] = {
          username: sub.user.username,
          email: sub.user.email,
          totalAttempts: 0,
          successfulAttempts: 0,
          failedAttempts: 0,
          points: sub.user.points,
          submissions: []
        };
      }
      submissionsByUser[userId].totalAttempts++;
      if (sub.isCorrect) {
        submissionsByUser[userId].successfulAttempts++;
      } else {
        submissionsByUser[userId].failedAttempts++;
      }
      submissionsByUser[userId].submissions.push({
        challenge: sub.challenge.title,
        category: sub.challenge.category,
        difficulty: sub.challenge.difficulty,
        points: sub.challenge.points,
        submittedFlag: sub.submittedFlag,
        isCorrect: sub.isCorrect,
        submittedAt: sub.submittedAt,
        ipAddress: sub.ipAddress
      });
    });

    // Group by challenge
    const submissionsByChallenge = {};
    submissions.forEach(sub => {
      const challengeId = sub.challenge._id.toString();
      if (!submissionsByChallenge[challengeId]) {
        submissionsByChallenge[challengeId] = {
          title: sub.challenge.title,
          category: sub.challenge.category,
          difficulty: sub.challenge.difficulty,
          points: sub.challenge.points,
          totalAttempts: 0,
          successfulAttempts: 0,
          failedAttempts: 0,
          submissions: []
        };
      }
      submissionsByChallenge[challengeId].totalAttempts++;
      if (sub.isCorrect) {
        submissionsByChallenge[challengeId].successfulAttempts++;
      } else {
        submissionsByChallenge[challengeId].failedAttempts++;
      }
      submissionsByChallenge[challengeId].submissions.push({
        username: sub.user.username,
        email: sub.user.email,
        submittedFlag: sub.submittedFlag,
        isCorrect: sub.isCorrect,
        submittedAt: sub.submittedAt,
        ipAddress: sub.ipAddress
      });
    });

    res.json({
      success: true,
      data: {
        overview: {
          totalSubmissions,
          successfulSubmissions,
          failedSubmissions,
          successRate: parseFloat(successRate),
          failureRate: parseFloat(failureRate)
        },
        submissionsByUser: Object.values(submissionsByUser).sort((a, b) => b.totalAttempts - a.totalAttempts),
        submissionsByChallenge: Object.values(submissionsByChallenge).sort((a, b) => b.totalAttempts - a.totalAttempts),
        allSubmissions: submissions.map(s => ({
          username: s.user.username,
          challenge: s.challenge.title,
          category: s.challenge.category,
          submittedFlag: s.submittedFlag,
          isCorrect: s.isCorrect,
          points: s.isCorrect ? s.challenge.points : 0,
          submittedAt: s.submittedAt,
          ipAddress: s.ipAddress
        }))
      }
    });
  } catch (err) {
    console.error('Error fetching submission analytics:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
});

module.exports = router;
