const fs = require("fs");
const path = require("path");

let cachedImageMap = null;

function normalizePlayerName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getAliasName(name) {
  const normalized = normalizePlayerName(name);
  const aliases = {
    "mohd arshad khan": "arshad khan",
    "ms dhoni": "mahendra singh dhoni",
    "kl rahul": "lokesh rahul",
    "r sai kishore": "sai kishore",
    "t natarajan": "thangarasu natarajan",
    "pravin dubey": "praveen dubey",
    "rasikh dar": "rasikh salam dar",
    "smaran ravichandaran": "smaran ravichandran",
    "yudhvir charak": "yudhvir singh charak",
    "vicky ostwal": "vicky kanhaiya ostwal",
    "m siddharth": "manimaran siddharth",
    "m shahrukh khan": "shahrukh khan",
    "varun chakravarthy": "varun chakaravarthy",
    "gurnoor singh brar": "gurnoor brar",
    "prithvi raj": "prithvi raj yarra",
  };

  return aliases[normalized] || normalized;
}

function loadImageMap() {
  if (cachedImageMap) return cachedImageMap;

  const csvPath = path.resolve(__dirname, "../../..", "cricketplayers (1).csv");
  const imageMap = new Map();

  if (!fs.existsSync(csvPath)) {
    cachedImageMap = imageMap;
    return imageMap;
  }

  const raw = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    cachedImageMap = imageMap;
    return imageMap;
  }

  const header = lines[0].split(",");
  const fullNameIdx = header.indexOf("fullname");
  const imageIdx = header.indexOf("image_path");

  if (fullNameIdx === -1 || imageIdx === -1) {
    cachedImageMap = imageMap;
    return imageMap;
  }

  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const fullName = cols[fullNameIdx];
    const imagePath = cols[imageIdx];
    if (!fullName || !imagePath) continue;

    const key = normalizePlayerName(fullName);
    if (!imageMap.has(key)) {
      imageMap.set(key, imagePath);
    }
  }

  cachedImageMap = imageMap;
  return imageMap;
}

function resolvePlayerImage(name) {
  const imageMap = loadImageMap();
  const lookupKey = getAliasName(name);
  return imageMap.get(lookupKey) || "";
}

module.exports = {
  normalizePlayerName,
  resolvePlayerImage,
};
