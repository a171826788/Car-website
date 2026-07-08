require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// --------------------------------------------------
// ENV CHECKS
// --------------------------------------------------
if (!process.env.JWT_SECRET) {
  console.error('\n❌ FATAL ERROR:');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('JWT_SECRET is not defined in your .env file');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('\n📝 Add this to your .env file:\n');
  console.error('JWT_SECRET=voyago_secret_key_12345\n');
  process.exit(1);
}

console.log('✓ JWT_SECRET is configured');

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
const assetsPath = path.join(rootPath, 'assets'); // optional root-level assets folder

// Ensure upload directories exist
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

// --------------------------------------------------
// MIDDLEWARE
// --------------------------------------------------
app.use(
  cors({
    origin: [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:5500',
      'http://127.0.0.1:5500',
      'http://localhost:5000',
      'http://127.0.0.1:5000',
    ],
    credentials: true,
  })
);

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

// 1) uploads
app.use('/uploads', express.static(uploadsPath));

// Optional fallback if uploads also exist one level above project root
const altUploadsPath = path.join(rootPath, '..', 'uploads');
if (fs.existsSync(altUploadsPath)) {
  app.use('/uploads', express.static(altUploadsPath));
}

// 2) public folder (HTML/CSS/JS/assets if assets live inside public/assets)
app.use(express.static(publicPath, { index: false }));

// 3) optional root-level assets folder
if (fs.existsSync(assetsPath)) {
  app.use('/assets', express.static(assetsPath));
}

// --------------------------------------------------
// PAGE ROUTES
// --------------------------------------------------

// Home
app.get('/', (req, res, next) => {
  const file = path.join(publicPath, 'index.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  next(new Error(`index.html not found at ${file}`));
});

// Optional dashboard.html
app.get('/dashboard.html', (req, res) => {
  const file = path.join(publicPath, 'dashboard.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  return res.redirect('/');
});

// Admin login
app.get('/admin', (req, res) => {
  const file = path.join(publicPath, 'admin-login.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  return res.status(404).send('admin-login.html not found in public folder');
});

// Admin dashboard
app.get('/admin/dashboard', (req, res) => {
  const file = path.join(publicPath, 'admin-dashboard.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  return res.status(404).send('admin-dashboard.html not found in public folder');
});

// Health
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

// Ignore Chrome devtools file
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

async function start() {
  try {
    await connectDB();
    console.log('✓ Database connected');

    await seedDefaultAdmin();
    console.log('✓ Default admin checked/seeded');

    app.listen(PORT, () => {
      console.log('\n========================================');
      console.log('  Voyago Server Running');
      console.log(`  Port: ${PORT}`);
      console.log(`  Home: http://localhost:${PORT}`);
      console.log(`  Admin Login: http://localhost:${PORT}/admin`);
      console.log(`  Route Health: http://localhost:${PORT}/api/route/health`);
      console.log('========================================\n');
    });
  } catch (error) {
    console.error('Server startup failed:', error);
    process.exit(1);
  }
}

start();