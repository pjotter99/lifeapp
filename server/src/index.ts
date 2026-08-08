import Fastify from 'fastify';
import { runMigrations } from './migrate.ts';
import { registerRoutes } from './routes.ts';
import { scheduleRecurringJob } from './recurringJob.ts';

// Migrationen laufen beim Start durch — kein separater Deploy-Schritt fuer
// eine Einzelnutzer-App, die lokal laeuft.
runMigrations((msg) => console.log(msg));

// Faellige Buchungen aus recurring: einmal jetzt, danach alle 24h. Holt
// uebersprungene Perioden nach (Server war z. B. eine Woche aus).
scheduleRecurringJob();

const app = Fastify({ logger: true });

app.get('/api/health', async () => ({ status: 'ok' }));
registerRoutes(app);

const PORT = 3001;
app
  // 0.0.0.0 statt 127.0.0.1: im lokalen Netz erreichbar, damit die App vom
  // Handy aus benutzbar ist. Kein Auth-Layer (CLAUDE.md, "ein Mensch, ein
  // Geraet") — das API ist damit fuer jeden im selben Netz offen.
  .listen({ port: PORT, host: '0.0.0.0' })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
