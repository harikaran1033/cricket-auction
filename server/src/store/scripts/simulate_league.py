#!/usr/bin/env python3
"""Simulate a T20 league with playoffs and season awards."""

from __future__ import annotations

import argparse
import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

from simulate_t20_match import SimulationEngine, load_json, load_player_registry, safe_div

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

MIN_SUPER_STRIKER_BALLS = 60


@dataclass
class Fixture:
    stage: str
    home_team: str
    away_team: str
    venue: str


def balls_to_overs(balls: int) -> str:
    return f"{balls // 6}.{balls % 6}"


def score_to_tuple(score: str) -> Tuple[int, int]:
    runs, wickets = score.split("/")
    return int(runs), int(wickets)


def load_teams(path: Path) -> List[dict]:
    payload = load_json(path)
    teams = payload.get("teams")
    if not isinstance(teams, list) or not teams:
        raise ValueError("league_teams.json must contain a non-empty 'teams' list")
    return teams


def copy_team(team: dict, venue: str) -> dict:
    clone = json.loads(json.dumps(team))
    clone["venue"] = venue
    return clone


def build_fixtures(teams: List[dict]) -> List[Fixture]:
    fixtures: List[Fixture] = []
    for i, home in enumerate(teams):
        for j, away in enumerate(teams):
            if i == j:
                continue
            fixtures.append(
                Fixture(
                    stage="league",
                    home_team=home["name"],
                    away_team=away["name"],
                    venue=home["venue"],
                )
            )
    return fixtures


def build_playoff_fixtures(league_table: List[dict], team_map: Dict[str, dict]) -> Tuple[Fixture, Fixture]:
    if len(league_table) < 4:
        raise ValueError("Playoff fixtures require at least 4 teams")
    first_seed = league_table[0]["team"]
    second_seed = league_table[1]["team"]
    third_seed = league_table[2]["team"]
    fourth_seed = league_table[3]["team"]
    semi_1 = Fixture("semi_final_1", first_seed, fourth_seed, team_map[first_seed]["venue"])
    semi_2 = Fixture("semi_final_2", second_seed, third_seed, team_map[second_seed]["venue"])
    return semi_1, semi_2


def player_of_match(match: dict) -> dict:
    candidates = []
    for team_key in ("teamA", "teamB"):
        team_name = match[team_key]["name"]
        team_won = team_name == match["winner"]
        for batter in match[team_key]["batting"]:
            balls = batter["balls"]
            if balls <= 0:
                continue
            impact = (
                batter["runs"] * 1.25
                + max(0.0, batter["strike_rate"] - 120.0) * 0.18
                + batter["fours"] * 1.2
                + batter["sixes"] * 2.0
            )
            if team_won:
                impact *= 1.08
            candidates.append(
                {
                    "player": batter["player"],
                    "team": team_name,
                    "role": "batting",
                    "impact": impact,
                    "performance": f"{batter['runs']} off {batter['balls']}",
                }
            )
        for bowler in match[team_key]["bowling"]:
            balls = bowler["balls"]
            if balls <= 0:
                continue
            economy_bonus = max(0.0, 9.0 - bowler["economy"]) * 3.0
            impact = (bowler["wickets"] * 24.0) + economy_bonus - (bowler["runs"] * 0.22)
            if team_won:
                impact *= 1.08
            candidates.append(
                {
                    "player": bowler["player"],
                    "team": team_name,
                    "role": "bowling",
                    "impact": impact,
                    "performance": f"{bowler['wickets']}/{bowler['runs']} in {bowler['overs']}",
                }
            )
    return max(candidates, key=lambda item: item["impact"])


def init_points_table(teams: List[dict]) -> Dict[str, dict]:
    table = {}
    for team in teams:
        table[team["name"]] = {
            "team": team["name"],
            "played": 0,
            "won": 0,
            "lost": 0,
            "points": 0,
            "runs_for": 0,
            "balls_faced": 0,
            "runs_against": 0,
            "balls_bowled": 0,
            "nrr": 0.0,
            "home_venue": team["venue"],
        }
    return table


def init_player_stats(team_map: Dict[str, dict]) -> Dict[str, dict]:
    stats: Dict[str, dict] = {}
    for team_name, team in team_map.items():
        for player in team["playing11"]:
            stats[player] = {
                "team": team_name,
                "matches": 0,
                "innings": 0,
                "runs": 0,
                "balls": 0,
                "fours": 0,
                "sixes": 0,
                "outs": 0,
                "fifties": 0,
                "hundreds": 0,
                "wickets": 0,
                "balls_bowled": 0,
                "runs_conceded": 0,
                "player_of_match": 0,
            }
    return stats


