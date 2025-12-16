const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Challenge = require('../models/Challenge');
const User = require('../models/User');
const Submission = require('../models/Submission');
const { protect, authorize } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const { sanitizeInput, validateInput, securityHeaders } = require('../middleware/security');
const requestIp = require('request-ip');
const UAParser = require('ua-parser-js');

// Real-time logging function
const logActivity = (action, details = {}) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] CHALLENGE: ${action}`, details);
};

// @route   GET /api/challenges
// @desc    Get all challenges with pagination (filtered by visibility for non-admin users)
// @access  Public
router.get('/', sanitizeInput, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Check if user is authenticated and get user info
    let user = null;
    if (req.headers.authorization) {
      try {
        const jwt = require('jsonwebtoken');
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        user = await User.findById(decoded.id);
      } catch (err) {
        // Token invalid, continue as non-authenticated user
      }
    }

    const query = {};
    // Show all challenges to admins, only visible challenges to others (including non-authenticated users)
    if (!user || user.role !== 'admin') {
      query.isVisible = true;
    }

    const total = await Challenge.countDocuments(query);
    const challenges = await Challenge.find(query)
      .select('-flag')
      .limit(limit)
      .skip(skip)
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: challenges.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: challenges
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   GET /api/challenges/:id
// @desc    Get single challenge
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const challenge = await Challenge.findById(req.params.id).select('-flag');

    if (!challenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }

    res.json({
      success: true,
      data: challenge
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/challenges
// @desc    Create a challenge
// @access  Private/Admin
router.post('/', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const challenge = await Challenge.create(req.body);

    res.status(201).json({
      success: true,
      data: challenge
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/challenges/:id/submit
// @desc    Submit a flag for a challenge
// @access  Private
router.post('/:id/submit', protect, sanitizeInput, async (req, res) => {
  try {
    const { flag } = req.body;

    // Validate and sanitize flag input
    let submittedFlag;
    try {
      submittedFlag = validateInput.flag(flag);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    // Get challenge with flag
    const challenge = await Challenge.findById(req.params.id).select('+flag');
    if (!challenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }

    // Get user
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: `Your account is blocked. Reason: ${user.blockedReason || 'No reason provided'}`
      });
    }

    if (!user.canSubmitFlags) {
      return res.status(403).json({
        success: false,
        message: 'You are not allowed to submit flags'
      });
    }

    if (!challenge.submissionsAllowed) {
      return res.status(403).json({
        success: false,
        message: 'Submissions for this challenge are currently blocked'
      });
    }

    // Check if already solved
    const alreadySolved = user.solvedChallenges.some(
      id => id.toString() === challenge._id.toString()
    );
    if (alreadySolved) {
      return res.status(400).json({
        success: false,
        message: 'You have already solved this challenge'
      });
    }

    // Get IP and User Agent for tracking
    const clientIp = requestIp.getClientIp(req);
    const userAgent = req.get('User-Agent') || 'Unknown';
    
    // Check flag
    const isCorrect = submittedFlag === challenge.flag.trim();
    
    // Create submission record (both success and failure)
    await Submission.create({
      user: req.user.id,
      challenge: challenge._id,
      submittedFlag: submittedFlag,
      isCorrect: isCorrect,
      points: isCorrect ? challenge.points : 0,
      ipAddress: clientIp,
      userAgent: userAgent
    });
    
    if (!isCorrect) {
      return res.status(400).json({
        success: false,
        message: 'Incorrect flag'
      });
    }

    // Update user with solve time
    await User.findByIdAndUpdate(
      req.user.id,
      {
        $addToSet: { solvedChallenges: challenge._id },
        $inc: { points: challenge.points },
        $set: { lastSolveTime: new Date() }
      }
    );

    // Update challenge
    await Challenge.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { solvedBy: req.user.id } }
    );

    logActivity('FLAG_SUBMITTED_SUCCESS', {
      userId: req.user.id,
      challengeId: challenge._id,
      challengeTitle: challenge.title,
      points: challenge.points
    });

    res.json({
      success: true,
      message: `Challenge "${challenge.title}" solved successfully!`,
      points: challenge.points,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Challenge submission error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   DELETE /api/challenges/:id
// @desc    Delete a challenge
// @access  Private/Admin
router.delete('/:id', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const challenge = await Challenge.findById(req.params.id);

    if (!challenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }

    await challenge.deleteOne();

    res.json({
      success: true,
      message: 'Challenge deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   PUT /api/challenges/:id
// @desc    Update a challenge
// @access  Private/Admin
router.put('/:id', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    console.log('Update challenge request:', {
      id: req.params.id,
      body: req.body
    });

    const challenge = await Challenge.findById(req.params.id);

    if (!challenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }

    // If isVisible is being updated, log the change
    if (req.body.hasOwnProperty('isVisible')) {
      console.log('Updating visibility:', {
        challengeId: challenge._id,
        oldVisibility: challenge.isVisible,
        newVisibility: req.body.isVisible
      });
    }

    const updatedChallenge = await Challenge.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true
      }
    );

    console.log('Challenge updated successfully:', {
      challengeId: updatedChallenge._id,
      isVisible: updatedChallenge.isVisible
    });

    res.json({
      success: true,
      data: updatedChallenge
    });
  } catch (error) {
    console.error('Error updating challenge:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
