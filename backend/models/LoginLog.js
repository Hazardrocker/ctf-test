const mongoose = require('mongoose');

const LoginLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  email: {
    type: String,
    required: true
  },
  username: {
    type: String,
    required: true
  },
  ipAddress: {
    type: String,
    required: true
  },
  userAgent: {
    type: String,
    required: true
  },
  loginTime: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['success', 'failed'],
    required: true
  },
  failureReason: {
    type: String,
    default: null
  },
  location: {
    country: String,
    city: String,
    region: String
  },
  deviceInfo: {
    browser: String,
    os: String,
    device: String
  }
}, {
  timestamps: true
});

// Index for better query performance
LoginLogSchema.index({ user: 1, loginTime: -1 });
LoginLogSchema.index({ email: 1, loginTime: -1 });
LoginLogSchema.index({ loginTime: -1 });
LoginLogSchema.index({ status: 1 });

module.exports = mongoose.model('LoginLog', LoginLogSchema);