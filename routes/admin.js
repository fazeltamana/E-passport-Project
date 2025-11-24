import express from "express";
import bcrypt from "bcrypt";
import { Parser } from "json2csv"; 
import db from "../db.js";
import { ensureAuthenticated, ensureRole } from "../middleware/auth.js";

const router = express.Router();

// --- Admin Dashboard ---
router.get("/", ensureAuthenticated, ensureRole("ADMIN"), async (req, res) => {
  try {
    const { request_id, status, service_id, date } = req.query;

    // --- Department stats ---
    const [deptStats] = await db.execute(`
      SELECT d.id, d.name, COUNT(r.id) AS total_requests
      FROM departments d
      LEFT JOIN services s ON s.department_id = d.id
      LEFT JOIN requests r ON r.service_id = s.id
      GROUP BY d.id, d.name
      ORDER BY total_requests DESC
    `);

    // --- Status stats ---
    const [statusStats] = await db.execute(`
      SELECT current_status, COUNT(*) as count
      FROM requests
      GROUP BY current_status
    `);

    // --- Total collected ---
    const [totalCollectedResult] = await db.execute(`
      SELECT IFNULL(SUM(amount_cents),0) AS total_collected
      FROM payments
      WHERE status = 'SUCCESS'
    `);

    // --- Requests (filtered) ---
    let requests = [];
    if (request_id || status || service_id || date) {
      let query = `
        SELECT r.id, r.current_status, r.submitted_at,
               u.full_name AS citizen_name, s.name AS service_name
        FROM requests r
        JOIN users u ON r.citizen_id = u.id
        JOIN services s ON r.service_id = s.id
        WHERE 1=1
      `;
      const params = [];

      if (request_id) {
        query += ` AND LOWER(CAST(r.id AS CHAR)) LIKE LOWER(?)`;
        params.push(`%${request_id}%`);
      }

      if (status) {
        query += ` AND r.current_status = ?`;
        params.push(status);
      }

      if (service_id) {
        query += ` AND s.id = ?`;
        params.push(service_id);
      }

      if (date) {
        query += ` AND DATE(r.submitted_at) = ?`;
        params.push(date);
      }

      query += ` ORDER BY r.submitted_at DESC`;
      const [resRequests] = await db.execute(query, params);
      requests = resRequests;
    }

    const [services] = await db.execute(`SELECT * FROM services ORDER BY name`);

    res.render("admin/dashboard", {
      user: req.session.user,
      officer: req.session.user,
      deptStats: deptStats || [],
      statusStats: statusStats || [],
      totalCollected: totalCollectedResult[0].total_collected || 0,
      requests: requests || [],
      services: services || [],
      request_id: request_id || "",
      status: status || "",
      selectedService: service_id || "",
      date: date || ""
    });
  } catch (err) {
    console.error("Admin dashboard error:", err);
    res.status(500).send("Server error");
  }
});

// --- Add Officer / Dept Head ---
router.get("/add-user", ensureAuthenticated, ensureRole("ADMIN"), async (req, res) => {
  try {
    const [depts] = await db.execute("SELECT id, name FROM departments ORDER BY name ASC");
    res.render("admin/add_user", { 
      user: req.session.user, 
      officer: req.session.user,
      depts, 
      success: null, 
      error: null 
    });
  } catch (err) {
    console.error("Add user page error:", err);
    res.status(500).send("Server error");
  }
});

router.post("/add-user", ensureAuthenticated, ensureRole("ADMIN"), async (req, res) => {
  const { full_name, email, password, department_id, role } = req.body;

  try {
    const hash = await bcrypt.hash(password, 10);

    // 1. Insert user
    const [result] = await db.execute(
      `INSERT INTO users (full_name, email, password_hash, is_active)
       VALUES (?, ?, ?, true)`,
      [full_name, email, hash]
    );

    const userId = result.insertId;

    // 2. Ensure role exists
    const [roleRes] = await db.execute("SELECT id FROM roles WHERE name = ?", [role]);
    let roleId;

    if (roleRes.length === 0) {
      const [ins] = await db.execute("INSERT INTO roles (name) VALUES (?)", [role]);
      roleId = ins.insertId;
    } else {
      roleId = roleRes[0].id;
    }

    // 3. Insert user-role relationship
    await db.execute(
      "INSERT INTO users_roles (user_id, role_id) VALUES (?, ?)",
      [userId, roleId]
    );

    // 4. Insert into OFFICERS table 
    let positionId = null;

    if (roleId === 2) positionId = 1; // Officer
    if (roleId === 3) positionId = 2; // Dept Head

    if (positionId !== null) {
      await db.execute(
        `INSERT INTO officers (user_id, department_id, position_id)
         VALUES (?, ?, ?)`,
        [userId, department_id, positionId]
      );
    }

    const [depts] = await db.execute("SELECT id, name FROM departments ORDER BY name ASC");

    res.render("admin/add_user", {
      user: req.session.user,
      officer: req.session.user,
      depts,
      success: `${role} added successfully including officer info!`,
      error: null
    });

  } catch (err) {
    console.error("Error adding user:", err);

    const [depts] = await db.execute("SELECT id, name FROM departments ORDER BY name ASC");

    res.render("admin/add_user", {
      user: req.session.user,
      officer: req.session.user,
      depts,
      success: null,
      error: "Could not add user"
    });
  }
});

// --- Download organization report ---
router.get("/download-report", ensureAuthenticated, ensureRole("ADMIN"), async (req, res) => {
  try {
    const [requests] = await db.execute(`
      SELECT r.id AS RequestID, u.full_name AS Citizen, s.name AS Service,
             d.name AS Department, r.current_status AS Status,
             r.submitted_at AS SubmittedAt
      FROM requests r
      JOIN users u ON r.citizen_id = u.id
      JOIN services s ON r.service_id = s.id
      JOIN departments d ON s.department_id = d.id
      ORDER BY r.submitted_at DESC
    `);

    const fields = ["RequestID", "Citizen", "Service", "Department", "Status", "SubmittedAt"];
    const json2csv = new Parser({ fields });
    const csv = json2csv.parse(requests);

    res.header("Content-Type", "text/csv");
    res.attachment(`organization_report_${Date.now()}.csv`);
    res.send(csv);

  } catch (err) {
    console.error("Download report error:", err);
    res.status(500).send("Server error");
  }
});

export default router;