def record_match_stats(match: dict, player_stats: Dict[str, dict]) -> None:
    seen_in_match = set()
    for team_key in ("teamA", "teamB"):
        team_block = match[team_key]
        for batter in team_block["batting"]:
            player = batter["player"]
            entry = player_stats[player]
            if player not in seen_in_match:
                entry["matches"] += 1
                seen_in_match.add(player)
            if batter["balls"] > 0:
                entry["innings"] += 1
            entry["runs"] += batter["runs"]
            entry["balls"] += batter["balls"]
            entry["fours"] += batter["fours"]
            entry["sixes"] += batter["sixes"]
            if batter["dismissal"] != "not out" and batter["balls"] > 0:
                entry["outs"] += 1
            if batter["runs"] >= 50:
                entry["fifties"] += 1
            if batter["runs"] >= 100:
                entry["hundreds"] += 1
        for bowler in team_block["bowling"]:
            entry = player_stats[bowler["player"]]
            entry["wickets"] += bowler["wickets"]
            entry["balls_bowled"] += bowler["balls"]
            entry["runs_conceded"] += bowler["runs"]


def update_points_table(table: Dict[str, dict], match: dict) -> None:
    a_name = match["teamA"]["name"]
    b_name = match["teamB"]["name"]
    a_runs, _ = score_to_tuple(match["teamA"]["score"])
    b_runs, _ = score_to_tuple(match["teamB"]["score"])
    a_balls = sum(item["balls"] for item in match["teamA"]["batting"])
    b_balls = sum(item["balls"] for item in match["teamB"]["batting"])

    for team_name, runs_for, balls_faced, runs_against, balls_bowled in (
        (a_name, a_runs, a_balls, b_runs, b_balls),
        (b_name, b_runs, b_balls, a_runs, a_balls),
    ):
        row = table[team_name]
        row["played"] += 1
        row["runs_for"] += runs_for
        row["balls_faced"] += balls_faced
        row["runs_against"] += runs_against
        row["balls_bowled"] += balls_bowled

    if match["winner"] == a_name:
        table[a_name]["won"] += 1
        table[a_name]["points"] += 2
        table[b_name]["lost"] += 1
    elif match["winner"] == b_name:
        table[b_name]["won"] += 1
        table[b_name]["points"] += 2
        table[a_name]["lost"] += 1
    else:
        table[a_name]["points"] += 1
        table[b_name]["points"] += 1

    for row in table.values():
        scoring_rate = safe_div(row["runs_for"] * 6, row["balls_faced"], default=0.0)
        conceding_rate = safe_div(row["runs_against"] * 6, row["balls_bowled"], default=0.0)
        row["nrr"] = round(scoring_rate - conceding_rate, 3)


def toss_and_order(engine: SimulationEngine, home_team: dict, away_team: dict) -> Tuple[dict, dict, dict]:
    venue = home_team["venue"]
    history = engine.venue_history(venue)
    chase_bias = history.get("chase_win_rate", 0.5)
    toss_winner = home_team if engine.rng.random() < 0.5 else away_team
    if chase_bias >= 0.52:
        decision = "field"
    elif chase_bias <= 0.46:
        decision = "bat"
    else:
        decision = "field" if engine.rng.random() < 0.55 else "bat"

    home_copy = copy_team(home_team, venue)
    away_copy = copy_team(away_team, venue)

    if decision == "bat":
        batting_first = toss_winner["name"]
    else:
        batting_first = away_team["name"] if toss_winner["name"] == home_team["name"] else home_team["name"]

    if batting_first == home_team["name"]:
        return home_copy, away_copy, {"winner": toss_winner["name"], "decision": decision}
    return away_copy, home_copy, {"winner": toss_winner["name"], "decision": decision}


def enrich_match(match_number: int, fixture: Fixture, raw_match: dict, toss: dict) -> dict:
    match = dict(raw_match)
    match["match_no"] = match_number
    match["stage"] = fixture.stage
    match["venue"] = fixture.venue
    match["toss"] = toss
    return match


