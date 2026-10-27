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


class AudioResponse:
    def __init__(self, content=b"ID3\x04\x00\x00test audio"):
        self.status_code = 200
        self.headers = {"Content-Type": "audio/mpeg", "Content-Length": str(len(content))}
        self.content = content
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        self.closed = True

    def raise_for_status(self):
        return None

    def iter_content(self, chunk_size):
        for offset in range(0, len(self.content), chunk_size):
            yield self.content[offset:offset + chunk_size]


class DownloadAndLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = database.DB_PATH
        self.original_download_dir = app_module.app.config["DOWNLOADS_DIR"]
        self.original_jamendo_client_id = app_module.JAMENDO_CLIENT_ID
        database.DB_PATH = str(Path(self.temp_dir.name) / "music.sqlite")
        app_module.app.config["DOWNLOADS_DIR"] = Path(self.temp_dir.name) / "persistent-downloads"
        app_module.JAMENDO_CLIENT_ID = "test-jamendo-client"
        database.create_songs_table()
        database.initialize_auth_tables()
        database.initialize_music_tables()

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

    def csrf_headers(self):
        token = self.client.get("/api/csrf").get_json()["csrf_token"]
        return {"X-CSRFToken": token, "Content-Type": "application/json"}

    def library_scope(self):
        with self.client.session_transaction() as session:
            return session["library_scope"]

    @staticmethod
    def jamendo_track(download_allowed=True, url="https://mp3d.jamendo.com/?trackid=123"):
        return {
            "id": "123",
            "name": "Allowed Track",
            "artist_name": "Test Artist",
            "album_name": "Test Album",
            "image": "https://images.example.test/art.jpg",
            "audiodownload_allowed": download_allowed,
            "audiodownload": url,
        }

    def test_sidebar_routes_and_download_page_render(self):
        for path, expected_page in (
            ("/", "home"),
            ("/discover", "discover"),
            ("/search", "search"),
            ("/downloads", "downloads"),
            ("/library", "library"),
        ):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn(f'data-page="{expected_page}"', response.get_data(as_text=True))
        page = self.client.get("/downloads").get_data(as_text=True)
        for label in ("Home", "Discover", "Search", "Downloads", "Library"):
            self.assertIn(label, page)
        self.assertIn("No downloads yet.", page)
        self.assertIn("Liked Songs", page)
        self.assertIn("Recently Played", page)
        self.assertIn("Playlists", page)

    def test_eligible_download_is_persisted_playable_and_duplicate_safe(self):
        audio_response = AudioResponse()
        with patch.object(
            app_module.requests,
            "get",
            side_effect=[
                JsonResponse({"results": [self.jamendo_track()]}),
                audio_response,
            ],
        ) as get:
            response = self.client.post(
                "/api/downloads",
                json={"source": "jamendo", "track_id": "123"},
                headers=self.csrf_headers(),
            )
            duplicate = self.client.post(
                "/api/downloads",
                json={"source": "jamendo", "track_id": "123"},
                headers=self.csrf_headers(),
            )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(duplicate.status_code, 200)
        self.assertEqual(get.call_count, 2)
        self.assertTrue(audio_response.closed)
        self.assertEqual(response.get_json()["download"]["title"], "Allowed Track")

        records = database.list_downloads(self.library_scope())
        self.assertEqual(len(records), 1)
        stored_file = app_module.app.config["DOWNLOADS_DIR"] / records[0]["file_name"]
        self.assertTrue(stored_file.is_file())

        downloads = self.client.get("/api/downloads")
        self.assertEqual(downloads.status_code, 200)
        self.assertEqual(len(downloads.get_json()), 1)
        audio = self.client.get(downloads.get_json()[0]["audio"])
        self.assertEqual(audio.status_code, 200)
        self.assertEqual(audio.data, b"ID3\x04\x00\x00test audio")
        audio.close()

        restarted_client = app_module.app.test_client()
        restarted_client.set_cookie("session", self.client.get_cookie("session").value)
        persisted = restarted_client.get("/api/downloads")
        self.assertEqual(len(persisted.get_json()), 1)

        with restarted_client.session_transaction() as session:
            session["user_id"] = 999
        self.assertEqual(restarted_client.get("/api/downloads").get_json(), [])
        self.assertEqual(restarted_client.get(downloads.get_json()[0]["audio"]).status_code, 404)

    def test_ineligible_tracks_and_arbitrary_sources_are_rejected(self):
        with patch.object(
            app_module.requests,
            "get",
            return_value=JsonResponse({"results": [self.jamendo_track(download_allowed=False)]}),
        ) as get:
            rejected = self.client.post(
                "/api/downloads",
                json={"source": "jamendo", "track_id": "123"},
                headers=self.csrf_headers(),
            )
        self.assertEqual(rejected.status_code, 403)
        self.assertIn("not available for download", rejected.get_json()["error"])
        self.assertEqual(get.call_count, 1)

        with patch.object(app_module.requests, "get") as get:
            arbitrary = self.client.post(
                "/api/downloads",
                json={"source": "audius", "track_id": "https://attacker.example/file"},
                headers=self.csrf_headers(),
            )
        self.assertEqual(arbitrary.status_code, 400)
        get.assert_not_called()
        self.assertEqual(database.list_downloads(self.library_scope()), [])

    def test_invalid_audio_response_is_not_marked_complete(self):
        bad_response = AudioResponse(b"<html>not an audio file</html>")
        bad_response.headers["Content-Type"] = "text/html"
        with patch.object(
            app_module.requests,
            "get",
            side_effect=[
                JsonResponse({"results": [self.jamendo_track()]}),
                bad_response,
            ],
        ):
            response = self.client.post(
                "/api/downloads",
                json={"source": "jamendo", "track_id": "123"},
                headers=self.csrf_headers(),
            )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(self.client.get("/api/downloads").get_json(), [])
        self.assertEqual(database.get_download(self.library_scope(), "jamendo", "123")["status"], "failed")
        self.assertEqual(list(app_module.app.config["DOWNLOADS_DIR"].glob("*.mp3")), [])

    def test_external_redirect_is_rejected_before_following(self):
        redirect_response = AudioResponse()
        redirect_response.status_code = 302
        redirect_response.headers = {"Location": "http://127.0.0.1/private"}
        with patch.object(
            app_module.requests,
            "get",
            side_effect=[
                JsonResponse({"results": [self.jamendo_track()]}),
                redirect_response,
            ],
        ) as get:
            response = self.client.post(
                "/api/downloads",
                json={"source": "jamendo", "track_id": "123"},
                headers=self.csrf_headers(),
            )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(get.call_count, 2)
        self.assertTrue(redirect_response.closed)
        self.assertEqual(database.get_download(self.library_scope(), "jamendo", "123")["status"], "failed")

    def test_library_likes_history_and_playlists_are_stored(self):
        track = {
            "id": "abc",
            "source": "jamendo",
            "title": "Library Track",
            "artist": "Library Artist",
            "album": "Library Album",
            "image": None,
            "audio": "https://stream.jamendo.com/track.mp3",
            "duration": 120,
        }
        csrf = self.csrf_headers()
        liked = self.client.post("/api/library/liked", json={"track": track, "liked": True}, headers=csrf)
        played = self.client.post("/api/library/recently-played", json={"track": track}, headers=csrf)
        created = self.client.post("/api/library/playlists", json={"name": "Favourites"}, headers=csrf)
        playlist_id = created.get_json()["id"]
        added = self.client.post(
            f"/api/library/playlists/{playlist_id}/tracks",
            json={"track": track},
            headers=self.csrf_headers(),
        )
        playlist_tracks = self.client.get(f"/api/library/playlists/{playlist_id}/tracks")
        library = self.client.get("/api/library").get_json()

        self.assertEqual(liked.status_code, 200)
        self.assertEqual(played.status_code, 200)
        self.assertEqual(created.status_code, 201)
        self.assertEqual(added.status_code, 201)
        self.assertEqual(playlist_tracks.get_json()[0]["title"], "Library Track")
        self.assertEqual(library["liked"][0]["title"], "Library Track")
        self.assertEqual(library["recently_played"][0]["title"], "Library Track")
        self.assertEqual(library["playlists"][0]["name"], "Favourites")

    def test_guest_library_moves_into_account_when_signing_in(self):
        track = {
            "id": "guest-track",
            "source": "jamendo",
            "title": "Guest Track",
            "artist": "Guest Artist",
            "album": None,
            "image": None,
            "audio": "https://stream.jamendo.com/guest.mp3",
            "duration": 30,
        }
        self.client.get("/api/library")
        guest_scope = self.library_scope()
        liked = self.client.post(
            "/api/library/liked",
            json={"track": track, "liked": True},
            headers=self.csrf_headers(),
        )
        self.assertEqual(liked.status_code, 200)

        with app_module.app.test_request_context("/"):
            from flask import session

            session["library_scope"] = guest_scope
            app_module._sign_in(42)

        self.assertEqual(
            database.list_library_tracks("liked_tracks", "user:42")[0]["title"],
            "Guest Track",
        )
        self.assertEqual(database.list_library_tracks("liked_tracks", guest_scope), [])


if __name__ == "__main__":
    unittest.main()
