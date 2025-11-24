import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();
import session from "express-session";
import expressLayouts from "express-ejs-layouts";
import { ensureAuthenticated, ensureRole, setUser } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import citizenRoutes from "./routes/citizen.js";
import officerRoutes from "./routes/officer.js";
import deptHeadRoutes from "./routes/deptHead.js";
import adminRoutes from "./routes/admin.js";
import profileRoutes from "./routes/profile.js";
import db from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// View engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- Session setup ---
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8, httpOnly: true, sameSite: "strict" },
  })
);

// Set user in req
app.use(setUser);

// --- Disable caching for authenticated routes ---
app.use((req, res, next) => {
  if (req.session.user) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

// Notifications middleware (citizen only)
app.use(async (req, res, next) => {
  res.locals.user = req.session.user || null;

  if (req.session.user) {
    const userRoles = (req.session.user.roles || []).map(r => r.toUpperCase());
    if (userRoles.includes("CITIZEN")) {
      try {
        const [rows] = await db.execute(
          `SELECT * FROM notifications 
           WHERE user_id = ?
           ORDER BY is_read ASC, created_at DESC 
           LIMIT 5`,
          [req.session.user.id]
        );
        res.locals.notifications = rows;
      } catch (err) {
        console.error("Notification fetch error:", err);
        res.locals.notifications = [];
      }
    } else {
      res.locals.notifications = [];
    }
  } else {
    res.locals.notifications = [];
  }

  next();
});

// Routes
app.use("/auth", authRoutes);
app.use("/citizen", ensureAuthenticated, ensureRole("CITIZEN"), citizenRoutes);
app.use("/officer", ensureAuthenticated, ensureRole("OFFICER"), officerRoutes);
app.use("/depthead", ensureAuthenticated, ensureRole("DEPT_HEAD"), deptHeadRoutes);
app.use("/admin", ensureAuthenticated, ensureRole("ADMIN"), adminRoutes);
app.use("/profile", ensureAuthenticated, profileRoutes);

// Home redirect
app.get("/", (req, res) => {
  res.redirect("/auth/login");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
