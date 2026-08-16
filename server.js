import express from 'express';
import pg from 'pg';
import { locations } from './src/locations.js';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static('public'));

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS locations (
      scenario_number INTEGER PRIMARY KEY CHECK (scenario_number BETWEEN 0 AND 100),
      coordinates TEXT NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS progress (
      campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      scenario_number INTEGER NOT NULL REFERENCES locations(scenario_number),
      status TEXT NOT NULL DEFAULT 'undiscovered' CHECK (status IN ('undiscovered', 'discovered', 'cleared')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (campaign_id, scenario_number)
    );
  `);

  for (const location of locations) {
    await pool.query(
      `INSERT INTO locations (scenario_number, coordinates, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (scenario_number) DO UPDATE
       SET coordinates = EXCLUDED.coordinates, name = EXCLUDED.name`,
      [location.number, location.coordinates, location.name]
    );
  }

  const campaignCount = await pool.query('SELECT count(*)::int AS count FROM campaigns');
  if (campaignCount.rows[0].count === 0) {
    await pool.query("INSERT INTO campaigns (name) VALUES ('Our Campaign')");
  }
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/campaigns', async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.name, c.created_at, c.updated_at,
             count(*) FILTER (WHERE p.status = 'discovered')::int AS discovered,
             count(*) FILTER (WHERE p.status = 'cleared')::int AS cleared
      FROM campaigns c
      LEFT JOIN progress p ON p.campaign_id = c.id
      GROUP BY c.id ORDER BY c.created_at
    `);
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.post('/api/campaigns', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 80) return res.status(400).json({ error: 'Enter a campaign name up to 80 characters.' });
    const result = await pool.query('INSERT INTO campaigns (name) VALUES ($1) RETURNING *', [name]);
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

app.get('/api/campaigns/:id/locations', async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT l.scenario_number AS number, l.coordinates, l.name,
             COALESCE(p.status, 'undiscovered') AS status,
             p.updated_at
      FROM locations l
      LEFT JOIN progress p ON p.scenario_number = l.scenario_number AND p.campaign_id = $1
      ORDER BY l.scenario_number
    `, [req.params.id]);
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.put('/api/campaigns/:id/locations/:number', async (req, res, next) => {
  try {
    const status = req.body?.status;
    const number = Number(req.params.number);
    if (!['undiscovered', 'discovered', 'cleared'].includes(status) || !Number.isInteger(number)) {
      return res.status(400).json({ error: 'Invalid status or scenario number.' });
    }
    const result = await pool.query(`
      INSERT INTO progress (campaign_id, scenario_number, status)
      VALUES ($1, $2, $3)
      ON CONFLICT (campaign_id, scenario_number)
      DO UPDATE SET status = EXCLUDED.status, updated_at = now()
      RETURNING *
    `, [req.params.id, number, status]);
    await pool.query('UPDATE campaigns SET updated_at = now() WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error.code === '23503') return res.status(404).json({ error: 'Campaign or location not found.' });
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

await migrate();
app.listen(port, '0.0.0.0', () => console.log(`Location tracker listening on ${port}`));

