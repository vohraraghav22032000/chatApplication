require("dotenv").config();

const config = {
  port: Number(process.env.PORT || 4007),

  clientOrigin:
    process.env.CLIENT_ORIGIN || "http://localhost:5173",

  databaseUrl: process.env.DATABASE_URL,

  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,

  accessTokenTtl:
    process.env.JWT_ACCESS_TTL || "15m",

  refreshTokenTtl:
    process.env.JWT_REFRESH_TTL || "30d",
};

console.log("JWT access secret loaded:", !!config.jwtAccessSecret);
console.log("JWT refresh secret loaded:", !!config.jwtRefreshSecret);

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL is missing from .env");
}

if (!config.jwtAccessSecret) {
  throw new Error("JWT_ACCESS_SECRET is missing from .env");
}

if (!config.jwtRefreshSecret) {
  throw new Error("JWT_REFRESH_SECRET is missing from .env");
}

module.exports = {
  config,
};