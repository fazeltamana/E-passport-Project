import express from "express";
import db from "../db.js";

const router = express.Router();

// Middleware
function ensureAuthenticated(req, res, next) {
  if (!req.session.user) return res.redirect("/auth/login");
  next();
}

// GET /profile
router.get("/", ensureAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const [userRows] = await db.execute(`
      SELECT 
        u.*, 
        o.department_id, 
        o.nick_name, 
        ur.role_id, 
        r.name AS role_name, 
        d.name AS department_name
      FROM users u
      LEFT JOIN officers o ON u.id = o.user_id
      LEFT JOIN departments d ON o.department_id = d.id
      LEFT JOIN users_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE u.id = ?
    `, [userId]);


    if (!userRows.length) throw new Error("User not found");

    const user = userRows[0];
    const roles = userRows.map(r => r.role_name).filter(Boolean);

    // FETCH OFFICER ROW IF USER BELONGS TO A DEPARTMENT
    let officer = null;
    if (user.department_id) {
      const [officerRows] = await db.execute(
        "SELECT * FROM officers WHERE user_id = ?",
        [userId]
      );
      officer = officerRows[0] || null;
    }

    res.render("profile", {
      user: { ...user, roles },
      officer,   
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.render("profile", {
      user: req.session.user,
      officer: req.session.user, 
      roles: [],
      success: req.query.success || null,
      error: req.query.error || null
    });
  }
});

// POST /profile/update
router.post("/update", ensureAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id;
    let { full_name, phone, date_of_birth, nick_name } = req.body;

    if (date_of_birth) date_of_birth = date_of_birth.split("T")[0];

    const updates = [];
    const values = [];

    if (full_name) { updates.push(`full_name=?`); values.push(full_name); }
    if (phone !== undefined) { updates.push(`phone=?`); values.push(phone || null); }
    if (date_of_birth !== undefined) { updates.push(`date_of_birth=?`); values.push(date_of_birth || null); }

    // UPDATE users table IF NEEDED
    if (updates.length) {
      const query = `UPDATE users SET ${updates.join(", ")}, updated_at=NOW() WHERE id=?`;
      values.push(userId);
      await db.execute(query, values);
    }

    // UPDATE officers.nick_name IF PROVIDED AND USER IS OFFICER
    if (nick_name !== undefined) {
      await db.execute(
        `UPDATE officers SET nick_name=? WHERE user_id=?`,
        [nick_name || null, userId]
      );
    }

    // Update session data
    if (full_name) req.session.user.full_name = full_name;
    if (phone !== undefined) req.session.user.phone = phone;
    if (date_of_birth !== undefined) req.session.user.date_of_birth = date_of_birth;
   
    res.redirect("/profile?success=Profile updated successfully");
  } catch (err) {
    console.error("Profile update error:", err);
    res.redirect("/profile?error=Failed to update profile");
  }
});

export default router;
