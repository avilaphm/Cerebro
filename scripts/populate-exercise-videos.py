#!/usr/bin/env python3
"""
Populate video_url for all pt_exercises that currently have none.
Uses yt-dlp (no API quota) + curl for Supabase HTTP calls.
"""

import json
import subprocess
import sys
import time

SUPABASE_URL = "https://otcnrkfvgyvwolironoz.supabase.co"


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
    queries = [
        f"{exercise_name} exercise short form",
        f"{exercise_name} exercise tutorial",
    ]
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
