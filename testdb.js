import pool from "./db.js"; // or require("./db") if using CommonJS

async function testDB() {
  try {
    const res = await pool.query("SELECT NOW()");
    console.log("✅ DB connected:", res.rows[0]);
  } catch (err) {
    console.error("❌ DB connection error:", err);
  } finally {
    pool.end();
  }
}

testDB();
