const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// #region agent log helper
const _dbgLog = (payload) => {
  try {
    const line = JSON.stringify({ sessionId: "7fa3ab", timestamp: Date.now(), ...payload }) + "\n";
    fs.appendFileSync(path.join(__dirname, "../../debug-7fa3ab.log"), line);
  } catch (_) {}
};
// #endregion

module.exports = function (req, res, next) {
  const token = req.header("x-auth-token");
  // #region agent log
  _dbgLog({ runId: "initial", hypothesisId: "H1", location: "auth.js:token-check", message: "authMiddleware entry", data: { hasToken: !!token, jwtSecretConfigured: !!process.env.JWT_SECRET } });
  // #endregion
  if (!token)
    return res.status(401).json({ msg: "No token, authorization denied" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    // #region agent log
    _dbgLog({ runId: "initial", hypothesisId: "H1", location: "auth.js:verified", message: "JWT verified OK", data: { hasUserId: !!decoded?.userId, hasName: !!decoded?.name } });
    // #endregion
    next();
  } catch (err) {
    // #region agent log
    _dbgLog({ runId: "initial", hypothesisId: "H1", location: "auth.js:verify-fail", message: "JWT verify failed", data: { errName: err?.name || null, errMsg: (err?.message || "").slice(0, 100) } });
    // #endregion
    res.status(401).json({ msg: "Token is not valid" });
  }
};
