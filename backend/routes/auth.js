const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const LoginLog = require('../models/LoginLog');
const { protect, authorize } = require('../middleware/auth');
const { enhancedValidation } = require('../middleware/advancedSecurity');
const { loginLimiter, generalLimiter, sanitizeInput, validateInput, securityHeaders } = require('../middleware/security');
const { sendOTPEmail } = require('../utils/email');

// Real-time logging function
const logActivity = (action, details = {}) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] AUTH: ${action}`, details);
};
const crypto = require('crypto');

// Helper function to create login log
const createLoginLog = async (user, req, status, failureReason = null) => {
  try {
    // Only create log if user exists (has valid _id)
    if (user && user._id) {
      await LoginLog.create({
        user: user._id,
        email: user.email,
        username: user.username,
        ipAddress: '',
        userAgent: '',
        status,
        failureReason
      });
    }
  } catch (error) {
    console.error('Error creating login log:', error);
  }
};

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '1h'
  });
};

// @route   POST /api/auth/register
// @desc    Public registration disabled - Admin only
// @access  Public
router.post('/register', async (req, res) => {
  return res.status(403).json({
    success: false,
    message: 'Public registration is currently disabled. Please contact the administrator for account creation.',
    adminContact: 'ctfquest@gmail.com',
    registrationDisabled: true
  });
});

// @route   POST /api/auth/verify-otp
// @desc    Verify OTP and activate user account
// @access  Public
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Validate input
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and OTP'
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() }).select('+otp');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if already verified
    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email already verified'
      });
    }

    // Verify OTP
    if (!user.verifyOTP(otp)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Mark email as verified and clear OTP
    user.isEmailVerified = true;
    user.clearOTP();
    await user.save();

    // Generate token
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Email verified successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        points: user.points,
        isEmailVerified: user.isEmailVerified
      }
    });
  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ?
        `Error verifying OTP: ${error.message}` :
        'Error verifying OTP. Please try again later.'
    });
  }
});

// @route   POST /api/auth/resend-otp
// @desc    Resend OTP to email
// @access  Public
router.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email'
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email already verified'
      });
    }

    // Generate new OTP
    const otp = user.generateOTP();
    await user.save();

    // Send OTP email
    try {
      await sendOTPEmail(user.email, otp);
    } catch (emailError) {
      console.error('Failed to send OTP email:', emailError);
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification email. Please try again.'
      });
    }

    res.json({
      success: true,
      message: 'OTP resent successfully'
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ?
        `Error resending OTP: ${error.message}` :
        'Error resending OTP. Please try again later.'
    });
  }
});

// @route   POST /api/auth/register-admin
// @desc    Register a user (Admin only)
// @access  Private/Admin
router.post('/register-admin', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { username, email, password, teamId } = req.body;

    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    // Check if user already exists
    const userExists = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (userExists) {
      return res.status(400).json({
        success: false,
        message: userExists.email === email ?
          'Email already registered' :
          'Username already taken'
      });
    }

    // Create user
    const user = await User.create({
      username,
      email,
      password,
      team: teamId || undefined
    });

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        points: user.points,
        team: user.team
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ?
        `Error creating user: ${error.message}` :
        'Error creating user. Please try again later.'
    });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', loginLimiter, sanitizeInput, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Enhanced input validation
    let validatedEmail;
    try {
      validatedEmail = enhancedValidation.email(email);
      logActivity('LOGIN_ATTEMPT', { email: validatedEmail, ip: req.ip, userAgent: req.get('User-Agent') });
    } catch (validationError) {
      logActivity('LOGIN_VALIDATION_FAILED', { email, error: validationError.message, ip: req.ip });
      return res.status(400).json({
        success: false,
        message: validationError.message
      });
    }

    // Check for user
    const user = await User.findOne({ email: validatedEmail }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if account is locked
    if (user.isLocked()) {
      await createLoginLog(user, req, 'failed', 'Account locked');
      
      return res.status(401).json({
        success: false,
        message: 'Account is locked. Please try again later'
      });
    }

    // Check if user is blocked by admin
    if (user.isBlocked) {
      await createLoginLog(user, req, 'failed', 'Account blocked by admin');
      
      return res.status(403).json({
        success: false,
        message: 'You are blocked. Suspicious activity detected. Contact Admin for further information.',
        isBlocked: true,
        blockedReason: user.blockedReason
      });
    }

    // Check if password matches
    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      // Log failed login attempt
      await createLoginLog(user, req, 'failed', 'Invalid password');
      
      // Increment login attempts with enhanced tracking
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      
      // Lock account after max attempts
      const maxAttempts = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 3;
      if (user.failedLoginAttempts >= maxAttempts) {
        const lockTime = parseInt(process.env.LOGIN_TIMEOUT) || 30;
        user.accountLockExpires = new Date(Date.now() + lockTime * 60 * 1000);
        logActivity('ACCOUNT_LOCKED', { userId: user._id, ip: req.ip, attempts: user.failedLoginAttempts });
      }
      
      await user.save();
      await user.incrementLoginAttempts();

      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Reset login attempts and update login info
    user.failedLoginAttempts = 0;
    user.accountLockExpires = undefined;
    user.lastLoginAt = new Date();
    user.lastLoginIP = req.ip;
    await user.save();
    
    await user.resetLoginAttempts();

    // Log successful login
    await createLoginLog(user, req, 'success');

    // Populate team info
    await user.populate('team');

    // Generate token with shorter expiry for security
    const token = generateToken(user._id);
    logActivity('LOGIN_SUCCESS', { userId: user._id, username: user.username, ip: req.ip, userAgent: req.get('User-Agent') });

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        points: user.points,
        team: user.team
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ? error.message : 'Error logging in'
    });
  }
});

// @route   POST /api/auth/forgotpassword
// @desc    Forgot password
// @access  Public
router.post('/forgotpassword', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'There is no user with that email'
      });
    }

    // Get reset token
    const resetToken = user.createPasswordResetToken();
    await user.save();

    // TODO: Send email with reset token
    // For now, just return the token in development
    if (process.env.NODE_ENV === 'development') {
      return res.json({
        success: true,
        resetToken
      });
    }

    res.json({
      success: true,
      message: 'Email sent'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ? error.message : 'Error processing request'
    });
  }
});

// @route   POST /api/auth/resetpassword/:resettoken
// @desc    Reset password
// @access  Public
router.post('/resetpassword/:resettoken', async (req, res) => {
  try {
    // Get hashed token
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(req.params.resettoken)
      .digest('hex');

    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Set new password
    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Password reset successful'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ? error.message : 'Error resetting password'
    });
  }
});

// @route   GET /api/auth/me
// @desc    Get current logged in user
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('team');

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        isBlocked: true,
        message: 'Your account has been blocked. Contact Admin for further information.',
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          isBlocked: user.isBlocked,
          blockedReason: user.blockedReason,
          blockedAt: user.blockedAt
        }
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        points: user.points,
        team: user.team,
        solvedChallenges: user.solvedChallenges,
        createdAt: user.createdAt,
        isBlocked: user.isBlocked
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ? error.message : 'Error fetching user data'
    });
  }
});

// @route   GET /api/auth/leaderboard
// @desc    Get leaderboard by teams or users
// @access  Private
router.get('/leaderboard', protect, async (req, res) => {
  try {
    // Check if leaderboard is enabled
    if (process.env.LEADERBOARD_ENABLED === 'false') {
      return res.status(403).json({
        success: false,
        message: 'This is currently disabled by Admin',
        leaderboardDisabled: true
      });
    }

    const { type = 'teams' } = req.query;
    console.log('Fetching leaderboard data...', { type });

    if (type === 'teams') {
      const Team = require('../models/Team');
      const teams = await Team.find()
        .select('name solvedChallenges members')
        .populate('members', 'username email points')
        .lean();

      // Calculate total points for each team by summing member points
      const teamsWithPoints = teams.map(team => ({
        ...team,
        points: team.members.reduce((total, member) => total + (member.points || 0), 0)
      })).sort((a, b) => b.points - a.points).slice(0, 20);

      console.log('Leaderboard teams:', teamsWithPoints.map(t => ({ name: t.name, members: t.members.length, points: t.points })));

      res.json({
        success: true,
        type: 'teams',
        data: teamsWithPoints
      });
    } else {
      const users = await User.find({ role: 'user' })
        .select('username points solvedChallenges role team')
        .populate('team', 'name')
        .sort({ points: -1 })
        .limit(50);

      console.log('Leaderboard users:', users.map(u => ({ username: u.username, role: u.role })));

      res.json({
        success: true,
        type: 'users',
        data: users
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ? error.message : 'Error fetching leaderboard'
    });
  }
});

// @route   GET /api/auth/users
// @desc    Get all users with pagination (admin only)
// @access  Private/Admin
router.get('/users', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { all } = req.query;
    
    if (all === 'true') {
      // Return all users without pagination for team creation
      const users = await User.find()
        .select('-password')
        .populate('team', 'name')
        .sort({ username: 1 });

      return res.json({
        success: true,
        count: users.length,
        total: users.length,
        users
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const totalUsers = await User.countDocuments();
    const users = await User.find()
      .select('-password')
      .populate('team', 'name')
      .limit(limit)
      .skip(skip)
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: users.length,
      total: totalUsers,
      page,
      pages: Math.ceil(totalUsers / limit),
      users
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ? error.message : 'Error fetching users'
    });
  }
});

// @route   GET /api/auth/users/:id
// @desc    Get single user by ID (admin only)
// @access  Private/Admin
router.get('/users/:id', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ? error.message : 'Error fetching user'
    });
  }
});

// @route   POST /api/auth/reset-platform
// @desc    Reset all user points, solved challenges, and challenge solves (admin only)
// @access  Private/Admin
router.post('/reset-platform', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    console.log('Resetting platform data...');

    // Import Challenge model
    const Challenge = require('../models/Challenge');

    // Reset all users' points and solved challenges
    const userUpdateResult = await User.updateMany(
      {}, // Match all users
      {
        $set: {
          points: 0,
          solvedChallenges: []
        }
      }
    );

    // Reset all challenges' solvedBy arrays
    const challengeUpdateResult = await Challenge.updateMany(
      {}, // Match all challenges
      { $set: { solvedBy: [] } }
    );

    console.log('Reset complete. Users updated:', userUpdateResult.modifiedCount);
    console.log('Reset complete. Challenges updated:', challengeUpdateResult.modifiedCount);

    res.json({
      success: true,
      message: 'Platform reset successful',
      stats: {
        usersReset: userUpdateResult.modifiedCount,
        challengesReset: challengeUpdateResult.modifiedCount
      }
    });
  } catch (error) {
    console.error('Error resetting platform:', error);
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ?
        `Error resetting platform: ${error.message}` :
        'Error resetting platform. Please try again.'
    });
  }
});

// @route   PUT /api/auth/users/:id/role
// @desc    Change user role (Admin/Superadmin)
// @access  Private/Admin
router.put('/users/:id/role', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin can change user roles'
      });
    }

    const { newRole } = req.body;

    if (!newRole || !['admin', 'user'].includes(newRole)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be "admin" or "user"'
      });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.role === 'superadmin') {
      return res.status(400).json({
        success: false,
        message: 'Cannot change superadmin role'
      });
    }

    const oldRole = user.role;
    user.role = newRole;
    await user.save();

    res.json({
      success: true,
      message: `User role changed from ${oldRole} to ${newRole}`,
      data: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Error changing user role:', error);
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ?
        `Error changing role: ${error.message}` :
        'Error changing user role. Please try again.'
    });
  }
});

// @route   DELETE /api/auth/users/:id
// @desc    Delete a user (Admin only)
// @access  Private/Admin
router.delete('/users/:id', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.role === 'superadmin') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete superadmin user'
      });
    }

    await User.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'User deleted successfully',
      data: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ?
        `Error deleting user: ${error.message}` :
        'Error deleting user. Please try again.'
    });
  }
});

// @route   PUT /api/auth/users/:id/block
// @desc    Block or unblock a user (Admin only)
// @access  Private/Admin
router.put('/users/:id/block', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { isBlocked, reason } = req.body;

    if (typeof isBlocked !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isBlocked must be a boolean'
      });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.role === 'superadmin') {
      return res.status(400).json({
        success: false,
        message: 'Cannot block superadmin user'
      });
    }

    user.isBlocked = isBlocked;
    user.blockedReason = isBlocked ? reason || 'No reason provided' : null;
    user.blockedAt = isBlocked ? new Date() : null;
    await user.save();

    res.json({
      success: true,
      message: `User ${isBlocked ? 'blocked' : 'unblocked'} successfully`,
      data: {
        id: user._id,
        username: user.username,
        email: user.email,
        isBlocked: user.isBlocked,
        blockedReason: user.blockedReason
      }
    });
  } catch (error) {
    console.error('Error blocking/unblocking user:', error);
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ?
        `Error updating user block status: ${error.message}` :
        'Error updating user block status. Please try again.'
    });
  }
});

// @route   PUT /api/auth/users/:id/submission-permission
// @desc    Update user submission permission (Admin only)
// @access  Private/Admin
router.put('/users/:id/submission-permission', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { canSubmitFlags } = req.body;

    if (typeof canSubmitFlags !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'canSubmitFlags must be a boolean'
      });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.canSubmitFlags = canSubmitFlags;
    await user.save();

    res.json({
      success: true,
      message: `User submission permission ${canSubmitFlags ? 'allowed' : 'blocked'}`,
      data: {
        id: user._id,
        username: user.username,
        email: user.email,
        canSubmitFlags: user.canSubmitFlags
      }
    });
  } catch (error) {
    console.error('Error updating submission permission:', error);
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ?
        `Error updating submission permission: ${error.message}` :
        'Error updating submission permission. Please try again.'
    });
  }
});

// @route   PUT /api/auth/users/:id/leaderboard-visibility
// @desc    Update user leaderboard visibility (Admin only)
// @access  Private/Admin
router.put('/users/:id/leaderboard-visibility', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { showInLeaderboard } = req.body;

    if (typeof showInLeaderboard !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'showInLeaderboard must be a boolean'
      });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.showInLeaderboard = showInLeaderboard;
    await user.save();

    res.json({
      success: true,
      message: `User ${showInLeaderboard ? 'shown on' : 'hidden from'} leaderboard`,
      data: {
        id: user._id,
        username: user.username,
        email: user.email,
        showInLeaderboard: user.showInLeaderboard
      }
    });
  } catch (error) {
    console.error('Error updating leaderboard visibility:', error);
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ?
        `Error updating leaderboard visibility: ${error.message}` :
        'Error updating leaderboard visibility. Please try again.'
    });
  }
});

// @route   PUT /api/platform-control/block-submissions
// @desc    Block or allow all submissions globally (Admin only)
// @access  Private/Admin
router.put('/platform-control/block-submissions', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { submissionsAllowed } = req.body;

    if (typeof submissionsAllowed !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'submissionsAllowed must be a boolean'
      });
    }

    const Challenge = require('../models/Challenge');
    
    await Challenge.updateMany(
      {},
      { submissionsAllowed }
    );

    res.json({
      success: true,
      message: `All submissions ${submissionsAllowed ? 'allowed' : 'blocked'}`,
      data: {
        submissionsAllowed
      }
    });
  } catch (error) {
    console.error('Error updating global submission status:', error);
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ?
        `Error updating submission status: ${error.message}` :
        'Error updating submission status. Please try again.'
    });
  }
});

// @route   PUT /api/platform-control/leaderboard-toggle
// @desc    Enable or disable leaderboard globally (Admin only)
// @access  Private/Admin
router.put('/platform-control/leaderboard-toggle', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { leaderboardEnabled } = req.body;

    if (typeof leaderboardEnabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'leaderboardEnabled must be a boolean'
      });
    }

    // Store in environment or database - for now using a simple approach
    process.env.LEADERBOARD_ENABLED = leaderboardEnabled.toString();

    res.json({
      success: true,
      message: `Leaderboard ${leaderboardEnabled ? 'enabled' : 'disabled'}`,
      data: {
        leaderboardEnabled
      }
    });
  } catch (error) {
    console.error('Error updating leaderboard status:', error);
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ?
        `Error updating leaderboard status: ${error.message}` :
        'Error updating leaderboard status. Please try again.'
    });
  }
});

// @route   PUT /api/platform-control/connection-limit
// @desc    Set maximum concurrent connections (Admin only)
// @access  Private/Admin
router.put('/platform-control/connection-limit', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { maxConnections } = req.body;

    if (typeof maxConnections !== 'number' || maxConnections < 1) {
      return res.status(400).json({
        success: false,
        message: 'maxConnections must be a positive number'
      });
    }

    // Store in environment variable for simplicity
    process.env.MAX_CONNECTIONS = maxConnections.toString();

    res.json({
      success: true,
      message: `Connection limit set to ${maxConnections}`,
      data: {
        maxConnections
      }
    });
  } catch (error) {
    console.error('Error updating connection limit:', error);
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ?
        `Error updating connection limit: ${error.message}` :
        'Error updating connection limit. Please try again.'
    });
  }
});

// @route   PUT /api/platform-control/unblock-all-users
// @desc    Unblock all blocked users (Admin only)
// @access  Private/Admin
router.put('/platform-control/unblock-all-users', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const result = await User.updateMany(
      { isBlocked: true },
      {
        $set: {
          isBlocked: false,
          blockedReason: null,
          blockedAt: null
        }
      }
    );

    res.json({
      success: true,
      message: 'All users unblocked successfully',
      data: {
        unblockedCount: result.modifiedCount
      }
    });
  } catch (error) {
    console.error('Error unblocking all users:', error);
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ?
        `Error unblocking users: ${error.message}` :
        'Error unblocking users. Please try again.'
    });
  }
});

// @route   PUT /api/platform-control/unblock-by-email/:email
// @desc    Unblock a user by email (Admin only)
// @access  Private/Admin
router.put('/platform-control/unblock-by-email/:email', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { email } = req.params;

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.isBlocked = false;
    user.blockedReason = null;
    user.blockedAt = null;
    await user.save();

    res.json({
      success: true,
      message: `User ${user.username} unblocked successfully`,
      data: {
        id: user._id,
        username: user.username,
        email: user.email,
        isBlocked: user.isBlocked
      }
    });
  } catch (error) {
    console.error('Error unblocking user by email:', error);
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ?
        `Error unblocking user: ${error.message}` :
        'Error unblocking user. Please try again.'
    });
  }
});

// @route   GET /api/auth/admin/login-logs
// @desc    Get login logs (Admin only)
// @access  Private/Admin
router.get('/admin/login-logs', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { userId, status, search } = req.query;

    // Build query
    let query = {};
    if (userId) query.user = userId;
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } }
      ];
    }

    const totalLogs = await LoginLog.countDocuments(query);
    const logs = await LoginLog.find(query)
      .populate('user', 'username email role')
      .sort({ loginTime: -1 })
      .limit(limit)
      .skip(skip);

    res.json({
      success: true,
      count: logs.length,
      total: totalLogs,
      page,
      pages: Math.ceil(totalLogs / limit),
      logs
    });
  } catch (error) {
    console.error('Error fetching login logs:', error);
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ? error.message : 'Error fetching login logs'
    });
  }
});

// @route   GET /api/auth/admin/login-logs/:userId
// @desc    Get login logs for specific user (Admin only)
// @access  Private/Admin
router.get('/admin/login-logs/:userId', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const totalLogs = await LoginLog.countDocuments({ user: userId });
    const logs = await LoginLog.find({ user: userId })
      .populate('user', 'username email role')
      .sort({ loginTime: -1 })
      .limit(limit)
      .skip(skip);

    res.json({
      success: true,
      count: logs.length,
      total: totalLogs,
      page,
      pages: Math.ceil(totalLogs / limit),
      logs
    });
  } catch (error) {
    console.error('Error fetching user login logs:', error);
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ? error.message : 'Error fetching user login logs'
    });
  }
});

// @route   DELETE /api/auth/admin/login-logs
// @desc    Clear old login logs (Admin only)
// @access  Private/Admin
router.delete('/admin/login-logs', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));

    const result = await LoginLog.deleteMany({
      loginTime: { $lt: cutoffDate }
    });

    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} login logs older than ${days} days`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error clearing login logs:', error);
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ? error.message : 'Error clearing login logs'
    });
  }
});

// @route   PUT /api/auth/admin/change-password
// @desc    Change admin password (Admin only - can only change own password)
// @access  Private/Admin
router.put('/admin/change-password', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide current password and new password'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    // Get current user with password
    const user = await User.findById(req.user.id).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    logActivity('ADMIN_PASSWORD_CHANGED', { userId: user._id, username: user.username });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Error changing admin password:', error);
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ?
        `Error changing password: ${error.message}` :
        'Error changing password. Please try again.'
    });
  }
});

module.exports = router;
