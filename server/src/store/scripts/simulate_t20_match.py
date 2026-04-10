#!/usr/bin/env python3
"""Simulate a T20 match and return a full scorecard JSON."""

from __future__ import annotations

import argparse
import json
import random
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

MAX_OVERS = 20
BALLS_PER_OVER = 6
MAX_WICKETS = 10


@dataclass
class BatterState:
    name: str
    runs: int = 0
    balls: int = 0
    fours: int = 0
    sixes: int = 0
    out: bool = False
    dismissal: str = "not out"


@dataclass
class BowlerState:
    name: str
    balls: int = 0
    runs: int = 0
    wickets: int = 0


@dataclass
class InningsState:
    batting_team: dict
    bowling_team: dict
    venue: str
    total_runs: int = 0
    wickets: int = 0
    total_balls_bowled: int = 0
    batters: Dict[str, BatterState] = field(default_factory=dict)
    bowlers: Dict[str, BowlerState] = field(default_factory=dict)
    key_events: List[str] = field(default_factory=list)
    phase_notes: List[str] = field(default_factory=list)
    partnerships: List[int] = field(default_factory=list)
    recent_outcomes: List[str] = field(default_factory=list)
    collapse_runs_window: int = 0
    collapse_wickets_window: int = 0
    max_required_rate: float = 0.0


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_player_registry(path: Path) -> Dict[str, dict]:
    raw_players = load_json(path)
    registry = {}
    for player in raw_players:
        full_name = str(player.get("fullName", "")).strip()
        if full_name:
            registry[full_name] = player
    return registry


def safe_div(numerator: float, denominator: float, default: float = 0.0) -> float:
    if denominator == 0:
        return default
    return numerator / denominator


