const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cors = require('cors');
const compression = require('compression');
const session = require('express-session');
const crypto = require('crypto');

// Security middleware imports
const { 
  strictLoginLimiter, 
  apiLimiter, 
  challengeSubmitLimiter,
  advancedHelmet,
  advancedSanitization,
  enhancedValidation,
  csrfProtection,
  secureFileUpload,
  securityLogger,
  mongoSanitize
} = require('./middleware/advancedSecurity');

const { concurrencyMiddleware } = require('./middleware/concurrency');
const { cachingMiddleware, CACHE_CONFIG } = require('./middleware/caching');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

// Import routes
const authRoutes = require('./routes/auth');
const challengeRoutes = require('./routes/challenges');
const contactRoutes = require('./routes/contact');
const newsletterRoutes = require('./routes/newsletter');
const registrationStatusRoutes = require('./routes/registrationStatus');
const blogRoutes = require('./routes/blog');
const tutorialRoutes = require('./routes/tutorials');
const teamRoutes = require('./routes/teams');
const noticeRoutes = require('./routes/notice');
const analyticsRoutes = require('./routes/analytics');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 5000;

// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

// Security logging (must be first)
app.use(securityLogger);

// Advanced security headers
app.use(advancedHelmet);

// Rate limiting
app.use('/api/auth/login', strictLoginLimiter);
app.use('/api/challenges/submit', challengeSubmitLimiter);
app.use('/api/', apiLimiter);

// CORS with development-friendly configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = process.env.CORS_ORIGIN.split(',').map(o => o.trim());
    
    // Allow localhost for development
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all for development
    }
  },
  credentials: process.env.CORS_CREDENTIALS === 'true',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token'],
  optionsSuccessStatus: 200,
  maxAge: 86400 // 24 hours
};
app.use(cors(corsOptions));

// Session configuration with secure settings (memory store for now)
app.use(session({
  secret: process.env.SESSION_SECRET,
  name: 'ctfquest.sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'strict'
  }
}));

// Performance middleware
app.use(compression({ 
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// Concurrency management
app.use(concurrencyMiddleware);

// Body parsing with security limits
app.use(express.json({ 
  limit: '1mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '1mb',
  parameterLimit: 20
}));

// MongoDB injection protection
app.use(mongoSanitize);

// Advanced input sanitization
app.use(advancedSanitization);

// CSRF protection for state-changing operations (disabled for development)
// app.use('/api/', (req, res, next) => {
//   if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
//     return csrfProtection(req, res, next);
//   }
//   next();
// });

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}



// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    // Sanitize filename
    const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, Date.now() + '-' + sanitizedFilename);
  }
});

const fileFilter = (req, file, cb) => {
  try {
    secureFileUpload.validateFile(file);
    cb(null, true);
  } catch (error) {
    cb(error, false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.FILE_UPLOAD_MAX_SIZE) || secureFileUpload.maxFileSize,
    files: 1,
    fields: 10,
    fieldNameSize: 50,
    fieldSize: 1024
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  const healthCheck = {
    uptime: process.uptime(),
    message: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    memory: process.memoryUsage(),
    connections: {
      active: mongoose.connection.db?.serverConfig?.connections?.length || 0,
      poolSize: mongoose.connection.db?.serverConfig?.poolSize || 0
    }
  };

  try {
    res.status(200).json(healthCheck);
  } catch (error) {
    healthCheck.message = error.message;
    res.status(503).json(healthCheck);
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/challenges', challengeRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/newsletter', newsletterRoutes);
app.use('/api/registration-status', registrationStatusRoutes);
app.use('/api/blog', blogRoutes);
app.use('/api/tutorials', tutorialRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/notices', noticeRoutes);
app.use('/api/analytics', analyticsRoutes);

// Serve static files from uploads directory with proper security headers
app.use('/uploads', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
}, express.static(path.join(__dirname, 'uploads')));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);

  // Log detailed error in development
  if (process.env.NODE_ENV === 'development') {
    console.error('Error stack:', err.stack);
  }

  // Handle specific error types
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: 'File upload error',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Invalid file upload'
    });
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }

  // Handle mongoose validation errors
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(val => val.message);
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: process.env.NODE_ENV === 'development' ? messages : ['Invalid input data']
    });
  }

  // Handle mongoose duplicate key errors
  if (err.code === 11000) {
    return res.status(400).json({
      success: false,
      message: 'Duplicate field value entered'
    });
  }

  // Default error
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  // Close server & exit process
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Close server & exit process
  process.exit(1);
});

// Start server
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/ctf-platform';

// Enhanced MongoDB connection options for 500+ concurrent users support
const mongoOptions = {
  // Connection pool settings for high concurrency (500+ users)
  maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE) || 100, // Maximum number of connections
  minPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE) || 20,  // Minimum number of connections
  maxIdleTimeMS: parseInt(process.env.MONGO_MAX_IDLE_TIME) || 60000, // Close connections after 60 seconds of inactivity
  serverSelectionTimeoutMS: parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT) || 10000, // How long to try selecting a server
  socketTimeoutMS: parseInt(process.env.MONGO_SOCKET_TIMEOUT) || 60000, // How long a send or receive on a socket can take before timing out
  heartbeatFrequencyMS: parseInt(process.env.MONGO_HEARTBEAT_FREQUENCY) || 5000, // How often to check the status of the connection
  
  // Connection wait queue settings
  waitQueueTimeoutMS: parseInt(process.env.MONGO_WAIT_QUEUE_TIMEOUT) || 10000,

  // Retry settings
  retryWrites: true,
  retryReads: true,

  // Read/Write concerns for consistency
  readPreference: process.env.MONGO_READ_PREFERENCE || 'primary',
  readConcern: { level: process.env.MONGO_READ_CONCERN || 'majority' },
  writeConcern: { w: process.env.MONGO_WRITE_CONCERN || 'majority', j: true, wtimeout: 10000 }
};

// Set mongoose-specific options separately (not passed to MongoDB driver)
mongoose.set('bufferCommands', false); // Disable mongoose buffering
mongoose.set('strictQuery', true); // Enable strict mode for queries

mongoose.connect(MONGODB_URI, mongoOptions)
.then(() => {
  console.log('MongoDB connected successfully with enhanced connection pooling');
  console.log(`Connection pool: min=${mongoOptions.minPoolSize}, max=${mongoOptions.maxPoolSize}`);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    console.log(`Server accessible at http://localhost:${PORT}`);
    console.log(`MongoDB connection pool configured for ${mongoOptions.maxPoolSize} concurrent connections`);
  });
})
.catch(err => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});
