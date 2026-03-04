const express = require("express");
const router = express.Router();
const roomController = require("../controllers/roomController");

router.post("/", roomController.createRoom);
router.get("/live", roomController.getPublicRooms);
router.get("/:code", roomController.getRoomByCode);
router.post("/:code/lobby", roomController.moveToLobby);

module.exports = router;
