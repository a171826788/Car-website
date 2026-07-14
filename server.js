require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// --------------------------------------------------
// ENV CHECKS
// --------------------------------------------------
function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`${name} is not defined in your .env file`);
  }
  return String(value).trim();
}

try {
  requiredEnv('JWT_SECRET');
  console.log('✓ JWT_SECRET is configured');
} catch (err) {
  console.error('\n❌ FATAL ERROR:');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error(err.message);
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(1);
}

if (!process.env.ORS_API_KEY) {
  console.warn('\n⚠️ WARNING: ORS_API_KEY is not configured in .env');
  console.warn('Route distance calculations may fail until this is set.\n');
}

// --------------------------------------------------
// APP + DB + ROUTES
// --------------------------------------------------
const app = express();

const connectDB = require('./config/db');
const { seedDefaultAdmin } = require('./controllers/adminAuthController');

// API routes
const adminAuthRoutes = require('./routes/adminAuth');
const vehicleRoutes = require('./routes/vehicles');
const packageRoutes = require('./routes/packages');
const bookingRoutes = require('./routes/bookings');
const contactRoutes = require('./routes/contacts');
const publicApiRoutes = require('./routes/publicApi');
const paymentRoutes = require('./routes/payments');
const settingsRoutes = require('./routes/settings');
const userRoutes = require('./routes/userRoutes');
const routeRoutes = require('./routes/routeRoutes');

// --------------------------------------------------
// PATHS
// --------------------------------------------------
const rootPath = __dirname;
const publicPath = path.join(rootPath, 'public');
const uploadsPath = path.join(rootPath, 'uploads');
const assetsPath = path.join(rootPath, 'assets');

// Ensure upload directories exist (skip on Vercel read-only filesystem)
if (!process.env.VERCEL) {
  [
    uploadsPath,
    path.join(uploadsPath, 'vehicles'),
    path.join(uploadsPath, 'packages'),
    path.join(uploadsPath, 'temp'),
  ].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

// --------------------------------------------------
// CORS CONFIG
// --------------------------------------------------
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'https://aman-tours-and-travels.onrender.com',
  process.env.FRONTEND_URL,
  process.env.RENDER_EXTERNAL_URL,
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // allow Postman / curl / server-to-server requests
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.error(`CORS blocked for origin: ${origin}`);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// optional explicit preflight support
app.options('*', cors());

// --------------------------------------------------
// BODY PARSERS
// --------------------------------------------------
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// --------------------------------------------------
// STATIC FILES
// --------------------------------------------------
app.use('/uploads', express.static(uploadsPath));

const altUploadsPath = path.join(rootPath, '..', 'uploads');
if (fs.existsSync(altUploadsPath)) {
  app.use('/uploads', express.static(altUploadsPath));
}

app.use(express.static(publicPath, { index: false }));

if (fs.existsSync(assetsPath)) {
  app.use('/assets', express.static(assetsPath));
}

// --------------------------------------------------
// PAGE ROUTES
// --------------------------------------------------
app.get('/', (req, res, next) => {
  const file = path.join(publicPath, 'index.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  next(new Error(`index.html not found at ${file}`));
});

app.get('/dashboard.html', (req, res) => {
  const file = path.join(publicPath, 'dashboard.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  return res.redirect('/');
});

app.get('/admin', (req, res) => {
  const file = path.join(publicPath, 'admin-login.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  return res.status(404).send('admin-login.html not found in public folder');
});

app.get('/admin/dashboard', (req, res) => {
  const file = path.join(publicPath, 'admin-dashboard.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  return res.status(404).send('admin-dashboard.html not found in public folder');
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Voyago API is running',
    timestamp: new Date().toISOString(),
  });
});

// --------------------------------------------------
// API ROUTES
// --------------------------------------------------
app.use('/api/admin', adminAuthRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/public', publicApiRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/human', userRoutes);
app.use('/api/route', routeRoutes);

app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  res.status(204).end();
});

// --------------------------------------------------
// 404 HANDLER
// --------------------------------------------------
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// --------------------------------------------------
// GLOBAL ERROR HANDLER
// --------------------------------------------------
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------
const PORT = process.env.PORT || 5000;

// Connect to DB and seed default admin (executes eagerly for serverless)
connectDB().then(async () => {
  console.log('✓ Database connected');
  try {
    await seedDefaultAdmin();
    console.log('✓ Default admin checked/seeded');
  } catch (err) {
    console.error('Admin seed error:', err);
  }
}).catch(err => console.error('Database connection failed:', err));

// Start the server only if NOT running on Vercel
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log('\n========================================');
    console.log('  Voyago Server Running');
    console.log(`  Port: ${PORT}`);
    console.log(`  Home: http://localhost:${PORT}`);
    console.log(`  Admin Login: http://localhost:${PORT}/admin`);
    console.log(`  Route Health: http://localhost:${PORT}/api/route/health`);
    console.log('========================================\n');
    console.log('Allowed CORS origins:', allowedOrigins);
  });
}

// Export the app for Vercel's serverless functions
module.exports = app;