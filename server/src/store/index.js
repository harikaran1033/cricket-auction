const path = require("path");

const storeRoot = __dirname;
const dataDir = path.join(storeRoot, "data");
const scriptsDir = path.join(storeRoot, "scripts");
const seedDir = path.join(storeRoot, "seed");

function getDataPath(...segments) {
  return path.join(dataDir, ...segments);
}

function getScriptPath(...segments) {
  return path.join(scriptsDir, ...segments);
}

function getSeedPath(...segments) {
  return path.join(seedDir, ...segments);
}

module.exports = {
  storeRoot,
  dataDir,
  scriptsDir,
  seedDir,
  getDataPath,
  getScriptPath,
  getSeedPath,
};
