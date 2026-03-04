require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const { League, Player, LeaguePlayer } = require("../models");

const iplTeams = [
  { name: "Chennai Super Kings", shortName: "CSK", logo: "" },
  { name: "Mumbai Indians", shortName: "MI", logo: "" },
  { name: "Royal Challengers Bengaluru", shortName: "RCB", logo: "" },
  { name: "Kolkata Knight Riders", shortName: "KKR", logo: "" },
  { name: "Sunrisers Hyderabad", shortName: "SRH", logo: "" },
  { name: "Rajasthan Royals", shortName: "RR", logo: "" },
  { name: "Delhi Capitals", shortName: "DC", logo: "" },
  { name: "Punjab Kings", shortName: "PBKS", logo: "" },
  { name: "Lucknow Super Giants", shortName: "LSG", logo: "" },
  { name: "Gujarat Titans", shortName: "GT", logo: "" },
];

/**
 * IPL-style auction sets — minimal placeholder.
 * The actual set structure is built dynamically by AuctionEngine._buildDynamicSets()
 * at auction initialization time based on player pool attributes (base price, role, capped status).
 * This placeholder ensures the schema is valid; it gets overwritten when the auction starts.
 */
const auctionSets = [
  { code: "M1",  name: "Marquee Set 1",      phase: "marquee",     roleFilter: "", cappedOnly: null, order: 1 },
  { code: "ACC", name: "Accelerated Round",   phase: "accelerated", roleFilter: "", cappedOnly: null, order: 99 },
];

const iplLeague = {
  name: "Indian Premier League",
  code: "IPL",
  totalTeams: 10,
  purse: 12000, // 120 Cr = 12000 lakhs
  maxSquadSize: 25,
  minSquadSize: 18,
  maxOverseas: 8,
  teams: iplTeams,
  retention: {
    maxRetentions: 4,
    slots: [
      { slot: 1, cost: 1800, type: "capped" },
      { slot: 2, cost: 1400, type: "capped" },
      { slot: 3, cost: 1100, type: "capped" },
      { slot: 4, cost: 1100, type: "uncapped" },
    ],
  },
  basePrices: [200, 150, 100, 75, 50, 30, 20],
  bidIncrements: [
    { upTo: 100, increment: 5 },
    { upTo: 200, increment: 10 },
    { upTo: 500, increment: 15 },
    { upTo: 1000, increment: 20 },
    { upTo: 100000, increment: 25 },
  ],
  auctionSets,
};

