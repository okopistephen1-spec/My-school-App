import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app as app_module
import database


class MusicDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = database.DB_PATH
        database.DB_PATH = str(Path(self.temp_dir.name) / "music.sqlite")
        database.create_songs_table()
        database.add_song(
            "Blue in Green",
            "Miles Davis",
            "Jazz",
            "static/songs/blue-in-green.mp3",
        )

        self.original_limiter_enabled = app_module.limiter.enabled
        app_module.limiter.enabled = False
        app_module.app.config.update(TESTING=True, RATELIMIT_ENABLED=False)
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.limiter.enabled = self.original_limiter_enabled
        database.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def test_homepage_renders_discovery_sections_and_track_table(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        page = response.get_data(as_text=True)
        for expected in (
            'id="jump-back-grid"',
            'id="curated-grid"',
            'id="songs-container"',
            "Rank",
            "Title &amp; Artist",
            "Album",
            "Added",
            "Duration",
            "listening-panel",
        ):
            self.assertIn(expected, page)
        for illustrative_detail in ("Julian Vance", "Midnight Velvet", "Hi-Res", "Studio DAC"):
            self.assertNotIn(illustrative_detail, page)

    def test_search_finds_local_tracks_by_title_and_artist(self):
        with (
            patch.object(app_module, "_jamendo_search", return_value=([], None)),
            patch.object(app_module, "_audius_search", return_value=([], None)),
        ):
            title_results = self.client.get("/api/search?q=Blue%20in%20Green").get_json()
            artist_results = self.client.get("/api/search?q=Miles%20Davis").get_json()

        self.assertEqual([song["title"] for song in title_results["songs"]], ["Blue in Green"])
        self.assertEqual([song["artist"] for song in artist_results["songs"]], ["Miles Davis"])
        self.assertEqual(title_results["songs"][0]["audio"], "/static/songs/blue-in-green.mp3")

    def test_search_includes_provider_tracks_without_exposing_credentials(self):
        provider_song = {
            "id": "track-1",
            "source": "jamendo",
            "title": "Green Light",
            "artist": "Sample Artist",
            "album": "Sample Album",
            "audio": "https://audio.example.test/track.mp3",
            "duration": 210,
        }
        with (
            patch.object(app_module, "_jamendo_search", return_value=([provider_song], None)),
            patch.object(app_module, "_audius_search", return_value=([], None)),
        ):
            response = self.client.get("/api/search?q=Green%20Light")

        self.assertEqual(response.status_code, 200)
        result = response.get_json()["songs"][0]
        self.assertEqual(result["title"], "Green Light")
        self.assertEqual(result["source"], "jamendo")
        self.assertNotIn("client_id", response.get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
