#!/usr/bin/env python3
"""Generate normalized player value profiles for auction and simulation use."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from statistics import mean
from typing import Dict, List, Tuple

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def load_json(path: Path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def safe_div(numerator: float, denominator: float, default: float = 0.0) -> float:
    if denominator == 0:
        return default
    return numerator / denominator


def normalize_map(values: Dict[str, float]) -> Dict[str, float]:
    if not values:
        return {}
    low = min(values.values())
    high = max(values.values())
    if high == low:
        return {key: 50.0 for key in values}
    return {key: ((value - low) / (high - low)) * 100.0 for key, value in values.items()}


def apply_confidence(value: float, confidence: float, neutral: float) -> float:
    return (value * confidence) + (neutral * (1.0 - confidence))


def player_registry(players_path: Path) -> Dict[str, dict]:
    players = load_json(players_path)
    return {player["fullName"]: player for player in players if player.get("fullName")}


def batting_profile(analytics: dict, player: str) -> dict:
    if player in analytics.get("all_rounders", {}):
        return analytics["all_rounders"][player].get("batting", {})
    return analytics.get("batsmen", {}).get(player, {})


def bowling_profile(analytics: dict, player: str) -> dict:
    if player in analytics.get("all_rounders", {}):
        return analytics["all_rounders"][player].get("bowling", {})
    return analytics.get("bowlers", {}).get(player, {})


def fielding_profile(analytics: dict, player: str) -> dict:
    if player in analytics.get("all_rounders", {}):
        return analytics["all_rounders"][player].get("fielding", {})
    return analytics.get("fielders", {}).get(player, {})


def union_players(analytics: dict) -> List[str]:
    names = set(analytics.get("batsmen", {}))
    names.update(analytics.get("bowlers", {}))
    names.update(analytics.get("all_rounders", {}))
    return sorted(names)


def inferred_role(analytics: dict, players: Dict[str, dict], player: str) -> str:
    if player in analytics.get("all_rounders", {}):
        return "All-Rounder"
    if player in analytics.get("bowlers", {}):
        return "Bowler"
    if player in analytics.get("batsmen", {}):
        role = analytics["batsmen"][player].get("role")
        if role:
            return role
    return players.get(player, {}).get("role", "Unknown")


def role_bucket(role: str) -> str:
    role_lower = role.lower()
    if "all-rounder" in role_lower:
        return "all_rounder"
    if "bowler" in role_lower:
        return "bowler"
    return "batter"


def batting_position_factors(profile: dict) -> Tuple[Dict[str, float], str]:
    by_position = profile.get("by_batting_position", {})
    if not by_position:
        return {}, "unknown"
    best_position, best_runs = max(by_position.items(), key=lambda item: item[1])
    if best_runs <= 0:
        return {}, best_position
    factors = {
        position: round(clamp(0.5 + (safe_div(runs, best_runs, default=0.0) * 0.5), 0.5, 1.5), 3)
        for position, runs in by_position.items()
    }
    return factors, best_position


def apply_confidence_to_factor_map(values: Dict[str, float], confidence: float) -> Dict[str, float]:
    return {
        key: round(clamp(apply_confidence(value, confidence, 1.0), 0.5, 1.5), 3)
        for key, value in values.items()
    }


def style_strength(profile: dict) -> Dict[str, float]:
    vs_fast = float(profile.get("vs_fast", 0.0) or 0.0)
    vs_spin = float(profile.get("vs_spin", 0.0) or 0.0)
    total = vs_fast + vs_spin
    if total <= 0:
        return {"fast": 1.0, "spin": 1.0}
    fast_ratio = safe_div(vs_fast, total, default=0.5)
    spin_ratio = safe_div(vs_spin, total, default=0.5)
    return {
        "fast": round(clamp(0.7 + (fast_ratio * 0.6), 0.5, 1.5), 3),
        "spin": round(clamp(0.7 + (spin_ratio * 0.6), 0.5, 1.5), 3),
    }


def ground_factors(profile: dict) -> Dict[str, float]:
    by_ground = profile.get("by_ground", {})
    if not by_ground:
        return {}
    avg_runs = mean(by_ground.values())
    if avg_runs <= 0:
        return {}
    return {
        ground: round(clamp(safe_div(runs, avg_runs, default=1.0), 0.8, 1.2), 3)
        for ground, runs in by_ground.items()
    }


def phase_strength(profile: dict) -> Tuple[Dict[str, float], List[str]]:
    wickets_by_phase = profile.get("wickets_by_phase", {})
    total = sum(wickets_by_phase.values())
    if total <= 0:
        return {"powerplay": 1.0, "middle": 1.0, "death": 1.0}, []
    powerplay_ratio = safe_div(wickets_by_phase.get("powerplay", 0), total, default=0.0)
    middle_ratio = safe_div(wickets_by_phase.get("middle_overs", 0), total, default=0.0)
    death_ratio = safe_div(wickets_by_phase.get("death_overs", 0), total, default=0.0)
    tags = []
    if death_ratio > 0.5:
        tags.append("death_specialist")
    if powerplay_ratio > 0.4:
        tags.append("powerplay_bowler")
    return (
        {
            "powerplay": round(clamp(0.7 + (powerplay_ratio * 0.6), 0.5, 1.5), 3),
            "middle": round(clamp(0.7 + (middle_ratio * 0.6), 0.5, 1.5), 3),
            "death": round(clamp(0.7 + (death_ratio * 0.6), 0.5, 1.5), 3),
        },
        tags,
    )


def bowling_phase_strength(profile: dict) -> Dict[str, float]:
    strength, _ = phase_strength(profile)
    middle = strength.get("middle", 1.0)
    if not isinstance(middle, float):
        strength["middle"] = 1.0
    return strength


def matchup_factor_from_batter_payload(payload: dict) -> Tuple[float, float]:
    runs = payload.get("runs", 0)
    outs = payload.get("outs", 0)
    balls_faced = max(runs + (outs * 6), len(payload.get("dismissal_events", [])) * 6, 1)
    matchup_score = safe_div(runs, outs + 1, default=0.0)
    confidence = min(1.0, balls_faced / 30.0)
    factor = ((matchup_score / 20.0) * confidence) + (0.5 * (1 - confidence))
    return clamp(factor, 0.5, 1.5), confidence


def matchup_factor_from_bowler_payload(payload: dict) -> Tuple[float, float]:
    runs_conceded = payload.get("runs_conceded", 0)
    wickets = payload.get("wickets", 0)
    balls_seen = max(runs_conceded + (wickets * 6), len(payload.get("dismissal_events", [])) * 6, 1)
    matchup_score = safe_div((wickets * 20.0), runs_conceded + 1, default=0.0)
    confidence = min(1.0, balls_seen / 30.0)
    factor = ((matchup_score / 20.0) * confidence) + (0.5 * (1 - confidence))
    return clamp(factor, 0.5, 1.5), confidence


def batting_bowling_style_tag(players: Dict[str, dict], player: str, role: str) -> List[str]:
    if role_bucket(role) == "batter":
        return []
    style = str(players.get(player, {}).get("bowlingStyle", "")).lower()
    tags = []
    if any(token in style for token in ["fast", "medium", "seam"]):
        tags.append("pace")
    if any(token in style for token in ["offbreak", "legbreak", "orthodox", "chinaman", "spin", "slow left-arm"]):
        tags.append("spinner")
    return tags


def dedupe(items: List[str]) -> List[str]:
    seen = set()
    output = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            output.append(item)
    return output


def compress_matchup_index(value: float) -> float:
    return clamp(1.0 + ((value - 1.0) * 0.35), 0.85, 1.15)


def generate_profiles(analytics: dict, matchups: dict, players: Dict[str, dict]) -> Tuple[dict, dict]:
    player_names = union_players(analytics)
    batting_runs_pm = {}
    batting_consistency = {}
    batting_peak = {}
    bowling_wickets_pm = {}
    bowling_economy_proxy = {}
    bowling_strike_proxy = {}
    fielding_raw = {}

    raw = {}
    for player in player_names:
        bat = batting_profile(analytics, player)
        bowl = bowling_profile(analytics, player)
        field = fielding_profile(analytics, player)
        batting_matches = float(bat.get("matches", 0) or 0.0)
        bowling_matches = float(bowl.get("matches", 0) or 0.0)
        experience_matches = max(batting_matches, bowling_matches)
        confidence = min(1.0, safe_div(experience_matches, 50.0, default=0.0))

        runs_per_match = safe_div(bat.get("total_runs", 0), bat.get("matches", 0), default=0.0)
        best_score = float(bat.get("best_score", 0) or 0.0)
        consistency_proxy = safe_div(bat.get("total_runs", 0), max(best_score, 1.0), default=0.0)
        wickets_per_match = safe_div(bowl.get("total_wickets", 0), bowl.get("matches", 0), default=0.0)
        best_bowling = bowl.get("best_bowling", {}) or {}
        economy_proxy = safe_div(best_bowling.get("wickets", 0), max(best_bowling.get("runs_conceded", 0), 1), default=0.0)
        strike_proxy = safe_div(bowl.get("total_wickets", 0), max(bowl.get("balls_bowled", 0), 1), default=0.0)
        fielding_points = float(field.get("catches", 0) or 0) + (float(field.get("stumpings", 0) or 0) * 2.0)

        batting_runs_pm[player] = runs_per_match
        batting_consistency[player] = consistency_proxy
        batting_peak[player] = best_score
        bowling_wickets_pm[player] = wickets_per_match
        bowling_economy_proxy[player] = economy_proxy
        bowling_strike_proxy[player] = strike_proxy
        fielding_raw[player] = fielding_points

        raw[player] = {
            "runs_per_match": runs_per_match,
            "consistency_proxy": consistency_proxy,
            "strike_proxy": best_score,
            "wickets_per_match": wickets_per_match,
            "economy_proxy": economy_proxy,
            "strike_rate_proxy": strike_proxy,
            "fielding_raw": fielding_points,
            "role": inferred_role(analytics, players, player),
            "batting_profile": bat,
            "bowling_profile": bowl,
            "confidence": confidence,
            "batting_matches": batting_matches,
            "bowling_matches": bowling_matches,
        }

    norm_runs_pm = normalize_map(batting_runs_pm)
    norm_consistency = normalize_map(batting_consistency)
    norm_batting_peak = normalize_map(batting_peak)
    norm_wickets_pm = normalize_map(bowling_wickets_pm)
    norm_economy = normalize_map(bowling_economy_proxy)
    norm_bowling_strike = normalize_map(bowling_strike_proxy)
    norm_fielding = normalize_map(fielding_raw)

    batter_matchup_summary = {}
    batter_matchup_factors = {"metadata": {"formula": "((runs/(outs+1))/20)*confidence + 0.5*(1-confidence)"}, "batters": {}}
    for batter, bowlers in matchups.get("batters", {}).items():
        factors = {}
        weighted_values = []
        for bowler, payload in bowlers.items():
            factor, confidence = matchup_factor_from_batter_payload(payload)
            factors[bowler] = {
                "factor": round(factor, 3),
                "confidence": round(confidence, 3),
                "runs": payload.get("runs", 0),
                "outs": payload.get("outs", 0),
            }
            weighted_values.append((factor, confidence))
        if factors:
            batter_matchup_factors["batters"][batter] = factors
            batter_matchup_summary[batter] = safe_div(
                sum(factor * max(confidence, 0.2) for factor, confidence in weighted_values),
                sum(max(confidence, 0.2) for _, confidence in weighted_values),
                default=1.0,
            )

    bowler_matchup_summary = {}
    for bowler, batters in matchups.get("bowlers", {}).items():
        weighted_values = []
        for _, payload in batters.items():
            factor, confidence = matchup_factor_from_bowler_payload(payload)
            weighted_values.append((factor, confidence))
        if weighted_values:
            bowler_matchup_summary[bowler] = safe_div(
                sum(factor * max(confidence, 0.2) for factor, confidence in weighted_values),
                sum(max(confidence, 0.2) for _, confidence in weighted_values),
                default=1.0,
            )

    profiles = {}
    auction_raw = {}
    for player in player_names:
        role = raw[player]["role"]
        bat_profile = raw[player]["batting_profile"]
        bowl_profile = raw[player]["bowling_profile"]
        confidence = raw[player]["confidence"]
        batting_confidence = min(1.0, safe_div(raw[player]["batting_matches"], 50.0, default=0.0))
        bowling_confidence = min(1.0, safe_div(raw[player]["bowling_matches"], 50.0, default=0.0))

        batting_score_raw = (
            (norm_runs_pm[player] * 0.5)
            + (norm_consistency[player] * 0.3)
            + (norm_batting_peak[player] * 0.2)
        )
        bowling_score_raw = (
            (norm_wickets_pm[player] * 0.5)
            + (norm_economy[player] * 0.3)
            + (norm_bowling_strike[player] * 0.2)
        )
        batting_score = 0.0
        if raw[player]["batting_matches"] > 0:
            batting_score = apply_confidence(batting_score_raw, batting_confidence, 35.0)
        bowling_score = 0.0
        if raw[player]["bowling_matches"] > 0:
            bowling_score = apply_confidence(bowling_score_raw, bowling_confidence, 30.0)
        fielding_bonus = 0.0
        if experience_matches := max(raw[player]["batting_matches"], raw[player]["bowling_matches"]):
            fielding_bonus = apply_confidence(norm_fielding[player] * 0.1, min(1.0, experience_matches / 50.0), 1.0)
        base_rating_raw = batting_score + bowling_score + fielding_bonus
        base_rating = clamp(apply_confidence(base_rating_raw, confidence, 50.0), 0.0, 100.0)

        positions, best_position = batting_position_factors(bat_profile)
        if positions:
            positions = {
                key: round(clamp(apply_confidence(value, batting_confidence, 1.0), 0.5, 1.5), 3)
                for key, value in positions.items()
            }
        styles = apply_confidence_to_factor_map(style_strength(bat_profile), batting_confidence)
        grounds = ground_factors(bat_profile or bowl_profile)
        phases = apply_confidence_to_factor_map(bowling_phase_strength(bowl_profile), bowling_confidence)
        phase_tags = []
        wickets_by_phase = bowl_profile.get("wickets_by_phase", {})
        phase_total = sum(wickets_by_phase.values())
        if phase_total > 0:
            if safe_div(wickets_by_phase.get("death_overs", 0), phase_total, default=0.0) > 0.5:
                phase_tags.append("death_bowler")
            if safe_div(wickets_by_phase.get("powerplay", 0), phase_total, default=0.0) > 0.4:
                phase_tags.append("powerplay_bowler")

        matchup_index = batter_matchup_summary.get(player)
        if matchup_index is None:
            matchup_index = bowler_matchup_summary.get(player, 1.0)
        matchup_index = round(clamp(apply_confidence(compress_matchup_index(matchup_index), confidence, 1.0), 0.85, 1.15), 3)

        inherited_tags = players.get(player, {}).get("skillTags", [])
        derived_tags = list(inherited_tags) + batting_bowling_style_tag(players, player, role) + phase_tags
        if positions:
            if best_position in {"opening", "1_down"} and norm_consistency[player] >= 45:
                derived_tags.append("anchor")
            if best_position not in {"opening", "1_down"} and norm_batting_peak[player] >= 50:
                derived_tags.append("finisher")
        if max(styles.values()) >= 1.05 and norm_batting_peak[player] >= 45:
            derived_tags.append("power_hitter")
        tags = dedupe(derived_tags)

        best_position_factor = max(positions.values(), default=1.0)
        best_style_factor = max(styles.values(), default=1.0)
        best_phase_factor = max(phases.values(), default=1.0)
        neutral_team_factor = 1.0
        auction_raw[player] = (
            base_rating
            * clamp(best_position_factor, 0.5, 1.5)
            * clamp(best_style_factor, 0.5, 1.5)
            * clamp(best_phase_factor, 0.5, 1.5)
            * clamp(matchup_index, 0.5, 1.5)
            * neutral_team_factor
        )

        profiles[player] = {
            "player": player,
            "role": role,
            "base_rating": round(base_rating, 2),
            "confidence": round(confidence, 3),
            "component_scores": {
                "batting_score": round(batting_score, 2),
                "bowling_score": round(bowling_score, 2),
                "fielding_bonus": round(fielding_bonus, 2),
            },
            "positions": positions,
            "best_position": best_position,
            "style_strength": styles,
            "phase_strength": phases,
            "tags": tags,
        }

    normalized_auction = normalize_map(auction_raw)
    role_group_raw = {"batter": {}, "all_rounder": {}, "bowler": {}}
    for player, profile in profiles.items():
        role_group_raw[role_bucket(profile["role"])][player] = auction_raw[player]
    role_group_normalized = {
        bucket: normalize_map(values) for bucket, values in role_group_raw.items()
    }
    for player, profile in profiles.items():
        bucket = role_bucket(profile["role"])
        role_adjusted = role_group_normalized.get(bucket, {}).get(player, normalized_auction[player])
        final_value = (normalized_auction[player] * 0.35) + (role_adjusted * 0.65)
        profile["auction_rating"] = round(final_value, 2)
        profile["final_player_value"] = round(final_value, 2)

    output = {
        "metadata": {
            "scale": "0-100",
            "notes": [
                "Raw batting and bowling inputs are normalized before combining.",
                "Confidence weighting pulls low-sample players back toward neutral values.",
                "Bowling economy uses best_bowling runs conceded as a proxy because full career runs-conceded is not present in the source analytics.",
                "All modifiers are clamped to keep values in a fair strategic range.",
            ],
        },
        "players": profiles,
    }
    return output, batter_matchup_factors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--analytics", default=str(DATA_DIR / "ipl_player_analytics.json"))
    parser.add_argument("--matchups", default=str(DATA_DIR / "ipl_player_matchups.json"))
    parser.add_argument("--players", default=str(DATA_DIR / "players.json"))
    parser.add_argument("--output-dir", default=str(DATA_DIR / "derived_player_value_data"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    analytics = load_json(Path(args.analytics).expanduser().resolve())
    matchups = load_json(Path(args.matchups).expanduser().resolve())
    players = player_registry(Path(args.players).expanduser().resolve())

    profiles, matchup_factors = generate_profiles(analytics, matchups, players)

    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    with (output_dir / "player_value_profiles.json").open("w", encoding="utf-8") as handle:
        json.dump(profiles, handle, indent=2, ensure_ascii=True)

    with (output_dir / "matchup_factors.json").open("w", encoding="utf-8") as handle:
        json.dump(matchup_factors, handle, indent=2, ensure_ascii=True)

    print(json.dumps({
        "output_dir": str(output_dir),
        "player_profiles": str(output_dir / "player_value_profiles.json"),
        "matchup_factors": str(output_dir / "matchup_factors.json"),
        "players_generated": len(profiles.get("players", {})),
    }, indent=2))


if __name__ == "__main__":
    main()
