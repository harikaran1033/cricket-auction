#!/usr/bin/env python3
"""Generate IPL player analytics from ball-by-ball data.

The script reads:
- a ball-by-ball CSV (`IPL.csv` by default)
- a player registry JSON (`players.json` by default)

It outputs structured JSON keyed by player full name for:
- batsmen (including wicketkeeper-batsmen and all-rounders)
- bowlers (including all-rounders)

The player registry is used to:
- normalize scorecard names to canonical full names
- derive bowling style classification (fast/spin)
- derive batting handedness (right/left)
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


EXCLUDED_WICKET_KINDS = {
    "run out",
    "retired hurt",
    "retired out",
    "obstructing the field",
}

BATSMAN_ROLES = {"batsman", "wicketkeeper-batsman", "all-rounder"}
BOWLER_ROLES = {"bowler", "all-rounder"}
NAME_JOINERS = {"de", "del", "der", "di", "dos", "du", "la", "le", "van", "von"}
MANUAL_ALIAS_OVERRIDES = {
    "cv varun": "Varun Chakravarthy",
    "mohammed siraj": "Mohammad Siraj",
    "nithish kumar reddy": "Nitish Kumar Reddy",
    "rm patidar": "Rajat Patidar",
    "c green": "Cameron Green",
    "cj green": "Chris Green",
}
SUPPLEMENTAL_BOWLER_TYPES = {
    "r ashwin": "spin",
    "pp chawla": "spin",
    "ut yadav": "fast",
    "dj bravo": "fast",
    "a mishra": "spin",
    "harbhajan singh": "spin",
    "mm sharma": "fast",
    "sl malinga": "fast",
    "p kumar": "fast",
    "r vinay kumar": "fast",
    "z khan": "fast",
    "sr watson": "fast",
    "ik pathan": "fast",
    "a nehra": "fast",
    "dw steyn": "fast",
    "ds kulkarni": "fast",
    "pp ojha": "spin",
    "ja morkel": "fast",
    "rp singh": "fast",
    "jh kallis": "fast",
    "ch morris": "fast",
    "kv sharma": "spin",
    "m prasidh krishna": "fast",
    "m morkel": "fast",
    "ab dinda": "fast",
    "r bhatia": "fast",
    "l balaji": "fast",
    "sk trivedi": "fast",
    "shakib al hasan": "spin",
    "s nadeem": "spin",
    "jp faulkner": "fast",
    "mj mcclenaghan": "fast",
    "s kaul": "fast",
    "tg southee": "fast",
    "mm patel": "fast",
    "imran tahir": "spin",
    "m muralitharan": "spin",
    "mg johnson": "fast",
    "sb jakati": "spin",
    "sk warne": "spin",
    "vr aaron": "fast",
    "yk pathan": "spin",
    "m kartik": "spin",
    "ms gony": "fast",
    "pj sangwan": "fast",
    "dt christian": "fast",
    "m ashwin": "spin",
    "ab agarkar": "fast",
    "s sreesanth": "fast",
    "pwh de silva": "spin",
    "sk raina": "spin",
    "iqbal abdulla": "spin",
    "yuvraj singh": "spin",
    "nm coulter-nile": "fast",
    "ad mathews": "fast",
    "b lee": "fast",
    "a kumble": "spin",
    "mm ali": "spin",
    "s aravind": "fast",
    "p awana": "fast",
    "rj harris": "fast",
    "nltc perera": "fast",
    "ba stokes": "fast",
    "aj tye": "fast",
    "p negi": "spin",
    "navdeep saini": "fast",
    "wd parnell": "fast",
    "dl vettori": "spin",
    "r dhawan": "fast",
    "pv tambe": "spin",
    "basil thampi": "fast",
    "jp duminy": "spin",
    "k gowtham": "spin",
    "dr smith": "fast",
    "j botha": "spin",
    "as rajpoot": "fast",
    "str binny": "fast",
    "dp nannes": "fast",
    "kk cooper": "fast",
    "bb sran": "fast",
}
SUPPLEMENTAL_BATTER_HANDS = {
    "s dhawan": "left",
    "rv uthappa": "right",
    "kd karthik": "right",
    "sk raina": "left",
    "at rayudu": "right",
    "g gambhir": "left",
    "f du plessis": "right",
    "ch gayle": "left",
    "sr watson": "right",
    "ab de villiers": "right",
    "pa patel": "left",
    "wp saha": "right",
    "ma agarwal": "right",
    "yuvraj singh": "left",
    "yk pathan": "right",
    "bb mccullum": "right",
    "v sehwag": "right",
    "m vijay": "right",
    "jh kallis": "right",
    "aj finch": "right",
    "dr smith": "right",
    "mandeep singh": "right",
    "dj hooda": "right",
    "r dravid": "right",
    "ac gilchrist": "left",
    "nv ojha": "right",
    "dj bravo": "right",
    "sr tendulkar": "right",
    "kc sangakkara": "left",
    "se marsh": "left",
    "r ashwin": "right",
    "dpmd jayawardene": "right",
    "ejg morgan": "left",
    "mk tiwary": "right",
    "sc ganguly": "left",
    "km jadhav": "right",
    "mm ali": "left",
    "p simran singh": "right",
    "ik pathan": "left",
    "mek hussey": "left",
    "ss tiwary": "left",
    "jp duminy": "left",
    "m vohra": "left",
    "dj hussey": "right",
    "s badrinath": "right",
    "v shankar": "right",
    "str binny": "right",
    "y venugopal rao": "right",
    "bj hodge": "right",
    "tm dilshan": "right",
    "shakib al hasan": "left",
    "lrpl taylor": "right",
    "ja morkel": "left",
    "ba stokes": "left",
    "am nayar": "right",
    "ms bisla": "right",
    "b sai sudharsan": "left",
    "cl white": "right",
    "p kumar": "right",
    "hh gibbs": "right",
    "tl suman": "right",
    "r bhatia": "right",
    "pj cummins": "right",
    "mk lomror": "left",
    "ml hayden": "left",
    "st jayasuriya": "left",
    "a mishra": "right",
    "ad mathews": "right",
    "ch morris": "right",
    "lr shukla": "right",
    "jd ryder": "left",
    "kp pietersen": "right",
    "dt christian": "right",
    "gc smith": "left",
    "gj bailey": "right",
    "hv patel": "right",
    "jp faulkner": "left",
    "lmp simmons": "right",
}


def clean_text(value: Optional[str]) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.upper() == "NA":
        return ""
    return text


def to_int(value: Optional[str]) -> int:
    text = clean_text(value)
    if not text:
        return 0
    try:
        return int(float(text))
    except ValueError:
        return 0


def normalize_key(name: str) -> str:
    return re.sub(r"\s+", " ", clean_text(name).lower())


def classify_bowling_type(style: str) -> str:
    normalized = normalize_key(style)
    if not normalized or normalized == "none":
        return "unknown"

    spin_tokens = (
        "spin",
        "break",
        "orthodox",
        "chinaman",
        "slow left-arm",
        "left-arm wrist",
        "left arm wrist",
        "googly",
    )
    fast_tokens = ("fast", "medium", "pace", "seam")

    if any(token in normalized for token in spin_tokens):
        return "spin"
    if any(token in normalized for token in fast_tokens):
        return "fast"
    return "unknown"


def classify_batting_hand(style: str) -> str:
    normalized = normalize_key(style)
    if normalized.startswith("left-hand"):
        return "left"
    if normalized.startswith("right-hand"):
        return "right"
    return "unknown"


def supplemental_bowling_type(name: str) -> str:
    return SUPPLEMENTAL_BOWLER_TYPES.get(normalize_key(name), "fast")


def supplemental_batting_type(name: str) -> str:
    return SUPPLEMENTAL_BATTER_HANDS.get(normalize_key(name), "right")


def build_initials_alias(full_name: str) -> Optional[str]:
    parts = [part for part in clean_text(full_name).split() if part]
    if len(parts) < 2:
        return None

    surname_parts = [parts[-1]]
    idx = len(parts) - 2
    while idx >= 0 and parts[idx].lower() in NAME_JOINERS:
        surname_parts.insert(0, parts[idx])
        idx -= 1

    given_parts = parts[: idx + 1]
    if not given_parts:
        return None

    initials = "".join(part[0].upper() for part in given_parts if part)
    surname = " ".join(surname_parts)
    return f"{initials} {surname}".strip()


def tokenize_name(name: str) -> List[str]:
    return [part for part in normalize_key(name).split(" ") if part]


def is_suffix_name_variant(name_a: str, name_b: str) -> bool:
    tokens_a = tokenize_name(name_a)
    tokens_b = tokenize_name(name_b)
    if len(tokens_a) == len(tokens_b):
        return False
    shorter, longer = (tokens_a, tokens_b) if len(tokens_a) < len(tokens_b) else (tokens_b, tokens_a)
    return longer[-len(shorter) :] == shorter


def expand_aliases(full_name: str, short_name: str) -> Set[str]:
    aliases = {alias for alias in {full_name, short_name, build_initials_alias(full_name)} if alias}

    # Some scorecards use doubled initials (for example, "JJ Bumrah")
    # while the registry keeps a single initial ("J Bumrah").
    for alias in list(aliases):
        parts = alias.split()
        if len(parts) >= 2 and re.fullmatch(r"[A-Z]", parts[0]):
            aliases.add(f"{parts[0]}{parts[0]} {' '.join(parts[1:])}")

    return aliases


def load_players(
    players_path: Path,
) -> Tuple[Dict[str, dict], Dict[str, List[str]], Dict[str, List[str]]]:
    with players_path.open(encoding="utf-8") as handle:
        raw_players = json.load(handle)

    if not isinstance(raw_players, list):
        raise ValueError("players.json must contain a list of player objects")

    deduped_entries: List[dict] = []
    canonical_name_by_variant: Dict[str, str] = {}

    for entry in raw_players:
        full_name = clean_text(entry.get("fullName"))
        short_name = clean_text(entry.get("shortName"))
        role = clean_text(entry.get("role"))
        if not full_name:
            continue

        canonical_full_name = full_name
        for existing in deduped_entries:
            existing_full_name = clean_text(existing.get("fullName"))
            existing_short_name = clean_text(existing.get("shortName"))
            existing_role = clean_text(existing.get("role"))

            if short_name and short_name == existing_short_name and role == existing_role:
                if is_suffix_name_variant(full_name, existing_full_name):
                    canonical_full_name = (
                        full_name
                        if len(tokenize_name(full_name)) > len(tokenize_name(existing_full_name))
                        else existing_full_name
                    )
                    canonical_name_by_variant[full_name] = canonical_full_name
                    canonical_name_by_variant[existing_full_name] = canonical_full_name
                    if canonical_full_name == full_name and existing_full_name != full_name:
                        existing["fullName"] = full_name
                    break

        if canonical_full_name == full_name and full_name not in canonical_name_by_variant:
            deduped_entries.append(dict(entry))
            canonical_name_by_variant[full_name] = full_name

    players: Dict[str, dict] = {}
    alias_candidates: Dict[str, Set[str]] = defaultdict(set)
    surname_index: Dict[str, Set[str]] = defaultdict(set)

    for entry in deduped_entries:
        full_name = clean_text(entry.get("fullName"))
        if not full_name:
            continue

        role = clean_text(entry.get("role"))
        batting_style = clean_text(entry.get("battingStyle"))
        bowling_style = clean_text(entry.get("bowlingStyle"))

        player = {
            "full_name": full_name,
            "short_name": clean_text(entry.get("shortName")),
            "role": role,
            "batting_style": batting_style,
            "bowling_style": bowling_style,
            "batting_type": classify_batting_hand(batting_style),
            "bowling_type": classify_bowling_type(bowling_style),
            "surname": clean_text(full_name.split()[-1]) if clean_text(full_name) else "",
        }
        players[full_name] = player
        if player["surname"]:
            surname_index[normalize_key(player["surname"])].add(full_name)

        aliases = expand_aliases(full_name, player["short_name"])
        for variant, canonical in canonical_name_by_variant.items():
            if canonical == full_name:
                aliases.add(variant)

        for alias in aliases:
            alias_candidates[normalize_key(alias)].add(full_name)

    alias_map: Dict[str, List[str]] = {
        alias: sorted(full_names) for alias, full_names in alias_candidates.items()
    }
    surname_map: Dict[str, List[str]] = {
        surname: sorted(full_names) for surname, full_names in surname_index.items()
    }
    return players, alias_map, surname_map


def filter_candidates_by_context(
    candidates: List[str],
    players: Dict[str, dict],
    context: str,
) -> List[str]:
    if context == "batter":
        return [name for name in candidates if normalize_key(players[name]["role"]) in BATSMAN_ROLES]
    if context == "bowler":
        return [name for name in candidates if normalize_key(players[name]["role"]) in BOWLER_ROLES]
    if context == "player_out":
        return [name for name in candidates if normalize_key(players[name]["role"]) in BATSMAN_ROLES]
    return candidates


def resolve_player(
    name: str,
    alias_map: Dict[str, List[str]],
    surname_map: Dict[str, List[str]],
    players: Dict[str, dict],
    context: str,
) -> Optional[str]:
    key = normalize_key(name)
    if not key:
        return None
    manual_match = MANUAL_ALIAS_OVERRIDES.get(key)
    if manual_match in players:
        return manual_match
    matches = alias_map.get(key, [])
    filtered_matches = filter_candidates_by_context(matches, players, context)
    if len(filtered_matches) == 1:
        return filtered_matches[0]
    if len(matches) == 1:
        return matches[0]

    parts = clean_text(name).split()
    if len(parts) >= 2 and re.fullmatch(r"[A-Za-z]+", parts[0]):
        initials = parts[0].lower()
        surname_key = normalize_key(" ".join(parts[1:]))
        surname_matches = filter_candidates_by_context(
            surname_map.get(surname_key, []),
            players,
            context,
        )
        narrowed = [
            full_name
            for full_name in surname_matches
            if normalize_key(full_name)[0] == initials[0]
        ]
        if len(narrowed) == 1:
            return narrowed[0]

    return None


def make_batsman_record(player: dict) -> dict:
    return {
        "role": player["role"],
        "batting_style": player["batting_style"],
        "bowling_style": player["bowling_style"],
        "has_ipl_data": False,
        "_matches": set(),
        "_innings_scores": defaultdict(int),
        "total_runs": 0,
        "matches": 0,
        "best_score": 0,
        "vs_fast": 0,
        "vs_spin": 0,
        "vs_unknown_bowling": 0,
        "by_ground": defaultdict(int),
        "by_batting_position": defaultdict(int),
        "by_opposition": defaultdict(int),
    }


def make_bowler_record(player: dict) -> dict:
    return {
        "role": player["role"],
        "batting_style": player["batting_style"],
        "bowling_style": player["bowling_style"],
        "bowling_type": player["bowling_type"],
        "has_ipl_data": False,
        "_matches": set(),
        "_spell_stats": defaultdict(lambda: {"wickets": 0, "runs_conceded": 0}),
        "balls_bowled": 0,
        "total_wickets": 0,
        "matches": 0,
        "best_bowling": {"wickets": 0, "runs_conceded": 0},
        "vs_right_handed": 0,
        "vs_left_handed": 0,
        "vs_unknown_handed": 0,
        "balls_by_phase": {
            "powerplay": 0,
            "middle_overs": 0,
            "death_overs": 0,
        },
        "wickets_by_phase": {
            "powerplay": 0,
            "middle_overs": 0,
            "death_overs": 0,
        },
        "by_ground": defaultdict(int),
        "by_opposition": defaultdict(int),
    }


def make_fielder_record(player: dict) -> dict:
    return {
        "role": player["role"],
        "batting_style": player["batting_style"],
        "bowling_style": player["bowling_style"],
        "has_ipl_fielding_data": False,
        "catches": 0,
        "stumpings": 0,
    }


def finalize_records(records: Dict[str, dict]) -> Dict[str, dict]:
    finalized: Dict[str, dict] = {}
    for player_name in sorted(records):
        payload = dict(records[player_name])
        if "_matches" in payload:
            payload["matches"] = len(payload["_matches"])
            del payload["_matches"]
        if "_innings_scores" in payload:
            payload["best_score"] = max(payload["_innings_scores"].values(), default=0)
            del payload["_innings_scores"]
        if "_spell_stats" in payload:
            best = {"wickets": 0, "runs_conceded": 0}
            for spell in payload["_spell_stats"].values():
                if spell["wickets"] > best["wickets"]:
                    best = dict(spell)
                elif spell["wickets"] == best["wickets"] and (
                    best["wickets"] == 0 or spell["runs_conceded"] < best["runs_conceded"]
                ):
                    best = dict(spell)
            payload["best_bowling"] = best
            del payload["_spell_stats"]
        if "by_ground" in payload:
            payload["by_ground"] = dict(sorted(payload["by_ground"].items()))
        if "by_batting_position" in payload:
            payload["by_batting_position"] = dict(sorted(payload["by_batting_position"].items()))
        if "by_opposition" in payload:
            payload["by_opposition"] = dict(sorted(payload["by_opposition"].items()))
        finalized[player_name] = payload
    return finalized


def batting_position_label(bat_pos_value: Optional[str]) -> str:
    bat_pos = to_int(bat_pos_value)
    if bat_pos in (1, 2):
        return "opening"
    if bat_pos >= 3:
        return f"{bat_pos - 2}_down"
    return "unknown_position"


def bowling_phase_label(over_value: Optional[str]) -> str:
    over_number = to_int(over_value) + 1
    if over_number <= 6:
        return "powerplay"
    if over_number <= 14:
        return "middle_overs"
    return "death_overs"


def generate_analytics(csv_path: Path, players_path: Path) -> dict:
    players, alias_map, surname_map = load_players(players_path)

    batsmen: Dict[str, dict] = {}
    bowlers: Dict[str, dict] = {}
    fielders: Dict[str, dict] = {}
    batter_vs_bowler: Dict[str, Dict[str, dict]] = defaultdict(dict)
    bowler_vs_batter: Dict[str, Dict[str, dict]] = defaultdict(dict)

    for player in players.values():
        fielders[player["full_name"]] = make_fielder_record(player)
        role_key = normalize_key(player["role"])
        if role_key in BATSMAN_ROLES:
            batsmen[player["full_name"]] = make_batsman_record(player)
        if role_key in BOWLER_ROLES:
            bowlers[player["full_name"]] = make_bowler_record(player)

    stats = Counter()

    with csv_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)

        for row in reader:
            stats["rows_processed"] += 1

            batter_name = clean_text(row.get("batter"))
            bowler_name = clean_text(row.get("bowler"))
            player_out_name = clean_text(row.get("player_out"))
            venue = clean_text(row.get("venue")) or "Unknown Venue"
            match_id = clean_text(row.get("match_id"))
            match_date = clean_text(row.get("date"))
            innings = clean_text(row.get("innings"))
            batting_team = clean_text(row.get("batting_team")) or "Unknown Team"
            bowling_team = clean_text(row.get("bowling_team")) or "Unknown Team"
            innings_key = f"{match_id}:{innings}" if match_id else innings

            batter = resolve_player(batter_name, alias_map, surname_map, players, "batter")
            bowler = resolve_player(bowler_name, alias_map, surname_map, players, "bowler")
            player_out = resolve_player(player_out_name, alias_map, surname_map, players, "player_out")

            if batter_name and not batter:
                stats["unresolved_batter_rows"] += 1
            if bowler_name and not bowler:
                stats["unresolved_bowler_rows"] += 1
            if player_out_name and not player_out:
                stats["unresolved_player_out_rows"] += 1

            runs_batter = to_int(row.get("runs_batter"))
            batter_score = to_int(row.get("batter_runs"))

            if batter and bowler:
                batter_matchup = batter_vs_bowler[batter].setdefault(
                    bowler,
                    {
                        "runs": 0,
                        "outs": 0,
                        "dismissal_events": [],
                    },
                )
                bowler_matchup = bowler_vs_batter[bowler].setdefault(
                    batter,
                    {
                        "runs_conceded": 0,
                        "wickets": 0,
                        "dismissal_events": [],
                    },
                )
                batter_matchup["runs"] += runs_batter
                bowler_matchup["runs_conceded"] += runs_batter

            if batter and batter in batsmen:
                batsmen[batter]["has_ipl_data"] = True
                if match_id:
                    batsmen[batter]["_matches"].add(match_id)
                batsmen[batter]["total_runs"] += runs_batter
                batsmen[batter]["_innings_scores"][innings_key] += runs_batter
                batsmen[batter]["by_ground"][venue] += runs_batter
                batsmen[batter]["by_batting_position"][batting_position_label(row.get("bat_pos"))] += runs_batter
                batsmen[batter]["by_opposition"][bowling_team] += runs_batter

                bowling_type = "unknown"
                if bowler:
                    bowling_type = players[bowler]["bowling_type"]
                    if bowling_type == "unknown":
                        bowling_type = supplemental_bowling_type(bowler_name)
                elif bowler_name:
                    bowling_type = supplemental_bowling_type(bowler_name)

                if bowling_type == "fast":
                    batsmen[batter]["vs_fast"] += runs_batter
                elif bowling_type == "spin":
                    batsmen[batter]["vs_spin"] += runs_batter
                else:
                    batsmen[batter]["vs_unknown_bowling"] += runs_batter

            wicket_kind = normalize_key(row.get("wicket_kind", ""))

            raw_fielders = [
                clean_text(name)
                for name in clean_text(row.get("fielders")).split(",")
                if clean_text(name)
            ]
            resolved_fielders = []
            for fielder_name in raw_fielders:
                resolved_fielder = resolve_player(
                    fielder_name,
                    alias_map,
                    surname_map,
                    players,
                    "fielder",
                )
                if resolved_fielder:
                    resolved_fielders.append(resolved_fielder)

            if wicket_kind == "caught":
                for resolved_fielder in set(resolved_fielders):
                    fielders[resolved_fielder]["has_ipl_fielding_data"] = True
                    fielders[resolved_fielder]["catches"] += 1
            elif wicket_kind == "caught and bowled" and bowler and bowler in fielders:
                fielders[bowler]["has_ipl_fielding_data"] = True
                fielders[bowler]["catches"] += 1
            elif wicket_kind == "stumped":
                for resolved_fielder in set(resolved_fielders):
                    fielders[resolved_fielder]["has_ipl_fielding_data"] = True
                    fielders[resolved_fielder]["stumpings"] += 1

            if wicket_kind in EXCLUDED_WICKET_KINDS:
                continue

            dismissal_counts_for_bowler = False
            if batter_name and player_out_name:
                if normalize_key(player_out_name) == normalize_key(batter_name):
                    dismissal_counts_for_bowler = True
                elif batter and player_out and batter == player_out:
                    dismissal_counts_for_bowler = True

            if bowler and bowler in bowlers:
                bowlers[bowler]["has_ipl_data"] = True
                if match_id:
                    bowlers[bowler]["_matches"].add(match_id)
                if to_int(row.get("valid_ball")) == 1:
                    bowlers[bowler]["balls_bowled"] += 1
                    phase = bowling_phase_label(row.get("over"))
                    bowlers[bowler]["balls_by_phase"][phase] += 1
                bowlers[bowler]["_spell_stats"][innings_key]["runs_conceded"] += to_int(row.get("runs_bowler"))

            if dismissal_counts_for_bowler and bowler and bowler in bowlers:
                bowlers[bowler]["has_ipl_data"] = True
                bowlers[bowler]["total_wickets"] += 1
                phase = bowling_phase_label(row.get("over"))
                bowlers[bowler]["wickets_by_phase"][phase] += 1
                bowlers[bowler]["by_ground"][venue] += 1
                bowlers[bowler]["by_opposition"][batting_team] += 1
                bowlers[bowler]["_spell_stats"][innings_key]["wickets"] += 1

                if batter:
                    batting_type = players[batter]["batting_type"]
                    if batting_type == "unknown":
                        batting_type = supplemental_batting_type(player_out_name or batter_name)
                    if batting_type == "right":
                        bowlers[bowler]["vs_right_handed"] += 1
                    elif batting_type == "left":
                        bowlers[bowler]["vs_left_handed"] += 1
                    else:
                        bowlers[bowler]["vs_unknown_handed"] += 1
                else:
                    batting_type = supplemental_batting_type(player_out_name or batter_name)
                    if batting_type == "right":
                        bowlers[bowler]["vs_right_handed"] += 1
                    elif batting_type == "left":
                        bowlers[bowler]["vs_left_handed"] += 1
                    else:
                        bowlers[bowler]["vs_unknown_handed"] += 1

                if batter:
                    dismissal_event = {
                        "match_id": match_id,
                        "date": match_date,
                        "venue": venue,
                        "innings": innings,
                        "over": to_int(row.get("over")) + 1,
                        "ball_no": clean_text(row.get("ball_no")),
                        "wicket_kind": clean_text(row.get("wicket_kind")),
                        "batter_score_at_dismissal": batter_score,
                    }
                    batter_vs_bowler[batter][bowler]["outs"] += 1
                    batter_vs_bowler[batter][bowler]["dismissal_events"].append(dismissal_event)
                    bowler_vs_batter[bowler][batter]["wickets"] += 1
                    bowler_vs_batter[bowler][batter]["dismissal_events"].append(dismissal_event)

    analytics = {
        "batsmen": finalize_records(batsmen),
        "bowlers": finalize_records(bowlers),
        "fielders": finalize_records(fielders),
        "metadata": {
            "source_csv": str(csv_path),
            "source_players_json": str(players_path),
            "rows_processed": stats["rows_processed"],
            "player_registry_count": len(players),
            "eligible_batsmen_count": len(batsmen),
            "eligible_bowlers_count": len(bowlers),
            "unresolved_batter_rows": stats["unresolved_batter_rows"],
            "unresolved_bowler_rows": stats["unresolved_bowler_rows"],
            "unresolved_player_out_rows": stats["unresolved_player_out_rows"],
        },
    }

    all_rounders: Dict[str, dict] = {}
    for player in players.values():
        if normalize_key(player["role"]) != "all-rounder":
            continue

        player_name = player["full_name"]
        batting_payload = analytics["batsmen"].get(player_name, {})
        bowling_payload = analytics["bowlers"].get(player_name, {})
        fielding_payload = analytics["fielders"].get(player_name, {})

        all_rounders[player_name] = {
            "role": player["role"],
            "batting_style": player["batting_style"],
            "bowling_style": player["bowling_style"],
            "batting": batting_payload,
            "bowling": bowling_payload,
            "fielding": fielding_payload,
        }

    analytics["all_rounders"] = finalize_records(all_rounders)

    no_data_players = []
    for player_name in sorted(players):
        has_batting = analytics["batsmen"].get(player_name, {}).get("has_ipl_data", False)
        has_bowling = analytics["bowlers"].get(player_name, {}).get("has_ipl_data", False)
        has_fielding = analytics["fielders"].get(player_name, {}).get("has_ipl_fielding_data", False)
        if not (has_batting or has_bowling or has_fielding):
            no_data_players.append(player_name)

    analytics["metadata"]["no_data_players_count"] = len(no_data_players)
    analytics["metadata"]["no_data_players"] = no_data_players
    matchups = {
        "batters": {
            batter_name: {
                bowler_name: payload
                for bowler_name, payload in sorted(opponents.items())
            }
            for batter_name, opponents in sorted(batter_vs_bowler.items())
        },
        "bowlers": {
            bowler_name: {
                batter_name: payload
                for batter_name, payload in sorted(opponents.items())
            }
            for bowler_name, opponents in sorted(bowler_vs_batter.items())
        },
    }
    return analytics, matchups


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--csv",
        default=str(DATA_DIR / "IPL.csv"),
        help="Path to the IPL ball-by-ball CSV file.",
    )
    parser.add_argument(
        "--players",
        default=str(DATA_DIR / "players.json"),
        help="Path to the player registry JSON file.",
    )
    parser.add_argument(
        "--output",
        default=str(DATA_DIR / "ipl_player_analytics.json"),
        help="Path to write the analytics JSON output.",
    )
    parser.add_argument(
        "--matchup-output",
        default=str(DATA_DIR / "ipl_player_matchups.json"),
        help="Path to write the player-vs-player matchup JSON output.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    csv_path = Path(args.csv).expanduser().resolve()
    players_path = Path(args.players).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()

    analytics, matchups = generate_analytics(csv_path, players_path)

    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(analytics, handle, indent=2, ensure_ascii=True)

    matchup_output_path = Path(args.matchup_output).expanduser().resolve()
    with matchup_output_path.open("w", encoding="utf-8") as handle:
        json.dump(matchups, handle, indent=2, ensure_ascii=True)

    print(f"Wrote analytics JSON to {output_path}")
    print(f"Wrote matchup JSON to {matchup_output_path}")
    print(
        "Summary:",
        json.dumps(
            analytics["metadata"],
            indent=2,
            ensure_ascii=True,
        ),
    )


if __name__ == "__main__":
    main()
