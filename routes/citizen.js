import express from "express";
import { ensureAuthenticated, ensureRole } from "../middleware/auth.js";
import db from "../db.js";
import { upload } from "../middleware/uploads.js";

const router = express.Router();

// ----------------- Citizen Dashboard -----------------
router.get("/", ensureAuthenticated, ensureRole("CITIZEN"), async (req, res) => {
  try {
    const userId = req.session.user.id;
    const search = req.query.search || "";
    const status = req.query.status || "All";

    let query = `
      SELECT r.id, s.name AS service_name, d.name AS dept_name,
             r.current_status,
             p.status AS payment_status,
             p.amount_cents AS fee_cents,
             r.submitted_at
      FROM requests r
      JOIN services s ON s.id = r.service_id
      JOIN departments d ON s.department_id = d.id
      LEFT JOIN payments p ON p.request_id = r.id
      WHERE r.citizen_id = ?
    `;
    const params = [userId];

    if (search) {
      query += ` AND (LOWER(s.name) LIKE LOWER(?) OR LOWER(d.name) LIKE LOWER(?))`;
      params.push(`%${search}%`, `%${search}%`);
    }

    if (status && status !== "All") {
      if (status === "PROCESSING") {
        query += ` AND r.current_status IN ('UNDER_REVIEW')`;
      } else if (status === "COMPLETED") {
        query += ` AND r.current_status IN ('APPROVED', 'REJECTED')`;
      } else {
        query += ` AND (r.current_status = ? OR p.status = ?)`;
        params.push(status, status);
      }
    }

    query += ` ORDER BY r.submitted_at DESC`;
    const [requestsRes] = await db.execute(query, params);

    // Notifications
    const [notificationsRes] = await db.execute(
      `SELECT id, message, created_at, is_read
       FROM notifications
       WHERE user_id = ? AND is_read = false
       ORDER BY created_at DESC
       LIMIT 10`,
      [userId]
    );

    res.render("citizen/dashboard", {
      user: req.session.user,
      officer: req.session.user,
      requests: requestsRes,
      notifications: notificationsRes,
      search,
      status
    });
  } catch (err) {
    console.error("Citizen dashboard error:", err);
    res.status(500).send("Server error");
  }
});

// ----------------- Apply for Service -----------------
router.get("/apply", ensureAuthenticated, ensureRole("CITIZEN"), async (req, res) => {
  try {
    const [services] = await db.execute(`
      SELECT s.*, d.name AS department_name 
      FROM services s
      JOIN departments d ON s.department_id = d.id 
      WHERE s.is_active = true
    `);
    res.render("citizen/apply", { user: req.session.user, officer: req.session.user, services });
  } catch (err) {
    console.error("GET /citizen/apply error:", err);
    res.status(500).send("Server error");
  }
});

// ----------------- Submit Application -----------------
router.post("/apply", ensureAuthenticated, ensureRole("CITIZEN"), upload.array("documents", 6), async (req, res) => {
  try {
    const citizenId = req.session.user.id;
    const { service_id, details } = req.body;

    if (!service_id) return res.status(400).send("Service not selected");

    const [serviceRows] = await db.execute("SELECT * FROM services WHERE id = ?", [service_id]);
    if (!serviceRows.length) return res.status(400).send("Service not found");

    const [insertRes] = await db.execute(
      `INSERT INTO requests (citizen_id, service_id, current_status, remarks)
       VALUES (?, ?, 'SUBMITTED', ?)`,
      [citizenId, service_id, details || null]
    );

    const requestId = insertRes.insertId;

    const files = req.files || [];
    for (const file of files) {
      await db.execute(
        `INSERT INTO documents (request_id, file_name, file_path, mime_type)
         VALUES (?, ?, ?, ?)`,
        [requestId, file.originalname, file.path, file.mimetype]
      );
    }

    // Simulated payment
    const fee = Math.floor(Math.random() * 5000 + 2000);
    await db.execute(
      `INSERT INTO payments (request_id, amount_cents, status)
       VALUES (?, ?, 'SUCCESS')`,
      [requestId, fee]
    );

    res.redirect(`/citizen/request/${requestId}`);
  } catch (err) {
    console.error("POST /citizen/apply error:", err);
    res.status(500).send("Server error");
  }
});

// ----------------- Request Details -----------------
router.get("/request/:id", ensureAuthenticated, ensureRole("CITIZEN"), async (req, res) => {
  try {
    const rid = req.params.id;
    const uid = req.session.user.id;

    const [reqRes] = await db.execute(`
          SELECT r.*, 
            s.name AS service_name, 
            d.name AS dept_name,
            p.amount_cents AS fee_cents,
            p.status AS payment_status
      FROM requests r
      JOIN services s ON r.service_id = s.id
      JOIN departments d ON s.department_id = d.id
      LEFT JOIN payments p ON p.request_id = r.id
      WHERE r.id = ? AND r.citizen_id = ?
    `, [rid, uid]);

    if (!reqRes[0]) return res.status(404).send("Not found");

    const request = reqRes[0];
    const [docs] = await db.execute("SELECT * FROM documents WHERE request_id = ?", [rid]);
    const [payments] = await db.execute("SELECT * FROM payments WHERE request_id = ?", [rid]);

    res.render("citizen/request_detail", { user: req.session.user, request, documents: docs, payments });
  } catch (err) {
    console.error("GET /request/:id error:", err);
    res.status(500).send("Server error");
  }
});

// ----------------- Notifications -----------------
router.post("/notifications/read", ensureAuthenticated, ensureRole("CITIZEN"), async (req, res) => {
  try {
    await db.execute(
      `UPDATE notifications 
       SET is_read = true 
       WHERE user_id = ? AND is_read = false`,
      [req.session.user.id]
    );
    res.redirect("/citizen");
  } catch (err) {
    console.error("POST /notifications/read error:", err);
    res.status(500).send("Server error");
  }
});

export default router;
