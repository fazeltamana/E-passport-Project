import express from "express";
import bcrypt from "bcrypt";
import db from "../db.js";

const router = express.Router();

// Show login page
router.get("/login", (req, res) => {
  const success = req.query.success
    ? "Account created successfully! Please log in."
    : null;

  res.render("auth/login", {
    user: req.session.user,
    error: null,
    success,
  });
});

// Handle login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    // Find active user
    const [rows] = await db.execute(
      "SELECT * FROM users WHERE email = ? AND is_active = true",
      [email]
    );
    const user = rows[0];

    if (!user) {
      return res.render("auth/login", { user: null, error: "Invalid credentials", success: null });
    }

    // Check password
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.render("auth/login", { user: null, error: "Invalid credentials", success: null });
    }

    // Fetch roles
    const [rolesRes] = await db.execute(
      `SELECT r.name
       FROM users_roles ur
       JOIN roles r ON ur.role_id = r.id
       WHERE ur.user_id = ?`,
      [user.id]
    );

    let roles = rolesRes.map(r => r.name.toUpperCase());

    // Fetch officer info if user is an officer or dept head
    let department_id = null;
    let officer_id = null;
    if (roles.includes("OFFICER") || roles.includes("DEPT_HEAD")) {
      const [officers] = await db.execute(`
        SELECT o.id AS officer_id, o.department_id, p.name AS position_name
        FROM officers o
        JOIN positions p ON o.position_id = p.id
        WHERE o.user_id = ?
      `, [user.id]);

      if (officers[0]) {
        officer_id = officers[0].officer_id;
        department_id = officers[0].department_id;
        const positionName = officers[0].position_name.toUpperCase();
        if (!roles.includes(positionName)) roles.push(positionName); // add position as role
      }
    }
    let department_name = null;

    if (department_id) {
      const [dept] = await db.execute(
        "SELECT name FROM departments WHERE id = ?",
        [department_id]
      );
      if (dept[0]) department_name = dept[0].name;
    }

    // Store minimal user in session
    req.session.user = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      roles,
      department_id,
      department_name,
      officer_id
    };

    // Redirect based on role priority
    if (roles.includes("ADMIN")) return res.redirect("/admin");
    if (roles.includes("OFFICER") ) return res.redirect("/officer");
    if (roles.includes("DEPT_HEAD")) return res.redirect("/depthead");
    if (roles.includes("CITIZEN")) return res.redirect("/citizen");

    return res.redirect("/");
  } catch (err) {
    console.error("Login error:", err);
    return res.render("auth/login", { user: null, error: "Server error", success: null });
  }
});
router.get("/check-session", (req, res) => {
  res.json({ loggedIn: !!req.session.user });
});

// Show registration page (citizen only)
router.get("/register", (req, res) => {
  res.render("auth/register", { user: req.session.user, error: null });
});

// Handle registration
router.post("/register", async (req, res) => {
  const { name, email, password, national_id, dob, contact } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);

    // Create user
    const [result] = await db.execute(
      `INSERT INTO users (full_name, email, password_hash, national_id, date_of_birth, phone)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, email, hashed, national_id || null, dob || null, contact || null]
    );

    const userId = result.insertId;

    // Ensure CITIZEN role exists
    const [roleRes] = await db.execute("SELECT id FROM roles WHERE name = 'CITIZEN'");
    let citizenRoleId;
    if (roleRes.length === 0) {
      const [ins] = await db.execute("INSERT INTO roles (name) VALUES ('CITIZEN')");
      citizenRoleId = ins.insertId;
    } else {
      citizenRoleId = roleRes[0].id;
    }

    // Link user to role
    await db.execute("INSERT INTO users_roles (user_id, role_id) VALUES (?, ?)", [userId, citizenRoleId]);

    // Redirect with success message
    return res.redirect("/auth/login?success=1");
  } catch (err) {
    console.error("Registration error:", err);
    return res.render("auth/register", { user: null, error: "Could not create user" });
  }
});

router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/auth/login"));
});

export default router;