class SimulationEngine:
    def __init__(
        self,
        analytics: dict,
        matchups: dict,
        rng: random.Random,
        player_registry: Optional[Dict[str, dict]] = None,
        ground_history: Optional[dict] = None,
    ):
        self.analytics = analytics
        self.matchups = matchups
        self.rng = rng
        self.player_registry = player_registry or {}
        self.ground_history = ground_history or {}

    def batting_profile(self, player: str) -> dict:
        if player in self.analytics.get("all_rounders", {}):
            return self.analytics["all_rounders"][player].get("batting", {})
        return self.analytics.get("batsmen", {}).get(player, {})

    def bowling_profile(self, player: str) -> dict:
        if player in self.analytics.get("all_rounders", {}):
            return self.analytics["all_rounders"][player].get("bowling", {})
        return self.analytics.get("bowlers", {}).get(player, {})

    def fielding_profile(self, player: str) -> dict:
        return self.analytics.get("fielders", {}).get(player, {})

    def role(self, player: str) -> str:
        if player in self.analytics.get("all_rounders", {}):
            return self.analytics["all_rounders"][player].get("role", "Unknown")
        if player in self.analytics.get("batsmen", {}):
            return self.analytics["batsmen"][player].get("role", "Unknown")
        if player in self.analytics.get("bowlers", {}):
            return self.analytics["bowlers"][player].get("role", "Unknown")
        return "Unknown"

    def player_meta(self, player: str) -> dict:
        return self.player_registry.get(player, {})

    def is_overseas(self, player: str) -> bool:
        nationality = str(self.player_meta(player).get("nationality", "")).strip().lower()
        return bool(nationality) and nationality != "india"

    def is_wicketkeeper(self, player: str) -> bool:
        return "wicketkeeper" in self.role(player).lower()

    def is_all_rounder(self, player: str) -> bool:
        return "all-rounder" in self.role(player).lower()

    def is_bowling_option(self, player: str) -> bool:
        role = self.role(player).lower()
        return "bowler" in role or "all-rounder" in role

    def role_bucket(self, player: str) -> str:
        if self.is_wicketkeeper(player):
            return "wicketkeeper"
        if self.is_all_rounder(player):
            return "all_rounder"
        if self.is_bowling_option(player):
            return "bowler"
        return "batter"

    def validate_team(self, team: dict) -> dict:
        playing11 = list(dict.fromkeys(team.get("playing11", [])))[:11]
        playing_set = set(playing11)

        supplied_batting_order = list(dict.fromkeys(team.get("batting_order", [])))
        invalid_batting_order = [player for player in supplied_batting_order if player not in playing_set]
        missing_batting_order = [player for player in playing11 if player not in supplied_batting_order]
        if invalid_batting_order or missing_batting_order:
            raise ValueError(
                f"Invalid team {team.get('name', 'Team')}: batting_order mismatch; "
                f"not_in_playing11={invalid_batting_order}, missing_from_order={missing_batting_order}"
            )
        batting_order = supplied_batting_order

        declared_bowlers = [player for player in team.get("bowlers", []) if player in playing_set]
        if not declared_bowlers:
            declared_bowlers = [
                player
                for player in playing11
                if "bowler" in self.role(player).lower() or "all-rounder" in self.role(player).lower()
            ]
        declared_bowlers = list(dict.fromkeys(declared_bowlers))[:6]
        if len(declared_bowlers) < 5:
            for player in playing11:
                if player not in declared_bowlers:
                    declared_bowlers.append(player)
                if len(declared_bowlers) == 5:
                    break

        overseas_count = sum(1 for player in playing11 if self.is_overseas(player))
        wicketkeepers = sum(1 for player in playing11 if self.is_wicketkeeper(player))
        bowling_options = sum(1 for player in playing11 if self.is_bowling_option(player))
        all_rounders = sum(1 for player in playing11 if self.is_all_rounder(player))

        if overseas_count > 4:
            raise ValueError(f"Invalid team {team.get('name', 'Team')}: more than 4 overseas players")
        if wicketkeepers < 1:
            raise ValueError(f"Invalid team {team.get('name', 'Team')}: missing wicketkeeper")
        if bowling_options < 3:
            raise ValueError(f"Invalid team {team.get('name', 'Team')}: fewer than 3 bowling options")
        if all_rounders < 1:
            raise ValueError(f"Invalid team {team.get('name', 'Team')}: missing all-rounder")

        return {
            "name": team.get("name", "Team"),
            "venue": team.get("venue"),
            "playing11": playing11,
            "batting_order": batting_order,
            "bowlers": declared_bowlers,
        }

    def matchup_factor(self, batter: str, bowler: str) -> float:
        payload = self.matchups.get("batters", {}).get(batter, {}).get(bowler)
        if not payload:
            return 0.5
        matchup_score = safe_div(payload.get("runs", 0), payload.get("outs", 0) + 1, default=10.0)
        estimated_balls_faced = max(
            payload.get("runs", 0) + (payload.get("outs", 0) * 6),
            len(payload.get("dismissal_events", [])) * 6,
            1,
        )
        confidence = min(1.0, estimated_balls_faced / 30.0)
        value = ((matchup_score / 20.0) * confidence) + (0.5 * (1 - confidence))
        return min(max(value, 0.1), 1.0)

    def batting_position_number(self, batting_index: int) -> int:
        return batting_index + 1

    def batting_position_label(self, batting_index: int) -> str:
        position_number = self.batting_position_number(batting_index)
        if position_number in (1, 2):
            return "opening"
        return f"{position_number - 2}_down"

    def bowling_style(self, bowler: str) -> str:
        return str(self.bowling_profile(bowler).get("bowling_type", "unknown")).lower()

    def batting_tier(self, batting_index: int) -> str:
        if batting_index <= 3:
            return "top"
        if batting_index <= 6:
            return "middle"
        return "tail"

    def handedness(self, player: str) -> str:
        batting_style = str(
            self.batting_profile(player).get("batting_style")
            or self.bowling_profile(player).get("batting_style")
            or ""
        ).lower()
        if "left" in batting_style:
            return "left"
        if "right" in batting_style:
            return "right"
        return "unknown"

    def normalize_ground_name(self, ground: str) -> str:
        normalized = re.sub(r"[^a-z0-9 ]+", " ", str(ground).lower())
        normalized = re.sub(r"\s+", " ", normalized).strip()
        replacements = {
            "dr ": "doctor ",
            "dr ": "doctor ",
            "dy ": "d y ",
            "aca vdca": "aca vdca",
        }
        for source, target in replacements.items():
            normalized = normalized.replace(source, target)
        return normalized

    def ground_stat_value(self, by_ground: dict, venue: str) -> Optional[float]:
        if not by_ground or not venue:
            return None
        if venue in by_ground:
            return float(by_ground[venue])

        target = self.normalize_ground_name(venue)
        matched_values = []
        target_tokens = set(target.split())
        for ground, value in by_ground.items():
            normalized = self.normalize_ground_name(ground)
            if normalized == target:
                matched_values.append(float(value))
                continue
            ground_tokens = set(normalized.split())
            overlap = len(target_tokens & ground_tokens)
            if overlap >= max(2, min(len(target_tokens), len(ground_tokens)) - 1):
                matched_values.append(float(value))
        if not matched_values:
            return None
        return sum(matched_values)

    def venue_history(self, venue: str) -> dict:
        grounds = self.ground_history.get("grounds", {})
        if venue in grounds:
            return grounds[venue]
        target = self.normalize_ground_name(venue)
        merged = []
        target_tokens = set(target.split())
        for ground_name, payload in grounds.items():
            normalized = self.normalize_ground_name(ground_name)
            if normalized == target:
                merged.append(payload)
                continue
            ground_tokens = set(normalized.split())
            overlap = len(target_tokens & ground_tokens)
            if overlap >= max(2, min(len(target_tokens), len(ground_tokens)) - 1):
                merged.append(payload)
        if not merged:
            return {}
        matches = sum(item.get("matches", 0) for item in merged)
        if matches <= 0:
            return {}
        return {
            "matches": matches,
            "avg_first_innings_runs": safe_div(
                sum(item.get("avg_first_innings_runs", 0.0) * item.get("matches", 0) for item in merged),
                matches,
                default=165.0,
            ),
            "avg_second_innings_runs": safe_div(
                sum(item.get("avg_second_innings_runs", 0.0) * item.get("matches", 0) for item in merged),
                matches,
                default=155.0,
            ),
            "avg_total_wickets": safe_div(
                sum(item.get("avg_total_wickets", 0.0) * item.get("matches", 0) for item in merged),
                matches,
                default=12.0,
            ),
            "chase_win_rate": safe_div(
                sum(item.get("chase_win_rate", 0.0) * item.get("matches", 0) for item in merged),
                matches,
                default=0.5,
            ),
            "pitch": max(
                (item.get("pitch", "balanced") for item in merged),
                key=lambda pitch: sum(1 for item in merged if item.get("pitch") == pitch),
            ),
        }

    def venue_pitch_factors(self, venue: str, innings_number: int) -> Tuple[float, float]:
        history = self.venue_history(venue)
        if not history:
            return 1.0, 1.0
        batting_factor = 1.0
        bowling_factor = 1.0
        pitch = history.get("pitch", "balanced")
        if pitch == "batting_friendly":
            batting_factor *= 1.08
            bowling_factor *= 0.94
        elif pitch == "bowling_friendly":
            batting_factor *= 0.94
            bowling_factor *= 1.08
        elif pitch == "chasing_friendly" and innings_number == 2:
            batting_factor *= 1.05
        elif pitch == "defending_friendly" and innings_number == 2:
            batting_factor *= 0.95
            bowling_factor *= 1.05

        avg_first = history.get("avg_first_innings_runs", 165.0)
        avg_second = history.get("avg_second_innings_runs", 155.0)
        wickets = history.get("avg_total_wickets", 12.0)
        if innings_number == 1:
            batting_factor *= max(0.94, min(1.08, avg_first / 170.0))
        else:
            batting_factor *= max(0.94, min(1.08, avg_second / 165.0))
            chase_rate = history.get("chase_win_rate", 0.5)
            batting_factor *= max(0.95, min(1.06, 0.94 + (chase_rate * 0.18)))
        bowling_factor *= max(0.94, min(1.08, wickets / 12.0))
        return batting_factor, bowling_factor

    def venue_outcome_factors(self, venue: str, innings_number: int) -> Dict[str, float]:
        history = self.venue_history(venue)
        if not history:
            return {
                "dot": 1.0,
                "single": 1.0,
                "boundary": 1.0,
                "six": 1.0,
                "wicket": 1.0,
            }

        pitch = history.get("pitch", "balanced")
        avg_first = history.get("avg_first_innings_runs", 165.0)
        avg_second = history.get("avg_second_innings_runs", 155.0)
        chase_rate = history.get("chase_win_rate", 0.5)
        wickets = history.get("avg_total_wickets", 12.0)

        factors = {
            "dot": 1.0,
            "single": 1.0,
            "boundary": 1.0,
            "six": 1.0,
            "wicket": 1.0,
        }

        if pitch == "batting_friendly":
            factors["boundary"] *= 1.15
            factors["six"] *= 1.18
            factors["wicket"] *= 0.90
            factors["dot"] *= 0.94
        elif pitch == "bowling_friendly":
            factors["boundary"] *= 0.90
            factors["six"] *= 0.88
            factors["wicket"] *= 1.12
            factors["dot"] *= 1.08
        elif pitch == "chasing_friendly" and innings_number == 2:
            factors["boundary"] *= 1.08
            factors["single"] *= 1.05
            factors["wicket"] *= 0.94
        elif pitch == "defending_friendly" and innings_number == 2:
            factors["boundary"] *= 0.92
            factors["single"] *= 0.97
            factors["wicket"] *= 1.08

        scoring_ratio = (avg_second / 160.0) if innings_number == 2 else (avg_first / 168.0)
        factors["boundary"] *= max(0.88, min(1.16, scoring_ratio))
        factors["six"] *= max(0.86, min(1.18, scoring_ratio))
        factors["dot"] *= max(0.90, min(1.10, wickets / 12.0))
        factors["wicket"] *= max(0.90, min(1.12, wickets / 12.0))

        if innings_number == 2:
            factors["single"] *= max(0.95, min(1.08, 0.92 + chase_rate * 0.20))

        return factors

    def position_factor(self, batter: str, batting_index: int) -> float:
        profile = self.batting_profile(batter)
        by_position = profile.get("by_batting_position", {})
        if not by_position:
            return 0.75
        ideal_runs = max(by_position.values(), default=0)
        if ideal_runs <= 0:
            return 0.75
        selected_runs = by_position.get(self.batting_position_label(batting_index), 0)
        efficiency = safe_div(selected_runs, ideal_runs, default=0.0)
        total_position_runs = sum(by_position.values())
        share = safe_div(selected_runs, total_position_runs, default=0.0)
        factor = 0.35 + (efficiency * 0.45) + (share * 0.80)
        return max(0.35, min(1.15, factor))

    def base_batting_strength(self, batter: str) -> float:
        profile = self.batting_profile(batter)
        matches = profile.get("matches", 0)
        total_runs = profile.get("total_runs", 0)
        best_score = profile.get("best_score", 0)
        runs_per_match = safe_div(total_runs, matches, default=18.0)
        return max(0.55, 0.78 + min(runs_per_match / 35.0, 0.95) + min(best_score / 175.0, 0.22))

    def base_bowling_strength(self, bowler: str) -> float:
        profile = self.bowling_profile(bowler)
        matches = profile.get("matches", 0)
        wickets = profile.get("total_wickets", 0)
        balls = profile.get("balls_bowled", 0)
        wickets_per_match = safe_div(wickets, matches, default=0.6)
        wickets_per_ball = safe_div(wickets, balls, default=0.02)
        return max(0.5, 0.75 + min(wickets_per_match / 1.8, 0.8) + min(wickets_per_ball * 10.0, 0.35))

    def player_base_strength(self, player: str) -> float:
        bucket = self.role_bucket(player)
        batting = self.base_batting_strength(player)
        bowling = self.base_bowling_strength(player)
        if bucket == "all_rounder":
            return (batting * 0.55) + (bowling * 0.60)
        if bucket == "bowler":
            return bowling
        if bucket == "wicketkeeper":
            return batting * 1.02
        return batting

    def phase_ratios(self, bowler: str) -> Dict[str, float]:
        profile = self.bowling_profile(bowler)
        wickets_by_phase = profile.get("wickets_by_phase", {})
        total_wickets = sum(wickets_by_phase.values())
        if total_wickets <= 0:
            bowling_type = self.bowling_style(bowler)
            if bowling_type == "fast":
                return {"powerplay": 0.35, "middle": 0.25, "death": 0.40}
            if bowling_type == "spin":
                return {"powerplay": 0.10, "middle": 0.65, "death": 0.25}
            return {"powerplay": 0.25, "middle": 0.50, "death": 0.25}
        return {
            "powerplay": safe_div(wickets_by_phase.get("powerplay", 0), total_wickets, default=0.0),
            "middle": safe_div(wickets_by_phase.get("middle_overs", 0), total_wickets, default=0.0),
            "death": safe_div(wickets_by_phase.get("death_overs", 0), total_wickets, default=0.0),
        }

    def phase_importance_factor(self, player: str) -> float:
        if not self.is_bowling_option(player):
            return 1.0
        ratios = self.phase_ratios(player)
        if ratios["death"] >= 0.40:
            return 1.20
        if ratios["powerplay"] >= 0.35:
            return 1.10
        return 1.05

    def role_need_factor(self, player: str, team: dict) -> float:
        playing11 = team.get("playing11", [])
        bucket = self.role_bucket(player)
        keepers = sum(1 for name in playing11 if self.is_wicketkeeper(name))
        bowlers = sum(1 for name in playing11 if self.is_bowling_option(name))
        all_rounders = sum(1 for name in playing11 if self.is_all_rounder(name))
        if bucket == "wicketkeeper":
            return 1.18 if keepers < 1 else 1.0
        if bucket == "all_rounder":
            return 1.12 if all_rounders < 2 else 1.02
        if bucket == "bowler":
            return 1.15 if bowlers < 5 else 1.03
        return 1.0

    def scarcity_factor(self, player: str) -> float:
        bucket = self.role_bucket(player)
        counts = {
            "wicketkeeper": len(self.analytics.get("fielders", {})),
            "all_rounder": len(self.analytics.get("all_rounders", {})),
            "bowler": len(self.analytics.get("bowlers", {})),
            "batter": len(self.analytics.get("batsmen", {})),
        }
        pool = counts.get(bucket, 200)
        return max(1.0, min(1.15, 1.18 - min(pool, 250) / 900.0))

    def condition_factor(self, player: str, venue: str) -> float:
        if self.is_bowling_option(player):
            return self.ground_factor(player, venue, "bowling")
        return self.ground_factor(player, venue, "batting")

    def team_fit_factor(self, player: str, team: dict, venue: str) -> float:
        factor = 1.0
        if self.is_overseas(player):
            overseas = sum(1 for name in team.get("playing11", []) if self.is_overseas(name))
            if overseas >= 4:
                factor *= 0.92
        if self.is_bowling_option(player):
            ratios = self.phase_ratios(player)
            team_ratios = self.team_phase_coverage(team)
            if team_ratios["death"] < 0.32 and ratios["death"] >= 0.38:
                factor *= 1.12
            elif team_ratios["powerplay"] < 0.28 and ratios["powerplay"] >= 0.32:
                factor *= 1.08
            elif team_ratios["middle"] < 0.45 and ratios["middle"] >= 0.45:
                factor *= 1.05
        factor *= self.condition_factor(player, venue)
        return max(0.90, min(1.20, factor))

    def player_value(self, player: str, team: dict, venue: str) -> float:
        base_rating = self.player_base_strength(player)
        return (
            base_rating
            * self.role_need_factor(player, team)
            * self.team_fit_factor(player, team, venue)
            * self.scarcity_factor(player)
            * self.condition_factor(player, venue)
            * self.phase_importance_factor(player)
        )

    def team_phase_coverage(self, team: dict) -> Dict[str, float]:
        bowlers = team.get("bowlers", [])
        if not bowlers:
            return {"powerplay": 0.0, "middle": 0.0, "death": 0.0}
        coverage = {"powerplay": 0.0, "middle": 0.0, "death": 0.0}
        for bowler in bowlers:
            ratios = self.phase_ratios(bowler)
            coverage["powerplay"] = max(coverage["powerplay"], ratios["powerplay"])
            coverage["middle"] = max(coverage["middle"], ratios["middle"])
            coverage["death"] = max(coverage["death"], ratios["death"])
        return coverage

    def phase_coverage_factor(self, team: dict) -> float:
        coverage = self.team_phase_coverage(team)
        factor = 1.0
        if coverage["powerplay"] >= 0.30 and coverage["middle"] >= 0.45 and coverage["death"] >= 0.38:
            factor += 0.10
        if coverage["death"] < 0.32:
            factor -= 0.15
        if coverage["middle"] < 0.40:
            factor -= 0.05
        return max(0.82, min(1.10, factor))

    def synergy_factor(self, team: dict) -> float:
        skill_tags = set()
        batting_hands = set()
        bowling_styles = set()
        for player in team.get("playing11", []):
            skill_tags.update(self.player_meta(player).get("skillTags", []))
            batting_hands.add(self.handedness(player))
            bowling_styles.add(self.bowling_style(player))
        factor = 1.0
        if len(batting_hands - {"unknown"}) >= 2:
            factor += 0.02
        if len(bowling_styles - {"unknown"}) >= 2:
            factor += 0.03
        if {"death_bowler", "powerplay_bowler"} & skill_tags:
            factor += 0.02
        return max(0.95, min(1.10, factor))

    def balance_factor(self, team: dict) -> float:
        keepers = sum(1 for player in team.get("playing11", []) if self.is_wicketkeeper(player))
        bowlers = sum(1 for player in team.get("playing11", []) if self.is_bowling_option(player))
        all_rounders = sum(1 for player in team.get("playing11", []) if self.is_all_rounder(player))
        factor = 1.0
        if keepers >= 1:
            factor += 0.01
        if 5 <= bowlers <= 7:
            factor += 0.04
        elif bowlers < 4:
            factor -= 0.08
        if all_rounders >= 2:
            factor += 0.03
        return max(0.88, min(1.10, factor))

    def team_strength(self, team: dict, venue: str) -> float:
        player_sum = sum(self.player_base_strength(player) for player in team.get("playing11", []))
        batting_order = team.get("batting_order", [])
        if batting_order:
            position_factor = safe_div(
                sum(self.position_factor(player, idx) for idx, player in enumerate(batting_order)),
                len(batting_order),
                default=0.8,
            )
        else:
            position_factor = 0.8
        return (
            player_sum
            * position_factor
            * self.synergy_factor(team)
            * self.balance_factor(team)
            * self.phase_coverage_factor(team)
        )

    def team_effect(self, team: dict) -> float:
        venue = team.get("venue") or "Neutral Venue"
        raw_strength = self.team_strength(team, venue)
        normalized = raw_strength / max(len(team.get("playing11", [])), 1)
        return min(1.08, max(0.92, 0.84 + (normalized / 4.0)))

    def choose_venue(self, team_a: dict, team_b: dict) -> str:
        explicit = team_a.get("venue") or team_b.get("venue")
        if explicit:
            return explicit

        scores: Dict[str, int] = {}
        for team in (team_a, team_b):
            for player in team.get("playing11", []):
                batting_ground = self.batting_profile(player).get("by_ground", {})
                bowling_ground = self.bowling_profile(player).get("by_ground", {})
                for ground, value in batting_ground.items():
                    scores[ground] = scores.get(ground, 0) + int(value)
                for ground, value in bowling_ground.items():
                    scores[ground] = scores.get(ground, 0) + (int(value) * 10)
        if not scores:
            return "Neutral Venue"
        return max(scores.items(), key=lambda item: item[1])[0]

    def tail_penalty(self, batting_index: int) -> float:
        if batting_index <= 6:
            return 1.0
        if batting_index == 7:
            return 0.72
        if batting_index == 8:
            return 0.60
        if batting_index == 9:
            return 0.52
        return 0.42

    def phase(self, over_index: int) -> str:
        if over_index < 6:
            return "powerplay"
        if over_index < 15:
            return "middle"
        return "death"

    def balls_to_overs(self, balls: int) -> str:
        return f"{balls // 6}.{balls % 6}"

    def adjust_weights(self, phase: str, weights: dict) -> dict:
        updated = dict(weights)
        if phase == "powerplay":
            updated["4"] *= 1.08
            updated["6"] *= 1.02
            updated["W"] *= 0.92
        elif phase == "death":
            updated["4"] *= 1.10
            updated["6"] *= 1.18
            updated["W"] *= 1.06
            updated["0"] *= 0.94
        return updated

    def normalize_weights(self, weights: dict) -> dict:
        total = sum(max(value, 0.0) for value in weights.values())
        if total <= 0:
            return {key: 1.0 / len(weights) for key in weights}
        return {key: max(value, 0.0) / total for key, value in weights.items()}

    def weighted_choice(self, weights: dict) -> str:
        normalized = self.normalize_weights(weights)
        roll = self.rng.random()
        cumulative = 0.0
        for outcome, probability in normalized.items():
            cumulative += probability
            if roll <= cumulative:
                return outcome
        return list(normalized)[-1]

    def add_key_event(self, innings: InningsState, event: str) -> None:
        if event and event not in innings.key_events:
            innings.key_events.append(event)

    def allocate_balls(self, bowling_team: dict) -> Dict[str, int]:
        bowlers = bowling_team.get("bowlers", [])[:6]
        if not bowlers:
            return {}

        allocations = {bowler: 12 for bowler in bowlers}
        remaining = (MAX_OVERS * BALLS_PER_OVER) - sum(allocations.values())
        strengths: List[Tuple[float, str]] = sorted(
            ((self.base_bowling_strength(bowler), bowler) for bowler in bowlers),
            reverse=True,
        )
        idx = 0
        while remaining >= BALLS_PER_OVER:
            bowler = strengths[idx % len(strengths)][1]
            if allocations[bowler] + BALLS_PER_OVER <= 24:
                allocations[bowler] += BALLS_PER_OVER
                remaining -= BALLS_PER_OVER
            idx += 1
        return allocations

    def choose_bowler(
        self,
        bowling_team: dict,
        innings: InningsState,
        striker: str,
        over_index: int,
        previous_bowler: Optional[str],
        ball_plan: Dict[str, int],
    ) -> str:
        candidates = []
        phase = self.phase(over_index)
        for bowler in bowling_team.get("bowlers", []):
            state = innings.bowlers.setdefault(bowler, BowlerState(name=bowler))
            if state.balls >= 24:
                continue
            if ball_plan.get(bowler, 0) < BALLS_PER_OVER:
                continue
            if previous_bowler and bowler == previous_bowler:
                continue
            matchup = self.matchup_factor(striker, bowler)
            ratios = self.phase_ratios(bowler)
            phase_score = ratios["middle"]
            if phase == "powerplay":
                phase_score = ratios["powerplay"]
            elif phase == "death":
                phase_score = ratios["death"]
            score = self.player_value(bowler, bowling_team, innings.venue) * max(0.35, 1.2 - matchup)
            remaining_overs = ball_plan.get(bowler, 0) // BALLS_PER_OVER
            score *= 0.8 + phase_score
            if state.balls == 0:
                score *= 1.08
            if remaining_overs >= 2 and phase_score >= 0.33:
                score *= 1.05
            candidates.append((score, bowler))
        if not candidates:
            for bowler in bowling_team.get("bowlers", []):
                state = innings.bowlers.setdefault(bowler, BowlerState(name=bowler))
                if state.balls < 24 and ball_plan.get(bowler, 0) >= BALLS_PER_OVER:
                    candidates.append((self.player_value(bowler, bowling_team, innings.venue), bowler))
        if not candidates:
            fallback = bowling_team["bowlers"][0]
            innings.bowlers.setdefault(fallback, BowlerState(name=fallback))
            return fallback
        candidates.sort(reverse=True)
        return candidates[0][1]

    def choose_fielder(self, bowling_team: dict, exclude: Optional[str] = None) -> str:
        fielders = [player for player in bowling_team.get("playing11", []) if player != exclude]
        if not fielders:
            return "Unknown"
        weighted = []
        for player in fielders:
            catches = self.fielding_profile(player).get("catches", 0)
            weighted.append((1 + catches, player))
        total = sum(weight for weight, _ in weighted)
        roll = self.rng.uniform(0, total)
        cumulative = 0.0
        for weight, player in weighted:
            cumulative += weight
            if roll <= cumulative:
                return player
        return weighted[-1][1]

    def dismissal_text(self, dismissal_type: str, bowler: str, bowling_team: dict) -> str:
        if dismissal_type == "bowled":
            return f"b {bowler}"
        if dismissal_type == "lbw":
            return f"lbw b {bowler}"
        if dismissal_type == "caught":
            fielder = self.choose_fielder(bowling_team, exclude=bowler)
            return f"c {fielder} b {bowler}"
        return "run out"

    def dismissal_type(self, striker: str, bowler: str, bowling_team: dict) -> str:
        keepers = [
            player
            for player in bowling_team.get("playing11", [])
            if "wicketkeeper" in self.role(player).lower()
        ]
        weights = {
            "caught": 0.55,
            "bowled": 0.20,
            "lbw": 0.15,
            "run out": 0.05,
            "stumped": 0.05 if keepers else 0.0,
        }
        if not keepers:
            weights["caught"] += 0.05
        return self.weighted_choice(weights)

    def innings_run_rate_bias(self, innings: InningsState, target: Optional[int]) -> float:
        innings_number = 2 if target is not None else 1
        venue_history = self.venue_history(innings.venue)
        avg_first = venue_history.get("avg_first_innings_runs", 168.0)
        avg_second = venue_history.get("avg_second_innings_runs", 160.0)
        current_rate = safe_div(innings.total_runs, max(innings.total_balls_bowled, 1), default=1.25) * 6
        if target is not None:
            remaining_balls = max((MAX_OVERS * BALLS_PER_OVER) - innings.total_balls_bowled, 1)
            required_rate = safe_div(max(target - innings.total_runs, 0), remaining_balls, default=1.3) * 6
            return min(1.06, max(0.95, 1.0 + ((required_rate - current_rate) / 40.0)))
        desired_rate = safe_div(avg_first, 20.0, default=8.0) if innings_number == 1 else safe_div(avg_second, 20.0, default=7.8)
        if innings.wickets >= 6:
            desired_rate -= 0.4
        return min(1.05, max(0.96, 1.0 + ((desired_rate - current_rate) / 36.0)))

    def pressure_factor(self, innings: InningsState, batting_index: int, target: Optional[int]) -> float:
        wickets_pressure = 1.0
        if innings.wickets >= 5:
            wickets_pressure -= min(0.14, (innings.wickets - 4) * 0.025)
        tier = self.batting_tier(batting_index)
        if target is not None:
            remaining_balls = max((MAX_OVERS * BALLS_PER_OVER) - innings.total_balls_bowled, 1)
            required_rate = safe_div(max(target - innings.total_runs, 0), remaining_balls, default=1.3) * 6
            innings.max_required_rate = max(innings.max_required_rate, required_rate)
            chase_pressure = 1.0 + max(-0.04, min(0.08, (required_rate - 8.0) / 30.0))
            if tier == "tail" and required_rate > 9.5:
                chase_pressure *= 0.95
            return max(0.85, min(1.10, wickets_pressure * chase_pressure))
        return max(0.86, min(1.05, wickets_pressure))

    def aggression_factor(self, innings: InningsState, target: Optional[int]) -> float:
        if target is None:
            current_rate = safe_div(innings.total_runs, max(innings.total_balls_bowled, 1), default=1.25) * 6
            return max(0.96, min(1.06, 1.0 + ((7.8 - current_rate) / 45.0)))
        remaining_balls = max((MAX_OVERS * BALLS_PER_OVER) - innings.total_balls_bowled, 1)
        required_rate = safe_div(max(target - innings.total_runs, 0), remaining_balls, default=1.3) * 6
        innings.max_required_rate = max(innings.max_required_rate, required_rate)
        return max(0.94, min(1.12, 0.98 + max(0.0, required_rate - 7.5) / 20.0))

    def momentum_factors(self, innings: InningsState) -> Tuple[float, float]:
        recent = innings.recent_outcomes[-4:]
        batting_boost = 1.0
        wicket_risk = 1.0
        if len(recent) >= 2 and recent[-1] in {"4", "6"} and recent[-2] in {"4", "6"}:
            batting_boost *= 1.10
            wicket_risk *= 0.92
        if recent.count("W") >= 2:
            batting_boost *= 0.88
            wicket_risk *= 1.18
        if innings.collapse_wickets_window >= 2 and innings.collapse_runs_window <= 20:
            batting_boost *= 0.84
            wicket_risk *= 1.22
        return batting_boost, wicket_risk

    def update_recent_outcomes(self, innings: InningsState, outcome: str, runs: int = 0) -> None:
        innings.recent_outcomes.append(outcome)
        innings.recent_outcomes = innings.recent_outcomes[-6:]
        innings.collapse_runs_window += runs
        if outcome == "W":
            innings.collapse_wickets_window += 1

    def batting_style_factor(self, batter: str, bowler: str) -> float:
        profile = self.batting_profile(batter)
        bowling_type = self.bowling_style(bowler)
        matches = max(profile.get("matches", 0), 1)
        total_runs = max(profile.get("total_runs", 0), 1)
        if bowling_type == "fast":
            style_runs = profile.get("vs_fast", total_runs * 0.55)
        elif bowling_type == "spin":
            style_runs = profile.get("vs_spin", total_runs * 0.35)
        else:
            style_runs = profile.get("vs_unknown_bowling", total_runs * 0.10)
        expected_share = {"fast": 0.58, "spin": 0.32}.get(bowling_type, 0.10)
        style_rate = safe_div(style_runs, matches, default=18.0)
        baseline = safe_div(total_runs, matches, default=18.0) * max(expected_share, 0.1)
        return max(0.88, min(1.12, 1.0 + safe_div(style_rate - baseline, baseline * 6, default=0.0)))

    def hand_factor(self, bowler: str, batter: str) -> float:
        profile = self.bowling_profile(bowler)
        batter_hand = self.handedness(batter)
        wickets = profile.get("total_wickets", 0)
        if batter_hand == "left":
            hand_wickets = profile.get("vs_left_handed", wickets * 0.35)
        elif batter_hand == "right":
            hand_wickets = profile.get("vs_right_handed", wickets * 0.55)
        else:
            hand_wickets = profile.get("vs_unknown_handed", wickets * 0.10)
        matches = max(profile.get("matches", 0), 1)
        hand_rate = safe_div(hand_wickets, matches, default=0.6)
        baseline = safe_div(wickets, matches, default=0.6)
        return max(0.90, min(1.12, 1.0 + safe_div(hand_rate - (baseline * 0.5), max(baseline, 0.5) * 3.5, default=0.0)))

    def ground_factor(self, player: str, venue: str, discipline: str) -> float:
        profile = self.batting_profile(player) if discipline == "batting" else self.bowling_profile(player)
        by_ground = profile.get("by_ground", {})
        if not by_ground:
            return 1.0
        venue_value = self.ground_stat_value(by_ground, venue)
        if venue_value is None:
            return 1.0
        matches = max(profile.get("matches", 0), 1)
        total = profile.get("total_runs", 0) if discipline == "batting" else profile.get("total_wickets", 0)
        average = safe_div(total, matches, default=18.0 if discipline == "batting" else 0.8)
        sample_share = min(1.0, safe_div(venue_value, max(total, 1), default=0.0) * 8.0)
        relative = safe_div(venue_value, average, default=1.0)
        raw_factor = 0.80 + min(relative, 3.0) * 0.20
        blended = 1.0 + ((raw_factor - 1.0) * max(0.45, sample_share))
        return max(0.80, min(1.28, blended))

    def form_factor(self, batter: str) -> float:
        profile = self.batting_profile(batter)
        matches = max(profile.get("matches", 0), 1)
        runs_per_match = safe_div(profile.get("total_runs", 0), matches, default=18.0)
        best_score = profile.get("best_score", 0)
        return max(0.92, min(1.10, 0.96 + min(runs_per_match / 45.0, 0.08) + min(best_score / 250.0, 0.06)))

    def bowling_phase_factor(self, bowler: str, over_index: int) -> float:
        phase = self.phase(over_index)
        ratios = self.phase_ratios(bowler)
        phase_ratio = ratios["middle"]
        if phase == "powerplay":
            phase_ratio = ratios["powerplay"]
        elif phase == "death":
            phase_ratio = ratios["death"]
        return max(0.7, min(1.3, 0.7 + (phase_ratio * 0.6)))

    def wicket_cap_factor(self, innings: InningsState, bowler: str) -> float:
        current = innings.bowlers.get(bowler, BowlerState(name=bowler)).wickets
        bowlers_on_three = sum(1 for state in innings.bowlers.values() if state.wickets >= 3)
        bowlers_on_two = sum(1 for state in innings.bowlers.values() if state.wickets >= 2 and state.name != bowler)
        if current >= 3:
            return 0.0
        if current == 2:
            if bowlers_on_three:
                return 0.12
            if bowlers_on_two:
                return 0.25
            return 0.55
        if current == 1 and bowlers_on_three:
            return 0.75
        return 0.82 if bowlers_on_three else 1.0

    def outcome_for_ball(
        self,
        innings: InningsState,
        batter: str,
        bowler: str,
        batting_index: int,
        batting_effect: float,
        bowling_effect: float,
        over_index: int,
        target: Optional[int],
    ) -> str:
        innings_number = 2 if target is not None else 1
        matchup_factor = self.matchup_factor(batter, bowler)
        tier = self.batting_tier(batting_index)
        tier_factor = {"top": 1.01, "middle": 0.95, "tail": 0.66}[tier]
        style_factor = self.batting_style_factor(batter, bowler)
        ground_factor = self.ground_factor(batter, innings.venue, "batting")
        ground_bowling_factor = self.ground_factor(bowler, innings.venue, "bowling")
        form_factor = self.form_factor(batter)
        pressure_factor = self.pressure_factor(innings, batting_index, target)
        aggression_factor = self.aggression_factor(innings, target)
        momentum_boost, wicket_risk_boost = self.momentum_factors(innings)
        team_factor = batting_effect * self.innings_run_rate_bias(innings, target)
        bowler_team_factor = bowling_effect
        hand_factor = self.hand_factor(bowler, batter)
        phase_factor = self.bowling_phase_factor(bowler, over_index)
        random_factor = self.rng.uniform(0.9, 1.1)

        batter_strength = (
            self.base_batting_strength(batter)
            * self.position_factor(batter, batting_index)
            * max(matchup_factor, 0.35)
            * style_factor
            * ground_factor
            * form_factor
            * pressure_factor
            * aggression_factor
            * momentum_boost
            * team_factor
            * self.tail_penalty(batting_index)
            * tier_factor
            * random_factor
        )
        bowler_strength = (
            self.base_bowling_strength(bowler)
            * max(0.35, 1 - matchup_factor)
            * hand_factor
            * ground_bowling_factor
            * phase_factor
            * wicket_risk_boost
            * bowler_team_factor
            * random_factor
        )
        attack_ratio = safe_div(batter_strength, batter_strength + bowler_strength, default=0.5)
        attack_ratio = max(0.22, min(0.72, attack_ratio))
        wicket_factor = self.wicket_cap_factor(innings, bowler)
        venue_outcome = self.venue_outcome_factors(innings.venue, innings_number)

        weights = {
            "0": 0.25 * (1 - attack_ratio) * venue_outcome["dot"],
            "1": 0.30 * venue_outcome["single"],
            "2": 0.10 * attack_ratio,
            "3": 0.015,
            "4": 0.16 * attack_ratio * venue_outcome["boundary"],
            "6": 0.07 * attack_ratio * venue_outcome["six"],
            "W": (0.10 * (1 - attack_ratio)) * wicket_factor * venue_outcome["wicket"],
        }
        if aggression_factor > 1.03:
            weights["4"] *= 1.08
            weights["6"] *= 1.12
            weights["W"] *= 1.10
            weights["0"] *= 0.92
        elif aggression_factor < 0.98:
            weights["1"] *= 1.04
            weights["4"] *= 0.95
            weights["6"] *= 0.90
        if tier == "top":
            weights["4"] *= 1.05
            weights["6"] *= 1.04
            weights["0"] *= 0.96
        elif tier == "tail":
            weights["0"] *= 1.40
            weights["1"] *= 0.82
            weights["2"] *= 0.70
            weights["4"] *= 0.42
            weights["6"] *= 0.24
            weights["W"] *= 0.95
        weights = self.adjust_weights(self.phase(over_index), weights)
        return self.weighted_choice(weights)

    def build_over_schedule(self, bowling_team: dict, ball_plan: Dict[str, int]) -> List[str]:
        remaining_overs = {bowler: balls // BALLS_PER_OVER for bowler, balls in ball_plan.items()}
        bowlers = bowling_team.get("bowlers", [])
        powerplay_pool = sorted(
            bowlers,
            key=lambda bowler: (self.phase_ratios(bowler)["powerplay"], self.player_value(bowler, bowling_team, bowling_team.get("venue") or "Neutral Venue")),
            reverse=True,
        )
        middle_pool = sorted(
            bowlers,
            key=lambda bowler: (self.phase_ratios(bowler)["middle"], self.player_value(bowler, bowling_team, bowling_team.get("venue") or "Neutral Venue")),
            reverse=True,
        )
        death_pool = sorted(
            bowlers,
            key=lambda bowler: (self.phase_ratios(bowler)["death"], self.player_value(bowler, bowling_team, bowling_team.get("venue") or "Neutral Venue")),
            reverse=True,
        )

        schedule: List[Optional[str]] = [None] * MAX_OVERS

        def assign_slot(slot: int, choices: List[str]) -> None:
            if schedule[slot] is not None:
                return
            ranked = sorted(
                (
                    (
                        remaining_overs.get(bowler, 0),
                        self.phase_ratios(bowler)["middle"],
                        self.player_value(bowler, bowling_team, bowling_team.get("venue") or "Neutral Venue"),
                        bowler,
                    )
                    for bowler in choices
                    if remaining_overs.get(bowler, 0) > 0
                    and (slot == 0 or bowler != schedule[slot - 1])
                ),
                reverse=True,
            )
            if not ranked:
                ranked = sorted(
                    (
                        (
                            remaining_overs.get(bowler, 0),
                            self.phase_ratios(bowler)["middle"],
                            self.player_value(bowler, bowling_team, bowling_team.get("venue") or "Neutral Venue"),
                            bowler,
                        )
                        for bowler in bowlers
                        if remaining_overs.get(bowler, 0) > 0
                        and (slot == 0 or bowler != schedule[slot - 1])
                    ),
                    reverse=True,
                )
            if not ranked:
                return
            bowler = ranked[0][3]
            schedule[slot] = bowler
            remaining_overs[bowler] -= 1

        for slot in range(0, 6):
            assign_slot(slot, powerplay_pool)
        for slot in range(6, 15):
            assign_slot(slot, middle_pool)
        for slot in range(15, 20):
            assign_slot(slot, death_pool)

        for slot in range(MAX_OVERS):
            assign_slot(slot, bowlers)

        return [bowler for bowler in schedule if bowler is not None]

    def simulate_innings(self, batting_team: dict, bowling_team: dict, target: Optional[int] = None) -> InningsState:
        venue = batting_team.get("venue") or bowling_team.get("venue") or self.choose_venue(batting_team, bowling_team)
        innings = InningsState(batting_team=batting_team, bowling_team=bowling_team, venue=venue)
        batting_order = batting_team["batting_order"]
        innings_number = 2 if target is not None else 1
        pitch_batting_factor, pitch_bowling_factor = self.venue_pitch_factors(venue, innings_number)
        batting_effect = self.team_effect(batting_team) * pitch_batting_factor
        bowling_effect = self.team_effect(bowling_team) * pitch_bowling_factor
        ball_plan = self.allocate_balls(bowling_team)
        over_schedule = self.build_over_schedule(bowling_team, ball_plan)
        current_partnership = 0

        striker_idx = 0
        non_striker_idx = 1
        next_batter_idx = 2

        for player in batting_order:
            innings.batters[player] = BatterState(name=player)

        for over_index in range(MAX_OVERS):
            if innings.wickets >= MAX_WICKETS or striker_idx >= len(batting_order):
                break
            if innings.total_balls_bowled >= MAX_OVERS * BALLS_PER_OVER:
                break
            if target is not None and innings.total_runs >= target:
                break
            innings.collapse_runs_window = 0
            innings.collapse_wickets_window = 0

            striker = batting_order[striker_idx]
            bowler = over_schedule[over_index] if over_index < len(over_schedule) else self.choose_bowler(
                bowling_team, innings, striker, over_index, None, ball_plan
            )
            bowler_state = innings.bowlers.setdefault(bowler, BowlerState(name=bowler))
            wickets_in_over = 0

            for _ball in range(BALLS_PER_OVER):
                if innings.wickets >= MAX_WICKETS or striker_idx >= len(batting_order):
                    break
                if innings.total_balls_bowled >= MAX_OVERS * BALLS_PER_OVER:
                    break
                if target is not None and innings.total_runs >= target:
                    break

                striker = batting_order[striker_idx]
                batter_state = innings.batters[striker]
                outcome = self.outcome_for_ball(
                    innings,
                    striker,
                    bowler,
                    striker_idx,
                    batting_effect,
                    bowling_effect,
                    over_index,
                    target,
                )

                batter_state.balls += 1
                bowler_state.balls += 1
                innings.total_balls_bowled += 1

                if outcome == "W":
                    self.update_recent_outcomes(innings, "W")
                    dismissal_type = self.dismissal_type(striker, bowler, bowling_team)
                    if dismissal_type == "run out" and innings.wickets >= 8:
                        dismissal_type = "caught"
                    innings.wickets += 1
                    wickets_in_over += 1
                    batter_state.out = True
                    if dismissal_type == "stumped":
                        keeper = next(
                            (
                                player
                                for player in bowling_team.get("playing11", [])
                                if "wicketkeeper" in self.role(player).lower()
                            ),
                            self.choose_fielder(bowling_team),
                        )
                        batter_state.dismissal = f"st {keeper} b {bowler}"
                    else:
                        batter_state.dismissal = self.dismissal_text(dismissal_type, bowler, bowling_team)
                    if dismissal_type != "run out" and bowler_state.wickets < 3:
                        bowler_state.wickets += 1
                    innings.partnerships.append(current_partnership)
                    current_partnership = 0
                    if next_batter_idx < len(batting_order):
                        striker_idx = next_batter_idx
                        next_batter_idx += 1
                    else:
                        striker_idx = len(batting_order)
                        break
                else:
                    runs = int(outcome)
                    self.update_recent_outcomes(innings, outcome, runs)
                    innings.total_runs += runs
                    current_partnership += runs
                    batter_state.runs += runs
                    bowler_state.runs += runs
                    if runs == 4:
                        batter_state.fours += 1
                    elif runs == 6:
                        batter_state.sixes += 1
                    if runs % 2 == 1:
                        striker_idx, non_striker_idx = non_striker_idx, striker_idx

                    if batter_state.runs >= 50 and (batter_state.runs - runs) < 50:
                        self.add_key_event(innings, f"{striker} scored 50")
                    if batter_state.runs >= 100 and (batter_state.runs - runs) < 100:
                        self.add_key_event(innings, f"{striker} scored 100")

                if target is not None and innings.total_runs >= target:
                    break

            if bowler_state.wickets == 3 and wickets_in_over > 0:
                self.add_key_event(innings, f"{bowler} took 3 wickets")
            if wickets_in_over >= 2 and innings.collapse_runs_window <= 12:
                self.add_key_event(innings, f"{innings.batting_team['name']} suffered a collapse")

            if striker_idx < len(batting_order) and non_striker_idx < len(batting_order):
                striker_idx, non_striker_idx = non_striker_idx, striker_idx

        if current_partnership:
            innings.partnerships.append(current_partnership)
        best_partnership = max(innings.partnerships, default=0)
        if best_partnership >= 70:
            self.add_key_event(innings, f"Big partnership of {best_partnership}")
        if target is not None and innings.total_runs >= target:
            chaser = max(innings.batters.values(), key=lambda state: (state.runs, -state.balls), default=None)
            if chaser and chaser.runs >= 40:
                self.add_key_event(innings, f"{chaser.name} played a match-winning innings")
            if innings.max_required_rate >= 10.0:
                self.add_key_event(innings, f"{innings.batting_team['name']} pulled off a comeback")
        return innings

    def batting_scorecard(self, innings: InningsState) -> List[dict]:
        card = []
        for player in innings.batting_team["batting_order"]:
            state = innings.batters[player]
            strike_rate = round(safe_div(state.runs * 100, state.balls, default=0.0), 2)
            card.append(
                {
                    "player": player,
                    "runs": state.runs,
                    "balls": state.balls,
                    "fours": state.fours,
                    "sixes": state.sixes,
                    "strike_rate": strike_rate,
                    "dismissal": state.dismissal,
                }
            )
        return card

    def batting_reason(self, player: str, innings: InningsState, team: dict) -> str:
        index = team["batting_order"].index(player)
        reasons = []
        venue_factor = self.ground_factor(player, innings.venue, "batting")
        position = self.position_factor(player, index)
        style_edges = [
            self.batting_style_factor(player, bowler)
            for bowler in team.get("opposition_bowlers", [])
            if bowler
        ]
        if venue_factor >= 1.12:
            reasons.append("strong venue history")
        if position >= 1.0:
            reasons.append("good batting-slot fit")
        if style_edges and safe_div(sum(style_edges), len(style_edges), default=1.0) >= 1.02:
            reasons.append("matched up well against the bowling styles")
        if self.form_factor(player) >= 1.05:
            reasons.append("entered with a strong form rating")
        return ", ".join(reasons[:3]) or "made the most of the match situation"

    def bowling_reason(self, player: str, innings: InningsState, batting_team: dict) -> str:
        reasons = []
        venue_factor = self.ground_factor(player, innings.venue, "bowling")
        phase_ratios = self.phase_ratios(player)
        hand_edges = [
            self.hand_factor(player, batter)
            for batter in batting_team["batting_order"][:6]
        ]
        if venue_factor >= 1.10:
            reasons.append("the venue suited their bowling")
        if phase_ratios["death"] >= 0.38:
            reasons.append("they are a proven death-overs wicket taker")
        elif phase_ratios["powerplay"] >= 0.32:
            reasons.append("they are a strong powerplay bowler")
        elif phase_ratios["middle"] >= 0.45:
            reasons.append("they control the middle overs well")
        if hand_edges and safe_div(sum(hand_edges), len(hand_edges), default=1.0) >= 1.02:
            reasons.append("the batting line-up handed them favorable matchups")
        return ", ".join(reasons[:3]) or "they executed their role well under pressure"

    def final_report(self, team_a: dict, innings_a: InningsState, team_b: dict, innings_b: InningsState, winner: str) -> dict:
        team_a_with_context = dict(team_a)
        team_a_with_context["opposition_bowlers"] = team_b["bowlers"]
        team_b_with_context = dict(team_b)
        team_b_with_context["opposition_bowlers"] = team_a["bowlers"]

        standout_batters = []
        for team_name, innings, team_context in [
            (team_a["name"], innings_a, team_a_with_context),
            (team_b["name"], innings_b, team_b_with_context),
        ]:
            top_batter = max(innings.batters.values(), key=lambda state: (state.runs, -state.balls), default=None)
            if top_batter and top_batter.runs >= 30:
                standout_batters.append(
                    {
                        "player": top_batter.name,
                        "team": team_name,
                        "performance": f"{top_batter.runs} off {top_batter.balls}",
                        "why": self.batting_reason(top_batter.name, innings, team_context),
                    }
                )

        standout_bowlers = []
        for team_name, innings, opposition in [
            (team_a["name"], innings_b, team_b),
            (team_b["name"], innings_a, team_a),
        ]:
            best_bowler = max(innings.bowlers.values(), key=lambda state: (state.wickets, -state.runs, state.balls), default=None)
            if best_bowler and best_bowler.wickets >= 2:
                standout_bowlers.append(
                    {
                        "player": best_bowler.name,
                        "team": team_name,
                        "performance": f"{best_bowler.wickets}/{best_bowler.runs} in {self.balls_to_overs(best_bowler.balls)}",
                        "why": self.bowling_reason(best_bowler.name, innings, opposition),
                    }
                )

        if winner == "Tie":
            summary = "The match ended level because both teams matched each other across venue conditions, pressure moments, and key phases."
        else:
            summary = f"{winner} won because their key performers handled the venue, pressure, and phase matchups better."
        return {
            "summary": summary,
            "standout_batters": standout_batters,
            "standout_bowlers": standout_bowlers,
        }

    def bowling_scorecard(self, innings: InningsState) -> List[dict]:
        card = []
        for player in innings.bowling_team["bowlers"]:
            state = innings.bowlers.get(player, BowlerState(name=player))
            overs = self.balls_to_overs(state.balls)
            economy = round(safe_div(state.runs * 6, state.balls, default=0.0), 2)
            card.append(
                {
                    "player": player,
                    "overs": overs,
                    "balls": state.balls,
                    "runs": state.runs,
                    "wickets": state.wickets,
                    "economy": economy,
                }
            )
        return card

    def validate_innings(self, innings: InningsState) -> None:
        valid_batters = set(innings.batting_team["playing11"])
        valid_bowlers = set(innings.bowling_team["bowlers"])
        if innings.total_balls_bowled > MAX_OVERS * BALLS_PER_OVER:
            raise ValueError("Invalid innings: total balls exceeded 120")
        if set(innings.batters) - valid_batters:
            raise ValueError("Invalid innings: unknown batter in scorecard")
        if set(innings.bowlers) - valid_bowlers:
            raise ValueError("Invalid innings: unknown bowler in scorecard")
        for bowler in innings.bowling_team["bowlers"]:
            state = innings.bowlers.get(bowler, BowlerState(name=bowler))
            if state.balls == 0:
                raise ValueError(f"Invalid innings: unused bowler {bowler}")
            if state.balls > 24:
                raise ValueError(f"Invalid innings: bowler exceeded 4 overs {bowler}")
            overs = self.balls_to_overs(state.balls)
            if overs != f"{state.balls // 6}.{state.balls % 6}":
                raise ValueError(f"Invalid innings: overs format mismatch for {bowler}")

    def winner(self, team_a: dict, innings_a: InningsState, team_b: dict, innings_b: InningsState) -> str:
        if innings_b.total_runs > innings_a.total_runs:
            return team_b["name"]
        if innings_a.total_runs > innings_b.total_runs:
            return team_a["name"]
        return "Tie"

    def simulate_match(self, team_a: dict, team_b: dict) -> dict:
        team_a = self.validate_team(team_a)
        team_b = self.validate_team(team_b)
        innings_a = self.simulate_innings(team_a, team_b)
        innings_b = self.simulate_innings(team_b, team_a, innings_a.total_runs + 1)
        self.validate_innings(innings_a)
        self.validate_innings(innings_b)
        winner = self.winner(team_a, innings_a, team_b, innings_b)
        key_events = []
        for event in innings_a.key_events + innings_b.key_events:
            if event not in key_events:
                key_events.append(event)
            if len(key_events) == 8:
                break
        venue_data = self.venue_history(innings_a.venue)
        report = self.final_report(team_a, innings_a, team_b, innings_b, winner)

        return {
            "venue": innings_a.venue,
            "venue_analysis": {
                "pitch": venue_data.get("pitch", "unknown"),
                "avg_first_innings_runs": venue_data.get("avg_first_innings_runs"),
                "avg_second_innings_runs": venue_data.get("avg_second_innings_runs"),
                "avg_total_wickets": venue_data.get("avg_total_wickets"),
                "chase_win_rate": venue_data.get("chase_win_rate"),
            },
            "teamA": {
                "score": f"{innings_a.total_runs}/{innings_a.wickets}",
                "batting": self.batting_scorecard(innings_a),
                "bowling": self.bowling_scorecard(innings_b),
            },
            "teamB": {
                "score": f"{innings_b.total_runs}/{innings_b.wickets}",
                "batting": self.batting_scorecard(innings_b),
                "bowling": self.bowling_scorecard(innings_a),
            },
            "winner": winner,
            "key_events": key_events,
            "final_report": report,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--player-data", default=str(DATA_DIR / "ipl_player_analytics.json"))
    parser.add_argument("--matchup-data", default=str(DATA_DIR / "ipl_player_matchups.json"))
    parser.add_argument("--players", default=str(DATA_DIR / "players.json"))
    parser.add_argument("--ground-history", default=str(DATA_DIR / "ipl_ground_history.json"))
    parser.add_argument("--teams", required=True)
    parser.add_argument("--seed", type=int, default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    analytics = load_json(Path(args.player_data).expanduser().resolve())
    matchups = load_json(Path(args.matchup_data).expanduser().resolve())
    player_registry = load_player_registry(Path(args.players).expanduser().resolve())
    ground_history = load_json(Path(args.ground_history).expanduser().resolve())
    teams = load_json(Path(args.teams).expanduser().resolve())
    rng = random.Random(args.seed)
    engine = SimulationEngine(analytics, matchups, rng, player_registry, ground_history)
    result = engine.simulate_match(teams["teamA"], teams["teamB"])
    print(json.dumps(result, indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()
