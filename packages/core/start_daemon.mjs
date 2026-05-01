import { DaemonServer } from './dist/daemon/server.js';

const daemon = new DaemonServer({ host: 'localhost', port: 9658 });
console.log('Starting InTorch daemon...');
console.log('  Host: localhost');
console.log('  Port: 9658');
console.log('Press Ctrl+C to stop');

await daemon.start();

process.on('SIGINT', async () => {
  console.log('\nStopping daemon...');
  await daemon.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await daemon.stop();
  process.exit(0);
});