// ────────────── PLAYERS ──────────────
const players = [
  // ───── MARQUEE SET 1 (M1) — top capped stars ─────
  { name: "Virat Kohli",       nationality: "Indian",       isOverseas: false, role: "Batsman",       battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Medium",       age: 36, isCapped: true,  skills: ["Top Order", "Chase Master", "Anchor"] },
  { name: "Rohit Sharma",      nationality: "Indian",       isOverseas: false, role: "Batsman",       battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Off Spin",     age: 37, isCapped: true,  skills: ["Opening Batsman", "Captain", "Power Hitter"] },
  { name: "Jasprit Bumrah",    nationality: "Indian",       isOverseas: false, role: "Bowler",        battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Fast",          age: 30, isCapped: true,  skills: ["Fast Bowler", "Death Bowling", "Yorker Specialist"] },
  { name: "Rishabh Pant",      nationality: "Indian",       isOverseas: false, role: "Wicket-Keeper", battingStyle: "Left-Hand",  bowlingStyle: "",                       age: 27, isCapped: true,  skills: ["Wicket-Keeper", "Power Hitter", "Finisher"] },
  { name: "Pat Cummins",       nationality: "Australian",   isOverseas: true,  role: "Bowler",        battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Fast",          age: 31, isCapped: true,  skills: ["Fast Bowler", "Captain", "Lower Order Bat"] },
  { name: "Jos Buttler",       nationality: "English",      isOverseas: true,  role: "Wicket-Keeper", battingStyle: "Right-Hand", bowlingStyle: "",                       age: 33, isCapped: true,  skills: ["Wicket-Keeper", "Opening Batsman", "Power Hitter"] },
  // ───── MARQUEE SET 2 (M2) ─────
  { name: "Suryakumar Yadav",  nationality: "Indian",       isOverseas: false, role: "Batsman",       battingStyle: "Right-Hand", bowlingStyle: "",                       age: 33, isCapped: true,  skills: ["Middle Order", "360° Batsman", "T20 Specialist"] },
  { name: "Hardik Pandya",     nationality: "Indian",       isOverseas: false, role: "All-Rounder",   battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Fast Medium",   age: 30, isCapped: true,  skills: ["All-Rounder", "Power Hitter", "Fast Medium"] },
  { name: "Rashid Khan",       nationality: "Afghan",       isOverseas: true,  role: "Bowler",        battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Leg Spin",      age: 26, isCapped: true,  skills: ["Leg Spinner", "Lower Order Bat", "T20 Specialist"] },
  { name: "Glenn Maxwell",     nationality: "Australian",   isOverseas: true,  role: "All-Rounder",   battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Off Spin",      age: 36, isCapped: true,  skills: ["All-Rounder", "Power Hitter", "Off Spin"] },
  { name: "Mitchell Starc",    nationality: "Australian",   isOverseas: true,  role: "Bowler",        battingStyle: "Left-Hand",  bowlingStyle: "Left-Arm Fast",           age: 34, isCapped: true,  skills: ["Fast Bowler", "Yorker Specialist", "Left-Arm Fast"] },
  { name: "Kagiso Rabada",     nationality: "South African",isOverseas: true,  role: "Bowler",        battingStyle: "Left-Hand",  bowlingStyle: "Right-Arm Fast",          age: 29, isCapped: true,  skills: ["Fast Bowler", "Death Bowling", "Powerplay Specialist"] },
  // ───── CAPPED BATTERS (BA1) ─────
  { name: "Shubman Gill",      nationality: "Indian",       isOverseas: false, role: "Batsman",       battingStyle: "Right-Hand", bowlingStyle: "",                       age: 25, isCapped: true,  skills: ["Opening Batsman", "Captain", "Anchor"] },
  { name: "Ruturaj Gaikwad",   nationality: "Indian",       isOverseas: false, role: "Batsman",       battingStyle: "Right-Hand", bowlingStyle: "",                       age: 27, isCapped: true,  skills: ["Opening Batsman", "Anchor", "Captain"] },
  { name: "Shreyas Iyer",      nationality: "Indian",       isOverseas: false, role: "Batsman",       battingStyle: "Right-Hand", bowlingStyle: "",                       age: 29, isCapped: true,  skills: ["Middle Order", "Captain", "Spin Hitter"] },
  { name: "Travis Head",       nationality: "Australian",   isOverseas: true,  role: "Batsman",       battingStyle: "Left-Hand",  bowlingStyle: "Right-Arm Off Spin",      age: 30, isCapped: true,  skills: ["Opening Batsman", "Power Hitter", "Off Spin"] },
  { name: "David Warner",      nationality: "Australian",   isOverseas: true,  role: "Batsman",       battingStyle: "Left-Hand",  bowlingStyle: "Left-Arm Spin",           age: 37, isCapped: true,  skills: ["Opening Batsman", "T20 Specialist", "Power Hitter"] },
  { name: "Shikhar Dhawan",    nationality: "Indian",       isOverseas: false, role: "Batsman",       battingStyle: "Left-Hand",  bowlingStyle: "",                       age: 38, isCapped: true,  skills: ["Opening Batsman", "Anchor"] },
  { name: "Yashasvi Jaiswal",  nationality: "Indian",       isOverseas: false, role: "Batsman",       battingStyle: "Left-Hand",  bowlingStyle: "Left-Arm Spin",           age: 22, isCapped: true,  skills: ["Opening Batsman", "Power Hitter", "Left-Arm Spin"] },
  { name: "Devon Conway",      nationality: "New Zealander",isOverseas: true,  role: "Batsman",       battingStyle: "Left-Hand",  bowlingStyle: "",                       age: 33, isCapped: true,  skills: ["Opening Batsman", "Anchor"] },
  // ───── CAPPED ALL-ROUNDERS (AL1) ─────
  { name: "Ravindra Jadeja",   nationality: "Indian",       isOverseas: false, role: "All-Rounder",   battingStyle: "Left-Hand",  bowlingStyle: "Left-Arm Spin",           age: 35, isCapped: true,  skills: ["All-Rounder", "Left-Arm Spin", "Fielder"] },
  { name: "Andre Russell",     nationality: "West Indian",  isOverseas: true,  role: "All-Rounder",   battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Fast",          age: 36, isCapped: true,  skills: ["All-Rounder", "Power Hitter", "Death Bowler"] },
  { name: "Sam Curran",        nationality: "English",      isOverseas: true,  role: "All-Rounder",   battingStyle: "Left-Hand",  bowlingStyle: "Left-Arm Medium Fast",    age: 26, isCapped: true,  skills: ["All-Rounder", "Left-Arm Medium", "Lower Order Bat"] },
  { name: "Axar Patel",        nationality: "Indian",       isOverseas: false, role: "All-Rounder",   battingStyle: "Left-Hand",  bowlingStyle: "Left-Arm Spin",           age: 30, isCapped: true,  skills: ["All-Rounder", "Left-Arm Spin", "Lower Order Bat"] },
  { name: "Sunil Narine",      nationality: "West Indian",  isOverseas: true,  role: "All-Rounder",   battingStyle: "Left-Hand",  bowlingStyle: "Right-Arm Off Spin",      age: 36, isCapped: true,  skills: ["All-Rounder", "Mystery Spinner", "Pinch Hitter"] },
  { name: "Rachin Ravindra",   nationality: "New Zealander",isOverseas: true,  role: "All-Rounder",   battingStyle: "Left-Hand",  bowlingStyle: "Left-Arm Spin",           age: 25, isCapped: true,  skills: ["All-Rounder", "Opening Batsman", "Left-Arm Spin"] },
  // ───── CAPPED WICKET-KEEPERS (WK1) ─────
  { name: "MS Dhoni",          nationality: "Indian",       isOverseas: false, role: "Wicket-Keeper", battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Medium",        age: 43, isCapped: true,  skills: ["Wicket-Keeper", "Finisher", "Captain"] },
  { name: "Sanju Samson",      nationality: "Indian",       isOverseas: false, role: "Wicket-Keeper", battingStyle: "Right-Hand", bowlingStyle: "",                       age: 29, isCapped: true,  skills: ["Wicket-Keeper", "Top Order", "Captain"] },
  { name: "KL Rahul",          nationality: "Indian",       isOverseas: false, role: "Wicket-Keeper", battingStyle: "Right-Hand", bowlingStyle: "",                       age: 32, isCapped: true,  skills: ["Wicket-Keeper", "Opening Batsman", "Anchor"] },
  { name: "Ishan Kishan",      nationality: "Indian",       isOverseas: false, role: "Wicket-Keeper", battingStyle: "Left-Hand",  bowlingStyle: "",                       age: 26, isCapped: true,  skills: ["Wicket-Keeper", "Opening Batsman", "Power Hitter"] },
  { name: "Nicholas Pooran",   nationality: "West Indian",  isOverseas: true,  role: "Wicket-Keeper", battingStyle: "Left-Hand",  bowlingStyle: "",                       age: 28, isCapped: true,  skills: ["Wicket-Keeper", "Power Hitter", "Middle Order"] },
  { name: "Quinton de Kock",   nationality: "South African",isOverseas: true,  role: "Wicket-Keeper", battingStyle: "Left-Hand",  bowlingStyle: "",                       age: 31, isCapped: true,  skills: ["Wicket-Keeper", "Opening Batsman", "Power Hitter"] },
  // ───── CAPPED FAST BOWLERS (FA1) ─────
  { name: "Mohammed Shami",    nationality: "Indian",       isOverseas: false, role: "Bowler",        battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Fast Medium",   age: 34, isCapped: true,  skills: ["Fast Bowler", "Swing Bowling", "Death Bowling"] },
  { name: "Mohammed Siraj",    nationality: "Indian",       isOverseas: false, role: "Bowler",        battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Fast",          age: 30, isCapped: true,  skills: ["Fast Bowler", "Swing Bowling", "Powerplay Specialist"] },
  { name: "Trent Boult",       nationality: "New Zealander",isOverseas: true,  role: "Bowler",        battingStyle: "Right-Hand", bowlingStyle: "Left-Arm Fast",           age: 35, isCapped: true,  skills: ["Fast Bowler", "Swing Bowling", "Powerplay Specialist"] },
  { name: "Arshdeep Singh",    nationality: "Indian",       isOverseas: false, role: "Bowler",        battingStyle: "Left-Hand",  bowlingStyle: "Left-Arm Fast Medium",    age: 25, isCapped: true,  skills: ["Fast Bowler", "Death Bowling", "Left-Arm"] },
  { name: "Mukesh Kumar",      nationality: "Indian",       isOverseas: false, role: "Bowler",        battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Fast Medium",   age: 30, isCapped: true,  skills: ["Fast Bowler", "Swing Bowling"] },
  // ───── CAPPED SPINNERS (SP1) ─────
  { name: "Yuzvendra Chahal",  nationality: "Indian",       isOverseas: false, role: "Bowler",        battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Leg Spin",      age: 34, isCapped: true,  skills: ["Leg Spinner", "T20 Specialist"] },
  { name: "Kuldeep Yadav",     nationality: "Indian",       isOverseas: false, role: "Bowler",        battingStyle: "Left-Hand",  bowlingStyle: "Left-Arm Chin Spin",      age: 29, isCapped: true,  skills: ["Chinaman Bowler", "Spin Specialist"] },
  { name: "R Ashwin",          nationality: "Indian",       isOverseas: false, role: "Bowler",        battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Off Spin",      age: 38, isCapped: true,  skills: ["Off Spinner", "Carrom Ball", "Veteran"] },
  { name: "Varun Chakaravarthy", nationality: "Indian",     isOverseas: false, role: "Bowler",        battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Leg Spin",      age: 33, isCapped: true,  skills: ["Mystery Spinner", "T20 Specialist"] },
  // ───── UNCAPPED BATTERS (UBA1) ─────
  { name: "Tilak Varma",       nationality: "Indian",       isOverseas: false, role: "Batsman",       battingStyle: "Left-Hand",  bowlingStyle: "Right-Arm Off Spin",      age: 21, isCapped: false, skills: ["Middle Order", "Anchor", "Off Spin"] },
  { name: "Rinku Singh",       nationality: "Indian",       isOverseas: false, role: "Batsman",       battingStyle: "Left-Hand",  bowlingStyle: "",                       age: 27, isCapped: false, skills: ["Finisher", "Middle Order", "Power Hitter"] },
  { name: "Dhruv Jurel",       nationality: "Indian",       isOverseas: false, role: "Batsman",       battingStyle: "Right-Hand", bowlingStyle: "",                       age: 23, isCapped: false, skills: ["Middle Order", "Wicket-Keeper"] },
  { name: "Riyan Parag",       nationality: "Indian",       isOverseas: false, role: "Batsman",       battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Off Spin",      age: 22, isCapped: false, skills: ["Middle Order", "Off Spin", "Fielder"] },
  { name: "Prabhsimran Singh", nationality: "Indian",       isOverseas: false, role: "Batsman",       battingStyle: "Right-Hand", bowlingStyle: "",                       age: 23, isCapped: false, skills: ["Opening Batsman", "Power Hitter"] },
  // ───── UNCAPPED ALL-ROUNDERS (UAL1) ─────
  { name: "Abhishek Sharma",   nationality: "Indian",       isOverseas: false, role: "All-Rounder",   battingStyle: "Left-Hand",  bowlingStyle: "Left-Arm Spin",           age: 24, isCapped: false, skills: ["All-Rounder", "Power Hitter", "Left-Arm Spin"] },
  { name: "Nitish Kumar Reddy",nationality: "Indian",       isOverseas: false, role: "All-Rounder",   battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Fast Medium",   age: 21, isCapped: false, skills: ["All-Rounder", "Fast Medium", "Lower Order Bat"] },
  { name: "Harshit Rana",      nationality: "Indian",       isOverseas: false, role: "All-Rounder",   battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Fast",          age: 22, isCapped: false, skills: ["Fast Bowler", "All-Rounder", "Lower Order Bat"] },
  { name: "Venkatesh Iyer",    nationality: "Indian",       isOverseas: false, role: "All-Rounder",   battingStyle: "Left-Hand",  bowlingStyle: "Right-Arm Medium",        age: 29, isCapped: false, skills: ["All-Rounder", "Power Hitter", "Medium Pace"] },
  // ───── UNCAPPED WICKET-KEEPERS (UWK1) ─────
  { name: "Jitesh Sharma",     nationality: "Indian",       isOverseas: false, role: "Wicket-Keeper", battingStyle: "Left-Hand",  bowlingStyle: "",                       age: 30, isCapped: false, skills: ["Wicket-Keeper", "Finisher", "Lower Order Bat"] },
  { name: "Sai Sudharsan",     nationality: "Indian",       isOverseas: false, role: "Wicket-Keeper", battingStyle: "Left-Hand",  bowlingStyle: "",                       age: 22, isCapped: false, skills: ["Opening Batsman", "Anchor"] },
  { name: "Rahul Tewatia",     nationality: "Indian",       isOverseas: false, role: "Wicket-Keeper", battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Leg Spin",      age: 31, isCapped: false, skills: ["Finisher", "Leg Spin"] },
  // ───── UNCAPPED FAST BOWLERS (UFA1) ─────
  { name: "Tushar Deshpande",  nationality: "Indian",       isOverseas: false, role: "Bowler",        battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Fast Medium",   age: 29, isCapped: false, skills: ["Fast Bowler", "Death Bowling"] },
  { name: "Anrich Nortje",     nationality: "South African",isOverseas: true,  role: "Bowler",        battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Fast",          age: 30, isCapped: false, skills: ["Express Pace", "Fast Bowler", "Powerplay Specialist"] },
  { name: "Mohsin Khan",       nationality: "Indian",       isOverseas: false, role: "Bowler",        battingStyle: "Left-Hand",  bowlingStyle: "Left-Arm Fast Medium",    age: 25, isCapped: false, skills: ["Fast Bowler", "Left-Arm", "Swing Bowling"] },
  { name: "Umran Malik",       nationality: "Indian",       isOverseas: false, role: "Bowler",        battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Fast",          age: 24, isCapped: false, skills: ["Express Pace", "Fast Bowler"] },
  // ───── UNCAPPED SPINNERS (USP1) ─────
  { name: "Ravi Bishnoi",      nationality: "Indian",       isOverseas: false, role: "Bowler",        battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Leg Spin",      age: 24, isCapped: false, skills: ["Leg Spinner", "T20 Specialist"] },
  { name: "Rahul Chahar",      nationality: "Indian",       isOverseas: false, role: "Bowler",        battingStyle: "Right-Hand", bowlingStyle: "Right-Arm Leg Spin",      age: 25, isCapped: false, skills: ["Leg Spinner", "T20 Specialist"] },
  { name: "Shahbaz Ahmed",     nationality: "Indian",       isOverseas: false, role: "Bowler",        battingStyle: "Left-Hand",  bowlingStyle: "Left-Arm Spin",           age: 30, isCapped: false, skills: ["Left-Arm Spin", "Lower Order Bat"] },
];

// Set assignment is now handled dynamically by AuctionEngine._buildDynamicSets()
// No manual setMap needed — players are auto-categorized by base price, role, and capped status

// Previous team mapping for retention
const previousTeamMap = {
  "MS Dhoni": "Chennai Super Kings",
  "Ruturaj Gaikwad": "Chennai Super Kings",
  "Ravindra Jadeja": "Chennai Super Kings",
  "Devon Conway": "Chennai Super Kings",
  "Rachin Ravindra": "Chennai Super Kings",
  "Rohit Sharma": "Mumbai Indians",
  "Jasprit Bumrah": "Mumbai Indians",
  "Suryakumar Yadav": "Mumbai Indians",
  "Ishan Kishan": "Mumbai Indians",
  "Tilak Varma": "Mumbai Indians",
  "Virat Kohli": "Royal Challengers Bengaluru",
  "Glenn Maxwell": "Royal Challengers Bengaluru",
  "Mohammed Siraj": "Royal Challengers Bengaluru",
  "Shreyas Iyer": "Kolkata Knight Riders",
  "Andre Russell": "Kolkata Knight Riders",
  "Sunil Narine": "Kolkata Knight Riders",
  "Rinku Singh": "Kolkata Knight Riders",
  "Nitish Kumar Reddy": "Kolkata Knight Riders",
  "Harshit Rana": "Kolkata Knight Riders",
  "Pat Cummins": "Sunrisers Hyderabad",
  "Travis Head": "Sunrisers Hyderabad",
  "Abhishek Sharma": "Sunrisers Hyderabad",
  "Sanju Samson": "Rajasthan Royals",
  "Jos Buttler": "Rajasthan Royals",
  "Yashasvi Jaiswal": "Rajasthan Royals",
  "Riyan Parag": "Rajasthan Royals",
  "Rishabh Pant": "Delhi Capitals",
  "David Warner": "Delhi Capitals",
  "Axar Patel": "Delhi Capitals",
  "Kuldeep Yadav": "Delhi Capitals",
  "Anrich Nortje": "Delhi Capitals",
  "Shikhar Dhawan": "Punjab Kings",
  "Sam Curran": "Punjab Kings",
  "Kagiso Rabada": "Punjab Kings",
  "Arshdeep Singh": "Punjab Kings",
  "KL Rahul": "Lucknow Super Giants",
  "Nicholas Pooran": "Lucknow Super Giants",
  "Quinton de Kock": "Lucknow Super Giants",
  "Ravi Bishnoi": "Lucknow Super Giants",
  "Shubman Gill": "Gujarat Titans",
  "Rashid Khan": "Gujarat Titans",
  "Mohammed Shami": "Gujarat Titans",
  "Hardik Pandya": "Gujarat Titans",
};

// Base prices (auction starting price in lakhs)
const basePriceMap = {
  "Virat Kohli": 200, "Rohit Sharma": 200, "Jasprit Bumrah": 200,
  "Rishabh Pant": 200, "Pat Cummins": 200, "Jos Buttler": 200,
  "Suryakumar Yadav": 200, "Hardik Pandya": 200, "Rashid Khan": 200,
  "Glenn Maxwell": 200, "Mitchell Starc": 200, "Kagiso Rabada": 200,
  "Shubman Gill": 200, "Ruturaj Gaikwad": 200, "Shreyas Iyer": 200,
  "Travis Head": 200, "David Warner": 150, "Shikhar Dhawan": 100,
  "Yashasvi Jaiswal": 200, "Devon Conway": 150,
  "Ravindra Jadeja": 200, "Andre Russell": 200, "Sam Curran": 200,
  "Axar Patel": 200, "Sunil Narine": 200, "Rachin Ravindra": 150,
  "MS Dhoni": 200, "Sanju Samson": 200, "KL Rahul": 200,
  "Ishan Kishan": 200, "Nicholas Pooran": 200, "Quinton de Kock": 200,
  "Mohammed Shami": 200, "Mohammed Siraj": 200, "Trent Boult": 200,
  "Arshdeep Singh": 150, "Mukesh Kumar": 75,
  "Yuzvendra Chahal": 200, "Kuldeep Yadav": 200, "R Ashwin": 200,
  "Varun Chakaravarthy": 150,
  // Uncapped — lower base prices
  "Tilak Varma": 150, "Rinku Singh": 150, "Dhruv Jurel": 75,
  "Riyan Parag": 100, "Prabhsimran Singh": 50,
  "Abhishek Sharma": 150, "Nitish Kumar Reddy": 100,
  "Harshit Rana": 75, "Venkatesh Iyer": 100,
  "Jitesh Sharma": 50, "Sai Sudharsan": 75, "Rahul Tewatia": 50,
  "Tushar Deshpande": 75, "Anrich Nortje": 150,
  "Mohsin Khan": 50, "Umran Malik": 75,
  "Ravi Bishnoi": 100, "Rahul Chahar": 75, "Shahbaz Ahmed": 50,
};

// Franchise price — retention cost
const franchisePriceMap = {
  "MS Dhoni": 1200, "Ruturaj Gaikwad": 1400, "Ravindra Jadeja": 1600,
  "Devon Conway": 800, "Rachin Ravindra": 800,
  "Rohit Sharma": 1600, "Jasprit Bumrah": 1800,
  "Suryakumar Yadav": 1600, "Ishan Kishan": 900, "Tilak Varma": 900,
  "Virat Kohli": 1800, "Glenn Maxwell": 1100, "Mohammed Siraj": 1100,
  "Shreyas Iyer": 1200, "Andre Russell": 1200, "Sunil Narine": 1200,
  "Rinku Singh": 800,
  "Pat Cummins": 1400, "Travis Head": 1400, "Abhishek Sharma": 800,
  "Sanju Samson": 1400, "Jos Buttler": 1000, "Yashasvi Jaiswal": 1600,
  "Rishabh Pant": 1600, "David Warner": 800,
  "Axar Patel": 1000, "Kuldeep Yadav": 1000,
  "Shikhar Dhawan": 600, "Sam Curran": 1400, "Kagiso Rabada": 1200,
  "KL Rahul": 1400, "Nicholas Pooran": 900, "Quinton de Kock": 900,
  "Shubman Gill": 1600, "Rashid Khan": 1200, "Mohammed Shami": 1200,
  "Hardik Pandya": 1500, "Yuzvendra Chahal": 800,
  "Mitchell Starc": 1200, "Trent Boult": 1000,
};

async function seed() {
  await connectDB();

  console.log("[Seed] Clearing existing data...");
  await League.deleteMany({});
  await Player.deleteMany({});
  await LeaguePlayer.deleteMany({});

  console.log("[Seed] Creating IPL league with auction sets...");
  const league = await League.create(iplLeague);

  console.log("[Seed] Creating players...");
  const createdPlayers = await Player.insertMany(players);

  console.log("[Seed] Creating league-player links...");
  const leaguePlayers = createdPlayers.map((p) => ({
    player: p._id,
    league: league._id,
    basePrice: basePriceMap[p.name] || 100,
    franchisePrice: franchisePriceMap[p.name] || 0,
    previousTeam: previousTeamMap[p.name] || "",
    stats: {
      matches: Math.floor(Math.random() * 100) + 20,
      runs: Math.floor(Math.random() * 3000),
      wickets: Math.floor(Math.random() * 80),
      average: +(Math.random() * 40 + 15).toFixed(2),
      strikeRate: +(Math.random() * 80 + 100).toFixed(2),
      economy: +(Math.random() * 4 + 6).toFixed(2),
    },
    set: "", // Will be assigned dynamically by AuctionEngine at auction start
  }));

  await LeaguePlayer.insertMany(leaguePlayers);

  console.log(`[Seed] Done! Created:`);
  console.log(`  - 1 League (IPL)`);
  console.log(`  - ${createdPlayers.length} Players`);
  console.log(`  - ${leaguePlayers.length} LeaguePlayers`);
  console.log(`  (Sets will be assigned dynamically when auction starts)`);

  // Print role distribution
  const roleDistribution = {};
  createdPlayers.forEach((p) => {
    const key = `${p.isCapped ? "Capped" : "Uncapped"} ${p.role}`;
    if (!roleDistribution[key]) roleDistribution[key] = [];
    roleDistribution[key].push(p.name);
  });
  console.log("\n  Role Distribution:");
  Object.entries(roleDistribution).sort().forEach(([role, names]) => {
    console.log(`    ${role} (${names.length}): ${names.join(", ")}`);
  });

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error("[Seed] Error:", err);
  process.exit(1);
});
