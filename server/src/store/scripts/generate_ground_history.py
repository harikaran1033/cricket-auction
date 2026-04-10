#!/usr/bin/env python3
"""Generate IPL ground history with innings results and pitch summaries."""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path
from typing import Dict, List

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def clean_text(value: str | None) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.upper() == "NA":
        return ""
    return text


def to_int(value: str | None) -> int:
    text = clean_text(value)
    if not text:
        return 0
    try:
        return int(float(text))
    except ValueError:
        return 0


def innings_summary(row: dict) -> dict:
    return {
        "team": clean_text(row.get("batting_team")) or "Unknown Team",
        "runs": to_int(row.get("team_runs")),
        "wickets": to_int(row.get("team_wicket")),
        "balls": to_int(row.get("team_balls")),
        "score": f"{to_int(row.get('team_runs'))}/{to_int(row.get('team_wicket'))}",
    }


def win_summary(match_row: dict, first_innings: dict, second_innings: dict) -> dict:
    winner = clean_text(match_row.get("match_won_by")) or "Unknown"
    if winner == first_innings["team"]:
        margin = max(0, first_innings["runs"] - second_innings["runs"])
        return {
            "winner": winner,
            "how_won": f"won by {margin} runs",
            "win_type": "runs",
            "margin": margin,
        }
    if winner == second_innings["team"]:
        wickets_left = max(0, 10 - second_innings["wickets"])
        return {
            "winner": winner,
            "how_won": f"won by {wickets_left} wickets",
            "win_type": "wickets",
            "margin": wickets_left,
        }
    if first_innings["runs"] == second_innings["runs"]:
        return {
            "winner": "Tie",
            "how_won": "match tied",
            "win_type": "tie",
            "margin": 0,
        }
    return {
        "winner": winner,
        "how_won": clean_text(match_row.get("win_outcome")) or "result unavailable",
        "win_type": clean_text(match_row.get("result_type")) or "unknown",
        "margin": 0,
    }


def pitch_label(avg_first_innings: float, avg_total_wickets: float, chase_win_rate: float) -> str:
    if avg_first_innings >= 185 and avg_total_wickets <= 11.5:
        return "batting_friendly"
    if avg_first_innings <= 155 or avg_total_wickets >= 13.0:
        return "bowling_friendly"
    if chase_win_rate >= 0.58:
        return "chasing_friendly"
    if chase_win_rate <= 0.42:
        return "defending_friendly"
    return "balanced"


def generate_ground_history(csv_path: Path) -> dict:
    matches: Dict[str, dict] = {}

    with csv_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            match_id = clean_text(row.get("match_id"))
            if not match_id:
                continue

            match = matches.setdefault(
                match_id,
                {
                    "match_id": match_id,
                    "date": clean_text(row.get("date")),
                    "season": clean_text(row.get("season")),
                    "venue": clean_text(row.get("venue")) or "Unknown Venue",
                    "city": clean_text(row.get("city")),
                    "toss_winner": clean_text(row.get("toss_winner")),
                    "toss_decision": clean_text(row.get("toss_decision")),
                    "result_type": clean_text(row.get("result_type")),
                    "method": clean_text(row.get("method")),
                    "innings": {},
                    "last_row": row,
                },
            )
            innings_no = to_int(row.get("innings"))
            if innings_no in (1, 2):
                match["innings"][innings_no] = row
            match["last_row"] = row

    grounds: Dict[str, List[dict]] = defaultdict(list)
    for match in matches.values():
        if 1 not in match["innings"] or 2 not in match["innings"]:
            continue

        first_innings = innings_summary(match["innings"][1])
        second_innings = innings_summary(match["innings"][2])
        win_data = win_summary(match["last_row"], first_innings, second_innings)
        record = {
            "match_id": match["match_id"],
            "date": match["date"],
            "season": match["season"],
            "venue": match["venue"],
            "city": match["city"],
            "toss_winner": match["toss_winner"],
            "toss_decision": match["toss_decision"],
            "first_batting": first_innings,
            "second_batting": second_innings,
            "winner": win_data["winner"],
            "how_won": win_data["how_won"],
            "win_type": win_data["win_type"],
            "margin": win_data["margin"],
            "result_type": match["result_type"],
            "method": match["method"],
        }
        grounds[match["venue"]].append(record)

    summary = {}
    for venue, records in sorted(grounds.items()):
        matches_count = len(records)
        avg_first = sum(item["first_batting"]["runs"] for item in records) / matches_count
        avg_second = sum(item["second_batting"]["runs"] for item in records) / matches_count
        avg_wickets = sum(
            item["first_batting"]["wickets"] + item["second_batting"]["wickets"] for item in records
        ) / matches_count
        chasing_wins = sum(1 for item in records if item["winner"] == item["second_batting"]["team"])
        defending_wins = sum(1 for item in records if item["winner"] == item["first_batting"]["team"])
        chase_win_rate = chasing_wins / matches_count

        summary[venue] = {
            "matches": matches_count,
            "avg_first_innings_runs": round(avg_first, 2),
            "avg_second_innings_runs": round(avg_second, 2),
            "avg_total_wickets": round(avg_wickets, 2),
            "chasing_wins": chasing_wins,
            "defending_wins": defending_wins,
            "chase_win_rate": round(chase_win_rate, 3),
            "pitch": pitch_label(avg_first, avg_wickets, chase_win_rate),
            "history": records,
        }

    return {
        "metadata": {
            "source_csv": str(csv_path),
            "grounds_count": len(summary),
            "matches_count": sum(item["matches"] for item in summary.values()),
        },
        "grounds": summary,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", default=str(DATA_DIR / "IPL.csv"))
    parser.add_argument("--output", default=str(DATA_DIR / "ipl_ground_history.json"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    csv_path = Path(args.csv).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    history = generate_ground_history(csv_path)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(history, handle, indent=2, ensure_ascii=True)
    print(f"Wrote ground history JSON to {output_path}")
    print(json.dumps(history["metadata"], indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()
