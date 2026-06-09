#!/usr/bin/env python3
"""
Populate video_url for all pt_exercises that currently have none.
Uses yt-dlp (no API quota) + curl for Supabase HTTP calls.
"""

import json
import re
import subprocess
import sys
import time

SUPABASE_URL = "https://otcnrkfvgyvwolironoz.supabase.co"

FALLBACK_SEARCH_QUERIES = {
    "Back Extension Machine SIDEWAYS (QL / oblique - Pedro specialty)": [
        "sideways back extension oblique exercise",
        "side bend back extension machine exercise",
    ],
    "Back Squat (tempo 3-2-2-0)": ["barbell back squat exercise tutorial"],
    "Barbell Heel-Elevated Squat (ankle limitation option - Pedro)": [
        "barbell heel elevated squat exercise tutorial",
        "heels elevated barbell squat exercise",
    ],
    "Barbell RDL (tempo 3-2-2-0)": ["barbell Romanian deadlift exercise tutorial"],
    "Barbell Reverse Lunge (Pedro staple)": ["barbell reverse lunge exercise tutorial"],
    "Barbell Tempo Squat (3-2-2-0 ramp-up)": ["barbell tempo squat exercise tutorial"],
    "Bodyweight Cossack Squat (assisted to unassisted - Pedro)": [
        "bodyweight cossack squat exercise tutorial",
        "assisted cossack squat exercise",
    ],
    "Goblet Squat (Phase 1 beginner staple - Pedro)": ["goblet squat exercise tutorial"],
    "Half-Kneeling Adductor Slide (exhale at end range - Pedro)": [
        "half kneeling adductor slide exercise",
        "adductor slide exercise tutorial",
    ],
    "Jefferson Curl (hold 5s, exhale to relax - Pedro)": ["jefferson curl exercise tutorial"],
    "Kettlebell Cossack Squat (progress assisted to loaded - Pedro)": [
        "kettlebell cossack squat exercise tutorial"
    ],
    "Single-Arm Lat Pulldown (seated, lean to working side, stretch the lat - Pedro's cue)": [
        "single arm lat pulldown exercise tutorial",
        "single arm cable lat pulldown exercise",
    ],
    "Single-Leg Cable RDL (hip strength individually - Pedro)": [
        "single leg cable Romanian deadlift exercise tutorial",
        "single leg cable RDL exercise",
    ],
    "Standing Calf Raise (bilateral, full ROM, squeeze top & bottom - Pedro)": [
        "standing calf raise exercise tutorial"
    ],
}


def curl_get(path, service_key):
    result = subprocess.run(
        ["curl", "-s",
         "-H", f"apikey: {service_key}",
         "-H", f"Authorization: Bearer {service_key}",
         f"{SUPABASE_URL}{path}"],
        capture_output=True, text=True, timeout=15,
    )
    return json.loads(result.stdout)


def curl_patch(path, data, service_key):
    result = subprocess.run(
        ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
         "-X", "PATCH",
         "-H", f"apikey: {service_key}",
         "-H", f"Authorization: Bearer {service_key}",
         "-H", "Content-Type: application/json",
         "-H", "Prefer: return=minimal",
         "-d", json.dumps(data),
         f"{SUPABASE_URL}{path}"],
        capture_output=True, text=True, timeout=15,
    )
    return result.stdout.strip()


def search_youtube(exercise_name):
    base_name = re.sub(r"\([^)]*\)", "", exercise_name).strip()
    expanded_name = re.sub(r"\bRDL\b", "Romanian deadlift", base_name, flags=re.IGNORECASE)
    queries = [
        f"{exercise_name} exercise short form",
        f"{exercise_name} exercise tutorial",
        f"{base_name} exercise tutorial",
        f"{expanded_name} exercise tutorial",
        *FALLBACK_SEARCH_QUERIES.get(exercise_name, []),
    ]
    queries = list(dict.fromkeys(query for query in queries if query.strip()))
    for query in queries:
        try:
            result = subprocess.run(
                ["yt-dlp", f"ytsearch1:{query}",
                 "--print", "webpage_url",
                 "--skip-download", "--quiet"],
                capture_output=True, text=True, timeout=25,
            )
            url = result.stdout.strip()
            if url.startswith("https://"):
                return url
        except (subprocess.TimeoutExpired, Exception):
            continue
    return None


def main():
    if len(sys.argv) < 2:
        print("Usage: python populate-exercise-videos.py <SERVICE_ROLE_KEY>")
        sys.exit(1)

    service_key = sys.argv[1]

    print("Fetching exercises with no video...")
    exercises = curl_get(
        "/rest/v1/pt_exercises?select=id,name&video_url=is.null&order=name.asc",
        service_key,
    )

    total = len(exercises)
    print(f"Found {total} exercises missing a video URL\n")

    populated = 0
    failed = []

    for i, ex in enumerate(exercises, 1):
        name = ex["name"]
        ex_id = ex["id"]
        print(f"[{i}/{total}] {name} ...", end=" ", flush=True)

        url = search_youtube(name)
        if url:
            status = curl_patch(
                f"/rest/v1/pt_exercises?id=eq.{ex_id}",
                {"video_url": url},
                service_key,
            )
            if status in ("200", "204"):
                print(f"✓  {url}")
                populated += 1
            else:
                print(f"✗  Supabase write failed (status {status})")
                failed.append(name)
        else:
            print("✗  No video found")
            failed.append(name)

        time.sleep(0.4)

    print(f"\n{'='*60}")
    print(f"Done. Populated: {populated}/{total}")
    if failed:
        print(f"\nFailed ({len(failed)}):")
        for f in failed:
            print(f"  - {f}")


if __name__ == "__main__":
    main()
