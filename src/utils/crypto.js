const crypto = require("node:crypto");

function sha256(value){
  return crypto.createHash("sha256").update(value).digest("hex");
}

function randomToken(){
  return crypto.randomBytes(48).toString("base64url");
}

module.exports = { sha256, randomToken };