def season_awards(player_stats: Dict[str, dict]) -> dict:
    orange = max(player_stats.items(), key=lambda item: (item[1]["runs"], -item[1]["outs"], item[1]["balls"]))
    purple = max(player_stats.items(), key=lambda item: (item[1]["wickets"], -item[1]["runs_conceded"], item[1]["balls_bowled"]))

    striker_pool = [
        (name, stats)
        for name, stats in player_stats.items()
        if stats["balls"] >= MIN_SUPER_STRIKER_BALLS
    ]
    if striker_pool:
        super_striker = max(
            striker_pool,
            key=lambda item: (
                safe_div(item[1]["runs"] * 100, item[1]["balls"], default=0.0),
                item[1]["runs"],
            ),
        )
    else:
        super_striker = orange

    def mvp_score(stats: dict) -> float:
        strike_rate = safe_div(stats["runs"] * 100, stats["balls"], default=0.0)
        economy = safe_div(stats["runs_conceded"] * 6, stats["balls_bowled"], default=8.5)
        economy_bonus = max(0.0, 8.2 - economy) * 4.0 if stats["balls_bowled"] >= 36 else 0.0
        return (
            stats["runs"] * 1.0
            + stats["wickets"] * 24.0
            + stats["fifties"] * 8.0
            + stats["hundreds"] * 18.0
            + stats["player_of_match"] * 18.0
            + max(0.0, strike_rate - 135.0) * 0.45
            + economy_bonus
        )

    mvp = max(player_stats.items(), key=lambda item: (mvp_score(item[1]), item[1]["runs"], item[1]["wickets"]))

    return {
        "player_of_league": {
            "player": mvp[0],
            "team": mvp[1]["team"],
            "runs": mvp[1]["runs"],
            "wickets": mvp[1]["wickets"],
            "player_of_match_awards": mvp[1]["player_of_match"],
            "mvp_score": round(mvp_score(mvp[1]), 2),
        },
        "orange_cap": {
            "player": orange[0],
            "team": orange[1]["team"],
            "runs": orange[1]["runs"],
            "balls": orange[1]["balls"],
            "strike_rate": round(safe_div(orange[1]["runs"] * 100, orange[1]["balls"], default=0.0), 2),
        },
        "purple_cap": {
            "player": purple[0],
            "team": purple[1]["team"],
            "wickets": purple[1]["wickets"],
            "balls": purple[1]["balls_bowled"],
            "economy": round(safe_div(purple[1]["runs_conceded"] * 6, purple[1]["balls_bowled"], default=0.0), 2),
        },
        "super_striker": {
            "player": super_striker[0],
            "team": super_striker[1]["team"],
            "runs": super_striker[1]["runs"],
            "balls": super_striker[1]["balls"],
            "strike_rate": round(safe_div(super_striker[1]["runs"] * 100, super_striker[1]["balls"], default=0.0), 2),
        },
    }


def ordered_points_table(table: Dict[str, dict]) -> List[dict]:
    rows = sorted(
        table.values(),
        key=lambda row: (row["points"], row["nrr"], row["won"], row["runs_for"]),
        reverse=True,
    )
    output = []
    for idx, row in enumerate(rows, start=1):
        output.append(
            {
                "position": idx,
                "team": row["team"],
                "played": row["played"],
                "won": row["won"],
                "lost": row["lost"],
                "points": row["points"],
                "nrr": row["nrr"],
                "home_venue": row["home_venue"],
            }
        )
    return output


def compact_match(match: dict) -> dict:
    return {
        "match_no": match["match_no"],
        "stage": match["stage"],
        "venue": match["venue"],
        "venue_analysis": match.get("venue_analysis"),
        "toss": match["toss"],
        "teamA": {
            "name": match["teamA"]["name"],
            "score": match["teamA"]["score"],
            "batting": match["teamA"].get("batting", []),
            "bowling": match["teamA"].get("bowling", []),
        },
        "teamB": {
            "name": match["teamB"]["name"],
            "score": match["teamB"]["score"],
            "batting": match["teamB"].get("batting", []),
            "bowling": match["teamB"].get("bowling", []),
        },
        "winner": match["winner"],
        "player_of_match": match["player_of_match"],
        "key_events": match["key_events"],
        "final_report": match["final_report"],
    }


def build_final_fixture(
    league_table: List[dict],
    finalists: List[str],
    team_map: Dict[str, dict],
) -> Fixture:
    final_host = finalists[0]
    for row in league_table:
        if row["team"] in finalists:
            final_host = row["team"]
            break
    return Fixture("final", finalists[0], finalists[1], team_map[final_host]["venue"])


