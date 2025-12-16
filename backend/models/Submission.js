const mongoose = require('mongoose');

const SubmissionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  challenge: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Challenge',
    required: true
  },
  submittedFlag: {
    type: String,
    required: true
  },
  isCorrect: {
    type: Boolean,
    required: true
  },
  points: {
    type: Number,
    default: 0
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  }
});

// Indexes for better performance
SubmissionSchema.index({ user: 1, submittedAt: -1 });
SubmissionSchema.index({ challenge: 1, submittedAt: -1 });
SubmissionSchema.index({ isCorrect: 1 });
SubmissionSchema.index({ submittedAt: -1 });

module.exports = mongoose.model('Submission', SubmissionSchema);