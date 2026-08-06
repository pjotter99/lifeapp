import Fastify from 'fastify';
import { runMigrations } from './migrate.ts';
import { registerRoutes } from './routes.ts';

// Migrationen laufen beim Start durch — kein separater Deploy-Schritt fuer
// eine Einzelnutzer-App, die lokal laeuft.
runMigrations((msg) => console.log(msg));

const app = Fastify({ logger: true });

app.get('/api/health', async () => ({ status: 'ok' }));
registerRoutes(app);

const PORT = 3001;
app
  .listen({ port: PORT, host: '127.0.0.1' })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
