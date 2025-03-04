const express = require('express');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');

// Create Express app
const app = express();
const port = process.env.PORT || 3000;

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
fs.ensureDirSync(logsDir);

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
app.post('/webhook', (req, res) => {
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const filename = `webhook-${timestamp}.json`;

  const logData = {
    timestamp: new Date().toISOString(),
    headers: req.headers,
    body: req.body,
    query: req.query
  };

  // Save to file
  fs.writeFileSync(
    path.join(logsDir, filename),
    JSON.stringify(logData, null, 2)
  );

  console.log(`Webhook received and saved as ${filename}`);

  // Respond with success
  res.status(200).json({
    status: 'success',
    message: 'Webhook received and logged',
    timestamp: logData.timestamp
  });
});

// Endpoint to view all logs
app.get('/logs', async (req, res) => {
  try {
    const files = await fs.readdir(logsDir);
    const logFiles = files.filter(file => file.endsWith('.json')).sort().reverse();

    if (logFiles.length === 0) {
      return res.send('<h1>No logs yet</h1><a href="/">Back to home</a>');
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
          </style>
        </head>
        <body>
          <h1>Webhook Logs</h1>
          <a href="/">Back to home</a>
          <ul>${logHtml}</ul>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`Error reading logs: ${err.message}`);
  }
});

// Endpoint to view specific log
app.get('/logs/:filename', async (req, res) => {
  try {
    const filePath = path.join(logsDir, req.params.filename);

    if (!await fs.pathExists(filePath)) {
      return res.status(404).send('Log not found');
    }

    const logContent = await fs.readFile(filePath, 'utf8');
    const logData = JSON.parse(logContent);

    res.send(`
      <html>
        <head>
          <title>Webhook Log: ${req.params.filename}</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            h1 { color: #333; }
            pre { background-color: #f5f5f5; padding: 10px; border-radius: 5px; overflow: auto; }
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
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`Error reading log: ${err.message}`);
  }
});

// Start server
app.listen(port, () => {
  console.log(`Webhook logger running at http://localhost:${port}`);
});
