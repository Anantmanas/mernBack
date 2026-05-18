const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const GitHubStrategy = require("passport-github2").Strategy;
const User = require("../models/User");
require("dotenv").config();

const resolveBackendBaseUrl = () => {
  const configuredUrl = process.env.BACKEND_BASE_URL;
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  const fallbackUrl = "https://mernback-lsed.onrender.com";
  const rawUrl = configuredUrl || renderUrl || fallbackUrl;

  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(rawUrl)) {
    return (renderUrl || fallbackUrl).replace(/\/$/, "");
  }

  return rawUrl.replace(/\/$/, "");
};

const BACKEND_BASE_URL = resolveBackendBaseUrl();
const oauthMemoryUsers = new Map();

const isMongoConnected = () => require("mongoose").connection.readyState === 1;

const memoryOAuthUser = ({ provider, providerId, email, name }) => {
  const id = `${provider}:${providerId}`;
  const existing = oauthMemoryUsers.get(id);
  const user = {
    id,
    _id: id,
    email,
    name: name || "User",
    customUsername: existing?.customUsername || "",
  };
  oauthMemoryUsers.set(id, user);
  return user;
};

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${BACKEND_BASE_URL}/auth/google/callback`,
      },
      async (accessToken, refreshToken, profile, done) => {
        const { id, emails, displayName } = profile;
        const email = emails?.[0]?.value;
        if (!email) return done(new Error("Google profile did not include an email"), null);
        try {
          if (!isMongoConnected()) {
            return done(
              null,
              memoryOAuthUser({
                provider: "google",
                providerId: id,
                email,
                name: displayName,
              }),
            );
          }

          let user = await User.findOne({ googleId: id });
          if (!user) {
            user = await User.findOne({ email });
            if (!user) {
              user = new User({
                googleId: id,
                email,
                name: displayName,
              });
              await user.save();
            } else {
              user.googleId = id;
              await user.save();
            }
          }
          done(null, user);
        } catch (error) {
          done(error, null);
        }
      },
    ),
  );
}

if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: `${BACKEND_BASE_URL}/auth/github/callback`,
      },
      async (accessToken, refreshToken, profile, done) => {
        const { id, emails, displayName, username } = profile;
        const email =
          (emails && emails[0] && emails[0].value) || `${username}@github.com`;
        try {
          if (!isMongoConnected()) {
            return done(
              null,
              memoryOAuthUser({
                provider: "github",
                providerId: id,
                email,
                name: displayName || username,
              }),
            );
          }

          let user = await User.findOne({ githubId: id });
          if (!user) {
            user = await User.findOne({ email });
            if (!user) {
              user = new User({
                githubId: id,
                email,
                name: displayName || username,
              });
              await user.save();
            } else {
              user.githubId = id;
              await user.save();
            }
          }
          done(null, user);
        } catch (error) {
          done(error, null);
        }
      },
    ),
  );
}

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});
