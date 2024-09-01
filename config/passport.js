const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const GitHubStrategy = require("passport-github2").Strategy;
const User = require("../models/User");
require("dotenv").config();
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      const { id, emails, displayName } = profile;
      const email = emails[0].value;
      try {
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
    }
  )
);

passport.use(
  new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: "/auth/github/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      const { id, emails, displayName, username } = profile;
      const email =
        (emails && emails[0] && emails[0].value) || `${username}@github.com`;
      try {
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
    }
  )
);

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
