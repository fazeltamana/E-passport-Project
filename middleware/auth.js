// middleware/auth.js
export function ensureAuthenticated(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/auth/login");
  }
  next();
}

export function ensureRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect("/auth/login");
    }

    // Make role comparison case-insensitive
    const userRoles = (req.session.user.roles || []).map(r => r.toUpperCase());
    const allowed = allowedRoles.map(r => r.toUpperCase());
    const hasRole = userRoles.some(r => allowed.includes(r));

    if (!hasRole) {
      return res.status(403).send("Forbidden: insufficient role");
    }

    next();
  };
}

// middleware/setUser.js
export function setUser(req, res, next) {
  res.locals.user = req.session.user || null;
  next();
}
