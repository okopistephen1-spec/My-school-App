import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app as app_module
import database


class JsonResponse:
    def __init__(self, payload, status_code=200):
        self.payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise app_module.requests.HTTPError(response=self)

    def json(self):
        return self.payload


class PlayerPageTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = database.DB_PATH
        self.original_download_dir = app_module.app.config["DOWNLOADS_DIR"]
        self.original_jamendo_client_id = app_module.JAMENDO_CLIENT_ID
        database.DB_PATH = str(Path(self.temp_dir.name) / "music.sqlite")
        app_module.app.config["DOWNLOADS_DIR"] = Path(self.temp_dir.name) / "downloads"
        app_module.JAMENDO_CLIENT_ID = "test-client-id"
        database.create_songs_table()
        database.initialize_auth_tables()
        database.initialize_music_tables()
        database.add_song("Blue in Green", "Miles Davis", "Jazz", "static/songs/blue-in-green.mp3")
        self.original_limiter_enabled = app_module.limiter.enabled
        app_module.limiter.enabled = False
        app_module.app.config.update(TESTING=True, RATELIMIT_ENABLED=False)
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.limiter.enabled = self.original_limiter_enabled
        app_module.app.config["DOWNLOADS_DIR"] = self.original_download_dir
        app_module.JAMENDO_CLIENT_ID = self.original_jamendo_client_id
        database.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def library_scope(self):
        self.client.get("/api/library")
        with self.client.session_transaction() as session:
            return session["library_scope"]

    def test_player_page_and_local_track_load_from_existing_song_record(self):
        page = self.client.get(
            "/player/local/1",
            headers={"Referer": "http://localhost/search?q=Miles%20Davis"},
        )
        self.assertEqual(page.status_code, 200)
        html = page.get_data(as_text=True)
        self.assertIn('data-page="player"', html)
        self.assertIn('data-player-source="local"', html)
        self.assertIn('data-player-id="1"', html)
        self.assertIn('href="/search?q=Miles%20Davis"', html)
        self.assertIn('id="detail-art"', html)
        self.assertIn('id="detail-play-button"', html)

        track = self.client.get("/api/player/local/1")
        self.assertEqual(track.status_code, 200)
        self.assertEqual(
            track.get_json(),
            {
                "id": "1",
                "source": "local",
                "title": "Blue in Green",
                "artist": "Miles Davis",
                "genre": "Jazz",
                "album": None,
                "image": None,
                "audio": "/static/songs/blue-in-green.mp3",
                "duration": None,
            },
        )
        self.assertEqual(self.client.get("/api/player/local/999").status_code, 404)

    def test_jamendo_track_details_are_loaded_server_side_without_exposing_credentials(self):
        provider_track = {
            "id": "123",
            "name": "Green Light",
            "artist_name": "Sample Artist",
            "album_name": "Sample Album",
            "image": "https://images.example.test/art.jpg",
            "audio": "https://audio.example.test/track.mp3",
            "duration": 210,
            "releasedate": "2021-08-03",
            "audiodownload_allowed": True,
            "musicinfo": {"tags": {"genres": ["Electronic", "Ambient"]}},
        }
        with patch.object(
            app_module.requests,
            "get",
            return_value=JsonResponse({"results": [provider_track]}),
        ) as get:
            response = self.client.get("/api/player/jamendo/123")

        self.assertEqual(response.status_code, 200)
        track = response.get_json()
        self.assertEqual(track["title"], "Green Light")
        self.assertEqual(track["artist"], "Sample Artist")
        self.assertEqual(track["album"], "Sample Album")
        self.assertEqual(track["genre"], "Electronic, Ambient")
        self.assertEqual(track["year"], "2021")
        self.assertEqual(track["audio"], "https://audio.example.test/track.mp3")
        self.assertTrue(track["download_allowed"])
        self.assertNotIn("test-client-id", response.get_data(as_text=True))
        get.assert_called_once()

    def test_downloaded_jamendo_track_uses_its_saved_local_audio(self):
        scope = self.library_scope()
        filename = "0123456789abcdef0123456789abcdef.mp3"
        database.start_download(scope, "jamendo", "123", "Saved Track", "Saved Artist", None, None, filename)
        app_module.app.config["DOWNLOADS_DIR"].mkdir(parents=True, exist_ok=True)
        (app_module.app.config["DOWNLOADS_DIR"] / filename).write_bytes(b"ID3test")
        database.complete_download(scope, "jamendo", "123", "audio/mpeg")

        with patch.object(app_module.requests, "get") as get:
            response = self.client.get("/api/player/jamendo/123")

        self.assertEqual(response.status_code, 200)
        track = response.get_json()
        self.assertEqual(track["title"], "Saved Track")
        self.assertEqual(track["audio"], "/api/downloads/1/audio")
        self.assertEqual(track["download_status"], "complete")
        get.assert_not_called()
        audio_response = self.client.get(track["audio"])
        self.assertEqual(audio_response.data, b"ID3test")
        audio_response.close()

    def test_download_player_route_is_limited_to_the_current_library_scope(self):
        scope = self.library_scope()
        filename = "fedcba9876543210fedcba9876543210.mp3"
        database.start_download(scope, "jamendo", "456", "Scoped Track", "Test Artist", None, None, filename)
        app_module.app.config["DOWNLOADS_DIR"].mkdir(parents=True, exist_ok=True)
        (app_module.app.config["DOWNLOADS_DIR"] / filename).write_bytes(b"ID3test")
        database.complete_download(scope, "jamendo", "456", "audio/mpeg")

        self.assertEqual(self.client.get("/api/player/download/1").status_code, 200)
        other_client = app_module.app.test_client()
        self.assertEqual(other_client.get("/api/player/download/1").status_code, 404)

    def test_external_referrer_cannot_override_the_player_back_destination(self):
        page = self.client.get(
            "/player/local/1",
            headers={"Referer": "https://attacker.example/redirect"},
        )
        self.assertEqual(page.status_code, 200)
        self.assertIn('data-player-back-url="/"', page.get_data(as_text=True))

    def test_local_track_responses_do_not_expose_paths_outside_static_storage(self):
        private_file = Path(self.temp_dir.name) / "private-track.mp3"
        database.add_song("Private Path", "Test Artist", None, str(private_file))

        response = self.client.get("/api/player/local/2")
        local_tracks = self.client.get("/api/songs").get_json()

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.get_json()["audio"])
        self.assertNotIn(str(private_file), response.get_data(as_text=True))
        self.assertNotIn("file_path", local_tracks[0])

    def test_invalid_provider_track_ids_are_rejected(self):
        for path in ("/api/player/jamendo/1%2F2", "/api/player/audius/https%3A%2F%2Fexample.test"):
            self.assertIn(self.client.get(path).status_code, (404, 400))


if __name__ == "__main__":
    unittest.main()