def simulate_fixture(
    engine: SimulationEngine,
    match_number: int,
    fixture: Fixture,
    team_map: Dict[str, dict],
    player_stats: Dict[str, dict],
    points_table: Dict[str, dict],
) -> dict:
    home_team = team_map[fixture.home_team]
    away_team = team_map[fixture.away_team]
    first_innings_team, second_innings_team, toss = toss_and_order(engine, home_team, away_team)
    raw_match = engine.simulate_match(first_innings_team, second_innings_team)
    raw_match["teamA"]["name"] = first_innings_team["name"]
    raw_match["teamB"]["name"] = second_innings_team["name"]
    match = enrich_match(match_number, fixture, raw_match, toss)
    pom = player_of_match(match)
    match["player_of_match"] = pom
    player_stats[pom["player"]]["player_of_match"] += 1
    record_match_stats(match, player_stats)
    if fixture.stage == "league":
        update_points_table(points_table, match)
    return match


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--player-data", default=str(DATA_DIR / "ipl_player_analytics.json"))
    parser.add_argument("--matchup-data", default=str(DATA_DIR / "ipl_player_matchups.json"))
    parser.add_argument("--players", default=str(DATA_DIR / "players.json"))
    parser.add_argument("--ground-history", default=str(DATA_DIR / "ipl_ground_history.json"))
    parser.add_argument("--league-teams", default=str(DATA_DIR / "league_teams.json"))
    parser.add_argument("--seed", type=int, default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    analytics = load_json(Path(args.player_data).expanduser().resolve())
    matchups = load_json(Path(args.matchup_data).expanduser().resolve())
    player_registry = load_player_registry(Path(args.players).expanduser().resolve())
    ground_history = load_json(Path(args.ground_history).expanduser().resolve())
    teams = load_teams(Path(args.league_teams).expanduser().resolve())

    rng = random.Random(args.seed)
    engine = SimulationEngine(analytics, matchups, rng, player_registry, ground_history)

    validated_teams = [engine.validate_team(team) for team in teams]
    if len(validated_teams) < 2:
        raise ValueError("league_teams.json must contain at least 2 teams")
    team_map = {team["name"]: team for team in validated_teams}
    if len(team_map) != len(validated_teams):
        raise ValueError("Team names in league_teams.json must be unique")
    player_ownership = {}
    for team in validated_teams:
        for player in team["playing11"]:
            if player in player_ownership:
                raise ValueError(
                    f"Player {player} appears in both {player_ownership[player]} and {team['name']}"
                )
            player_ownership[player] = team["name"]

    player_stats = init_player_stats(team_map)
    points_table = init_points_table(validated_teams)
    fixtures = build_fixtures(validated_teams)

    matches = []
    match_number = 1
    for fixture in fixtures:
        matches.append(simulate_fixture(engine, match_number, fixture, team_map, player_stats, points_table))
        match_number += 1

    league_table = ordered_points_table(points_table)
    semi_final_matches: List[dict] = []
    if len(validated_teams) >= 4:
        semi_1, semi_2 = build_playoff_fixtures(league_table, team_map)
        semi_final_matches = [
            simulate_fixture(engine, match_number, semi_1, team_map, player_stats, points_table),
            simulate_fixture(engine, match_number + 1, semi_2, team_map, player_stats, points_table),
        ]
        match_number += 2
        finalists = [semi_final_matches[0]["winner"], semi_final_matches[1]["winner"]]
    else:
        finalists = [league_table[0]["team"], league_table[1]["team"]]

    final_fixture = build_final_fixture(league_table, finalists, team_map)
    final_match = simulate_fixture(engine, match_number, final_fixture, team_map, player_stats, points_table)

    output = {
        "league_name": "Fantasy Premier League T20",
        "season_seed": args.seed,
        "teams": [
            {
                "name": team["name"],
                "venue": team["venue"],
                "captaincy_core": team["batting_order"][:4] + team["bowlers"][:3],
            }
            for team in validated_teams
        ],
        "league_stage_matches": [compact_match(match) for match in matches],
        "points_table": league_table,
        "playoffs": {
            "semi_finals": [compact_match(match) for match in semi_final_matches],
            "final": compact_match(final_match),
            "champion": final_match["winner"],
            "runner_up": finalists[1] if final_match["winner"] == finalists[0] else finalists[0],
        },
        "season_awards": season_awards(player_stats),
        "top_batters": [
            {
                "player": name,
                "team": stats["team"],
                "runs": stats["runs"],
                "balls": stats["balls"],
                "average": round(safe_div(stats["runs"], stats["outs"], default=float(stats["runs"])), 2),
                "strike_rate": round(safe_div(stats["runs"] * 100, stats["balls"], default=0.0), 2),
            }
            for name, stats in sorted(player_stats.items(), key=lambda item: (item[1]["runs"], -item[1]["balls"]), reverse=True)[:10]
        ],
        "top_bowlers": [
            {
                "player": name,
                "team": stats["team"],
                "wickets": stats["wickets"],
                "balls": stats["balls_bowled"],
                "economy": round(safe_div(stats["runs_conceded"] * 6, stats["balls_bowled"], default=0.0), 2),
            }
            for name, stats in sorted(player_stats.items(), key=lambda item: (item[1]["wickets"], -item[1]["runs_conceded"]), reverse=True)[:10]
        ],
    }
    print(json.dumps(output, indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()
