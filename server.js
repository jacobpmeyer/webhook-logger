const express = require('express');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');
const { Pool } = require('pg');

// Create Express app
const app = express();
const port = process.env.PORT || 3000;

// Database setup
const isProduction = process.env.NODE_ENV === 'production' || process.env.DATABASE_URL;
let pool;

if (isProduction && process.env.DATABASE_URL) {
  // Use PostgreSQL in production (Heroku)
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  // Initialize database table
  async function initializeDatabase() {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS webhook_logs (
          id SERIAL PRIMARY KEY,
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          filename TEXT NOT NULL,
          headers JSONB NOT NULL,
          body JSONB NOT NULL,
          query JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      console.log('Database table initialized');
    } catch (err) {
      console.error('Error initializing database:', err);
    }
  }

  initializeDatabase();
}

// Create logs directory if it doesn't exist (for local development)
const logsDir = path.join(__dirname, 'logs');
if (!isProduction) {
  fs.ensureDirSync(logsDir);
}

// Middleware
app.use(morgan('combined')); // HTTP request logging
app.use(bodyParser.json({ limit: '10mb' })); // Parse JSON bodies
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' })); // Parse URL-encoded bodies

// Simple home page
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Webhook Logger</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          h1 { color: #333; }
          pre { background-color: #f5f5f5; padding: 10px; border-radius: 5px; overflow: auto; }
        </style>
      </head>
      <body>
        <h1>Webhook Logger</h1>
        <p>Send POST requests to <code>/webhook</code> to log payloads.</p>
        <p>View logs at <a href="/logs">/logs</a></p>
      </body>
    </html>
  `);
});

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const filename = `webhook-${timestamp}.json`;

  const logData = {
    timestamp: new Date().toISOString(),
    headers: req.headers,
    body: req.body,
    query: req.query
  };

  try {
    if (isProduction && pool) {
      // Save to PostgreSQL database
      await pool.query(
        'INSERT INTO webhook_logs (filename, headers, body, query) VALUES ($1, $2, $3, $4)',
        [filename, JSON.stringify(logData.headers), JSON.stringify(logData.body), JSON.stringify(logData.query)]
      );
      console.log(`Webhook received and saved to database as ${filename}`);
    } else {
      // Save to file (local development)
      fs.writeFileSync(
        path.join(logsDir, filename),
        JSON.stringify(logData, null, 2)
      );
      console.log(`Webhook received and saved to file as ${filename}`);
    }

    // Respond with success
    res.status(200).json({
      status: 'success',
      message: 'Webhook received and logged',
      timestamp: logData.timestamp,
      storage: isProduction && pool ? 'database' : 'file'
    });
  } catch (error) {
    console.error('Error saving webhook:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to save webhook',
      error: error.message
    });
  }
});

// Endpoint to view all logs
app.get('/logs', async (req, res) => {
  try {
    let logFiles = [];

    if (isProduction && pool) {
      // Get logs from PostgreSQL database
      const result = await pool.query(
        'SELECT filename, created_at FROM webhook_logs ORDER BY created_at DESC'
      );
      logFiles = result.rows.map(row => row.filename);
    } else {
      // Get logs from files (local development)
      const files = await fs.readdir(logsDir);
      logFiles = files.filter(file => file.endsWith('.json')).sort().reverse();
    }

    if (logFiles.length === 0) {
      return res.send(`
        <html>
          <head>
            <title>Webhook Logs</title>
            <style>
              body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
              h1 { color: #333; }
            </style>
          </head>
          <body>
            <h1>No logs yet</h1>
            <a href="/">Back to home</a>
            <p><small>Storage: ${isProduction && pool ? 'Database (PostgreSQL)' : 'Local Files'}</small></p>
          </body>
        </html>
      `);
    }

    const logHtml = logFiles.map(file => {
      return `<li><a href="/logs/${file}">${file}</a></li>`;
    }).join('');

    res.send(`
      <html>
        <head>
          <title>Webhook Logs</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            h1 { color: #333; }
            ul { list-style-type: none; padding: 0; }
            li { margin: 10px 0; }
            a { color: #0066cc; text-decoration: none; }
            a:hover { text-decoration: underline; }
            .storage-info { color: #666; font-size: 0.9em; margin-top: 20px; }
          </style>
        </head>
        <body>
          <h1>Webhook Logs</h1>
          <a href="/">Back to home</a>
          <ul>${logHtml}</ul>
          <div class="storage-info">Storage: ${isProduction && pool ? 'Database (PostgreSQL)' : 'Local Files'}</div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('Error reading logs:', err);
    res.status(500).send(`Error reading logs: ${err.message}`);
  }
});

// Endpoint to view specific log
app.get('/logs/:filename', async (req, res) => {
  try {
    let logData;

    if (isProduction && pool) {
      // Get log from PostgreSQL database
      const result = await pool.query(
        'SELECT headers, body, query, created_at FROM webhook_logs WHERE filename = $1',
        [req.params.filename]
      );

      if (result.rows.length === 0) {
        return res.status(404).send('Log not found');
      }

      const row = result.rows[0];
      logData = {
        headers: typeof row.headers === 'string' ? JSON.parse(row.headers) : row.headers,
        body: typeof row.body === 'string' ? JSON.parse(row.body) : row.body,
        query: typeof row.query === 'string' ? JSON.parse(row.query) : row.query,
        timestamp: row.created_at
      };
    } else {
      // Get log from file (local development)
      const filePath = path.join(logsDir, req.params.filename);

      if (!await fs.pathExists(filePath)) {
        return res.status(404).send('Log not found');
      }

      const logContent = await fs.readFile(filePath, 'utf8');
      logData = JSON.parse(logContent);
    }

    res.send(`
      <html>
        <head>
          <title>Webhook Log: ${req.params.filename}</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            h1 { color: #333; }
            pre { background-color: #f5f5f5; padding: 10px; border-radius: 5px; overflow: auto; }
            .storage-info { color: #666; font-size: 0.9em; margin-top: 20px; }
          </style>
        </head>
        <body>
          <h1>Webhook Log: ${req.params.filename}</h1>
          <a href="/logs">Back to logs</a>
          <h2>Headers</h2>
          <pre>${JSON.stringify(logData.headers, null, 2)}</pre>
          <h2>Body</h2>
          <pre>${JSON.stringify(logData.body, null, 2)}</pre>
          <h2>Query Parameters</h2>
          <pre>${JSON.stringify(logData.query, null, 2)}</pre>
          <div class="storage-info">Storage: ${isProduction && pool ? 'Database (PostgreSQL)' : 'Local Files'}</div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('Error reading log:', err);
    res.status(500).send(`Error reading log: ${err.message}`);
  }
});

// Start server
app.listen(port, () => {
  console.log(`Webhook logger running at http://localhost:${port}`);
  console.log(`Storage: ${isProduction && pool ? 'Database (PostgreSQL)' : 'Local Files'}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  if (pool) {
    await pool.end();
  }
  process.exit(0);
});
