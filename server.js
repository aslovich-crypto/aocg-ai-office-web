const express = require("express")
const cors = require("cors")
const { Pool } = require("pg")
const path = require("path")

const app = express()
const PORT = process.env.PORT || 4173

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, "dist")))

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS receipts (
      id SERIAL PRIMARY KEY,
      date DATE,
      org VARCHAR(255),
      category VARCHAR(100),
      payment VARCHAR(100),
      amount NUMERIC(12,2),
      employee VARCHAR(255)
    );
    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255),
      status VARCHAR(50) DEFAULT 'Личные',
      total NUMERIC(12,2),
      created DATE DEFAULT CURRENT_DATE
    );
    CREATE TABLE IF NOT EXISTS report_items (
      report_id INTEGER REFERENCES reports(id) ON DELETE CASCADE,
      receipt_id INTEGER REFERENCES receipts(id)
    );
  `)
}

app.get("/api/receipts", async (req, res) => {
  const r = await pool.query("SELECT * FROM receipts ORDER BY date DESC")
  res.json(r.rows)
})

app.post("/api/receipts", async (req, res) => {
  const { date, org, category, payment, amount, employee } = req.body
  const r = await pool.query("INSERT INTO receipts (date,org,category,payment,amount,employee) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [date,org,category,payment,amount,employee])
  res.json(r.rows[0])
})

app.delete("/api/receipts/:id", async (req, res) => {
  await pool.query("DELETE FROM receipts WHERE id=$1", [req.params.id])
  res.json({ ok: true })
})

app.get("/api/reports", async (req, res) => {
  const reps = await pool.query("SELECT * FROM reports ORDER BY created DESC")
  const items = await pool.query("SELECT * FROM report_items")
  res.json(reps.rows.map(r => ({ ...r, receiptIds: items.rows.filter(i => i.report_id === r.id).map(i => i.receipt_id) })))
})

app.post("/api/reports", async (req, res) => {
  const { title, total, receiptIds } = req.body
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const r = await client.query("INSERT INTO reports (title,total) VALUES ($1,$2) RETURNING *", [title, total])
    for (const rid of receiptIds) await client.query("INSERT INTO report_items VALUES ($1,$2)", [r.rows[0].id, rid])
    await client.query("COMMIT")
    res.json({ ...r.rows[0], receiptIds })
  } catch(e) { await client.query("ROLLBACK"); res.status(500).json({ error: e.message }) }
  finally { client.release() }
})

app.patch("/api/reports/:id", async (req, res) => {
  const r = await pool.query("UPDATE reports SET status=$1 WHERE id=$2 RETURNING *", [req.body.status, req.params.id])
  res.json(r.rows[0])
})

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")))

initDB().then(() => app.listen(PORT, () => console.log("Server on port " + PORT)))
