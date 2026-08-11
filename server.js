const http = require('http');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT || 3000);
const app = next({ dev });
const handle = app.getRequestHandler();

async function runObservationMonitor() {
  const secret = process.env.OBSERVATION_MONITOR_SECRET;
  if (!secret) return;
  try {
    await fetch(`http://127.0.0.1:${port}/api/observations`, {
      headers: { 'x-observation-secret': secret },
    });
  } catch {
    // The next scheduled check will try again.
  }
}

async function runAlertMonitor() {
  const secret = process.env.ALERT_MONITOR_SECRET;
  if (!secret) return;
  try {
    await fetch(`http://127.0.0.1:${port}/api/alerts/monitor`, {
      headers: { 'x-alert-monitor-secret': secret },
    });
  } catch {
    // The next scheduled check will retry failed provider connections.
  }
}

app.prepare().then(() => {
  const server = http.createServer(handle);
  const io = new Server(server);

  io.on('connection', (socket) => {
    const checkAlerts = async () => {
      try {
        const host = socket.handshake.headers.host || `localhost:${port}`;
        const protocol = socket.handshake.headers['x-forwarded-proto'] || 'http';
        const response = await fetch(`${protocol}://${host}/api/alerts`, {
          headers: { cookie: socket.handshake.headers.cookie || '' },
        });
        if (response.ok) socket.emit('alerts:update', await response.json());
      } catch {
        // The next scheduled check will try again.
      }
    };

    socket.on('alerts:watch', checkAlerts);
    checkAlerts();
    const timer = setInterval(checkAlerts, 30_000);
    socket.on('disconnect', () => clearInterval(timer));
  });

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
    runObservationMonitor();
    runAlertMonitor();
  });
  setInterval(runObservationMonitor, 15 * 60 * 1000);
  setInterval(runAlertMonitor, 60 * 1000);
});
