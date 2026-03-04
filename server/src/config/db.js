const mongoose = require("mongoose");
const config = require("./index");

const connectDB = async () => {
  try {
    await mongoose.connect(config.mongoUri);
    console.log(`[DB] MongoDB connected`);
  } catch (err) {
    console.error(`[DB] Connection error:`, err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
