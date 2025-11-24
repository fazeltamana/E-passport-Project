import express from "express";
import path from "path";
import fs from "fs";
import { ensureAuthenticated, ensureRole } from "../middleware/auth.js";
import db from "../db.js";
import { upload } from "../middleware/uploads.js";

const router = express.Router();

// Officer Dashboard - list requests for officer's department
router.get("/", ensureAuthenticated, ensureRole("OFFICER"), async (req, res) => {
  try {
    const deptId = req.session.user.department_id;
    const { name, request_id, status, service_id, date } = req.query;

    let query = `
      SELECT r.id, r.current_status, r.submitted_at, 
             u.full_name AS citizen_name, s.name AS service_name, d.name AS department_name
      FROM requests r
      JOIN users u ON r.citizen_id = u.id
      JOIN services s ON r.service_id = s.id
      JOIN departments d ON s.department_id = d.id
      WHERE s.department_id = ?
    `;
    const params = [deptId];

    if (name) {
      params.push(`%${name}%`);
      query += ` AND LOWER(u.full_name) LIKE LOWER(?)`;
    }
    if (request_id) {
      params.push(`%${request_id}%`);
      query += ` AND CAST(r.id AS CHAR) LIKE ?`;
    }
    if (status) {
      params.push(status);
      query += ` AND r.current_status = ?`;
    }
    if (service_id) {
      params.push(service_id);
      query += ` AND s.id = ?`;
    }
    if (date) {
      params.push(date);
      query += ` AND DATE(r.submitted_at) = ?`;
    }

    query += ` ORDER BY r.submitted_at DESC`;

    const [requests] = await db.execute(query, params);

    // Fetch services for dropdown
    const [services] = await db.execute(
      `SELECT id, name FROM services WHERE department_id = ?`,
      [deptId]
    );

    const formattedRequests = requests.map(r => ({
      ...r,
      status: r.current_status.charAt(0).toUpperCase() + r.current_status.slice(1).toLowerCase()
    }));

    res.render("officer/dashboard", {
      user: req.session.user,
      officer: req.session.user,
      requests: formattedRequests,
      services,
      filters: { name, request_id, status, service_id, date }
    });
  } catch (err) {
    console.error("Officer dashboard error:", err);
    res.sendStatus(500);
  }
});

// Review a single request
router.get("/request/:id", ensureAuthenticated, ensureRole("OFFICER"), async (req, res) => {
  const requestId = req.params.id;
  try {
    const [rows] = await db.execute(`
      SELECT r.id, r.current_status, r.submitted_at,
             u.full_name AS citizen_name, s.name AS service_name,
             d.name AS dept_name
      FROM requests r
      JOIN users u ON r.citizen_id = u.id
      JOIN services s ON r.service_id = s.id
      JOIN departments d ON s.department_id = d.id
      WHERE r.id = ?
    `, [requestId]);

    if (!rows[0]) return res.sendStatus(404);
    const request = rows[0];

    // Fetch documents
    const [documents] = await db.execute(`
      SELECT file_name, file_name AS filename, file_path
      FROM documents
      WHERE request_id = ?
    `, [requestId]);

    request.status = request.current_status.charAt(0).toUpperCase() + request.current_status.slice(1).toLowerCase();

    res.render("officer/review_request", { user: req.session.user, officer: req.session.user, request, documents });
  } catch (err) {
    console.error("Officer review error:", err);
    res.sendStatus(500);
  }
});

// Approve or Reject a request
router.post("/request/:id/action", ensureAuthenticated, ensureRole("OFFICER"), async (req, res) => {
  const requestId = req.params.id;
  const action = req.body.action;

  const statusMap = {
    approve: "APPROVED",
    reject: "REJECTED"
  };

  const status = statusMap[action];
  if (!status) return res.status(400).send("Invalid action");

  try {
    // Update request status
    await db.execute(
      `UPDATE requests 
       SET current_status = ?, reviewed_by = ?, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [status, req.session.user.id, requestId]
    );

    // Fetch citizen ID
    const [rows] = await db.execute(`SELECT citizen_id FROM requests WHERE id = ?`, [requestId]);
    const citizenId = rows[0].citizen_id;

    // Insert notification for citizen
    await db.execute(
      `INSERT INTO notifications (user_id, message, created_at, is_read)
       VALUES (?, ?, NOW(), false)`,
      [citizenId, `Your request #${requestId} has been ${status.toLowerCase()}.`]
    );

    res.redirect("/officer");
  } catch (err) {
    console.error("Error updating request status:", err);
    res.status(500).send("Server error");
  }
});

// Download document
router.get("/request/:id/document/:filename", ensureAuthenticated, ensureRole("OFFICER"), async (req, res) => {
  try {
    const { id, filename } = req.params;

    // Fetch document row from DB
    const [docs] = await db.execute(
      `SELECT * FROM documents WHERE request_id = ? AND file_name = ?`,
      [id, filename]
    );

    if (!docs[0]) return res.status(404).send("File not found");

    const filePath = path.resolve(docs[0].file_path);

    if (!fs.existsSync(filePath)) return res.status(404).send("File not found on server");

    res.download(filePath, docs[0].file_name, (err) => {
      if (err) {
        console.error("Download error:", err);
        res.status(500).send("Could not download file");
      }
    });
  } catch (err) {
    console.error("Download document error:", err);
    res.status(500).send("Server error");
  }
});

export default router;
