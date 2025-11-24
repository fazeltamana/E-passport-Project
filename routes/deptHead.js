import express from "express";
import db from "../db.js";
import { ensureAuthenticated, ensureRole } from "../middleware/auth.js";

const router = express.Router();

/* ======================================================
   DEPT HEAD DASHBOARD
====================================================== */
router.get("/", ensureAuthenticated, ensureRole("DEPT_HEAD"), async (req, res) => {
  try {
    const deptId = req.session.user.department_id;
    const { name, request_id, status, service_id, date } = req.query;

    /* -----------------------------------------
       STATISTICS
    ------------------------------------------ */
    const [[totalRequestsRow]] = await db.execute(`
      SELECT COUNT(*) AS total 
      FROM requests r
      JOIN services s ON r.service_id = s.id
      WHERE s.department_id = ?
    `, [deptId]);

    const [[approvedRow]] = await db.execute(`
      SELECT COUNT(*) AS count 
      FROM requests r
      JOIN services s ON r.service_id = s.id
      WHERE s.department_id = ? AND r.current_status = 'APPROVED'
    `, [deptId]);

    const [[pendingRow]] = await db.execute(`
      SELECT COUNT(*) AS count 
      FROM requests r
      JOIN services s ON r.service_id = s.id
      WHERE s.department_id = ? AND r.current_status = 'PENDING'
    `, [deptId]);

    const [[rejectedRow]] = await db.execute(`
      SELECT COUNT(*) AS count 
      FROM requests r
      JOIN services s ON r.service_id = s.id
      WHERE s.department_id = ? AND r.current_status = 'REJECTED'
    `, [deptId]);

    /* -----------------------------------------
       TOTAL FEE FROM PAYMENTS
    ------------------------------------------ */
    const [[feeRow]] = await db.execute(`
      SELECT IFNULL(SUM(p.amount_cents), 0) AS total_fee
      FROM payments p
      JOIN requests r ON p.request_id = r.id
      JOIN services s ON r.service_id = s.id
      WHERE p.status = 'SUCCESS' AND s.department_id = ?
    `, [deptId]);

    /* -----------------------------------------
       FILTERED REQUEST LIST — UPDATED WITH FEE + REVIEWER
    ------------------------------------------ */
    let query = `
      SELECT 
        r.id,
        r.current_status,
        r.submitted_at,
        r.reviewed_by,
        u.full_name AS citizen_name,
        s.name AS service_name,
        rb.full_name AS reviewer_name,
        p.amount_cents AS fee_cents
      FROM requests r
      JOIN users u ON r.citizen_id = u.id
      JOIN services s ON r.service_id = s.id
      LEFT JOIN users rb ON r.reviewed_by = rb.id
      LEFT JOIN payments p ON p.request_id = r.id AND p.status = 'SUCCESS'
      WHERE s.department_id = ?
    `;

    const params = [deptId];

    if (name) {
      query += " AND LOWER(u.full_name) LIKE LOWER(?)";
      params.push(`%${name}%`);
    }
    if (request_id) {
      query += " AND CAST(r.id AS CHAR) LIKE ?";
      params.push(`%${request_id}%`);
    }
    if (status) {
      query += " AND r.current_status = ?";
      params.push(status);
    }
    if (service_id) {
      query += " AND s.id = ?";
      params.push(service_id);
    }
    if (date) {
      query += " AND DATE(r.submitted_at) = ?";
      params.push(date);
    }

    query += " ORDER BY r.submitted_at DESC";

    const [requests] = await db.execute(query, params);

    const formattedRequests = requests.map(r => ({
      ...r,
      status: r.current_status.toUpperCase()
    }));

    /* -----------------------------------------
       SERVICES DROPDOWN
    ------------------------------------------ */
    const [services] = await db.execute(
      "SELECT id, name FROM services WHERE department_id = ?",
      [deptId]
    );

    res.render("depthead/dashboard", {
      user: req.session.user,
      officer: req.session.user,
      totalRequests: totalRequestsRow.total,
      approved: approvedRow.count,
      pending: pendingRow.count,
      rejected: rejectedRow.count,
      feeCollected: feeRow.total_fee,

      requests: formattedRequests,
      services,

      filters: { name, request_id, status, service_id, date }
    });

  } catch (err) {
    console.error("DEPT HEAD Dashboard error:", err);
    res.sendStatus(500);
  }
});

/* ======================================================
   DOWNLOAD CSV REPORT
====================================================== */
router.get("/download-report", ensureAuthenticated, ensureRole("DEPT_HEAD"), async (req, res) => {
  try {
    const deptId = req.session.user.department_id;

    const [rows] = await db.execute(`
      SELECT r.id AS RequestID, u.full_name AS Citizen,
             s.name AS Service, r.current_status AS Status,
             r.submitted_at AS SubmittedAt
      FROM requests r
      JOIN users u ON r.citizen_id = u.id
      JOIN services s ON r.service_id = s.id
      WHERE s.department_id = ?
      ORDER BY r.submitted_at DESC
    `, [deptId]);

    const header = "RequestID,Citizen,Service,Status,SubmittedAt\n";

    const csv = header + rows
      .map(r => `${r.RequestID},"${r.Citizen}","${r.Service}",${r.Status},${r.SubmittedAt}`)
      .join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=dept_report.csv");
    res.send(csv);

  } catch (err) {
    console.error("Dept report download error:", err);
    res.status(500).send("Server error");
  }
});

export default router;
