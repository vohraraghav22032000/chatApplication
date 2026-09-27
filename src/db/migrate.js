const fs = require("node:fs/promises");
const path = require("node:path");
const {  pool  } = require("./index");

async function main() {
  const sql = await fs.readFile(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("Database schema applied.");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
