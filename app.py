import os
import requests

from flask import Flask, render_template, jsonify
from database import get_all_songs
from dotenv import load_dotenv


load_dotenv()

JAMENDO_CLIENT_ID = os.getenv("JAMENDO_CLIENT_ID")

app = Flask(__name__)


@app.route("/")
def home():
    return render_template("index.html", page="home")


@app.route("/player/<source>/<track_id>")
def player(source, track_id):
    if source not in {"jamendo", "audius", "local"}:
        return render_template("index.html", page="home"), 404
    return render_template(
        "index.html",
        page="player",
        player_source=source,
        player_track_id=track_id,
    )


@app.route("/api/songs")
def songs_api():
    songs = get_all_songs()

    song_list = []

    for song in songs:
        song_data = {
            "id": song[0],
            "title": song[1],
            "artist": song[2],
            "genre": song[3],
            "file_path": song[4]
        }

        song_list.append(song_data)

    return jsonify(song_list)

@app.route("/api/jamendo/tracks")
def jamendo_tracks():
    url = "https://api.jamendo.com/v3.0/tracks/"

    params = {
        "client_id": JAMENDO_CLIENT_ID,
        "format": "json",
        "limit": 10,
        "audioformat": "mp31",
        "imagesize": 300
    }

    try:
        response = requests.get(url, params=params, timeout=15)
        response.raise_for_status()

        data = response.json()

        return jsonify(data)

    except requests.RequestException:
        return jsonify({
            "error": "Unable to connect to Jamendo right now."
        }), 502


@app.route("/api/jamendo/songs")
def jamendo_songs():
    url = "https://api.jamendo.com/v3.0/tracks/"

    params = {
        "client_id": JAMENDO_CLIENT_ID,
        "format": "json",
        "limit": 40,
        "audioformat": "mp31",
        "imagesize": 300
    }

    try:
        response = requests.get(url, params=params, timeout=15)
        response.raise_for_status()

        data = response.json()

        songs = []

        for track in data.get("results", []):
            music_info = track.get("musicinfo")
            tags = music_info.get("tags") if isinstance(music_info, dict) else {}
            genres = tags.get("genres") if isinstance(tags, dict) else []
            song = {
                "id": track.get("id"),
                "source": "jamendo",
                "title": track.get("name"),
                "artist": track.get("artist_name"),
                "album": track.get("album_name"),
                "image": track.get("image"),
                "audio": track.get("audio"),
                "duration": track.get("duration"),
                "genre": ", ".join(genre for genre in genres[:3] if isinstance(genre, str))
                    if isinstance(genres, list) else None,
                "year": track.get("releasedate", "")[:4]
                    if isinstance(track.get("releasedate"), str) else None,
                "download_allowed": track.get("audiodownload_allowed"),
                "share_url": track.get("shareurl")
            }

            songs.append(song)

        return jsonify(songs)

    except requests.RequestException:
        return jsonify({
            "error": "Unable to retrieve songs from Jamendo."
        }), 502


@app.route("/api/audius/songs")
def audius_songs():
    url = "https://api.audius.co/v1/tracks/search"

    params = {
        "query": "afrobeats",
        "limit": 60
    }

    try:
        response = requests.get(url, params=params, timeout=15)
        response.raise_for_status()

        data = response.json()
        songs = []

        for track in data.get("data", []):
            if not track.get("is_streamable"):
                continue

            song = {
                "id": track.get("id"),
                "source": "audius",
                "title": track.get("title"),
                "artist": track.get("user", {}).get("name"),
                "album": None,
                "image": track.get("artwork", {}).get("150x150")
                    if track.get("artwork") else None,
                "audio": track.get("stream", {}).get("url"),
                "duration": track.get("duration"),
                "genre": track.get("genre"),
                "download_allowed": False,
                "share_url": track.get("permalink")
            }

            songs.append(song)

        return jsonify(songs)

    except requests.RequestException:
        return jsonify({
            "error": "Unable to retrieve songs from Audius."
        }), 502


if __name__ == "__main__":
    app.run(debug=True)