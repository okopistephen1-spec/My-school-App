import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import redirect
from werkzeug.security import check_password_hash

import app as app_module
import database


class StubGoogle:
    def __init__(self):
        self.identity = {}
        self.redirect_uri = None

    def authorize_redirect(self, redirect_uri):
        self.redirect_uri = redirect_uri
        return redirect("https://accounts.google.com/o/oauth2/v2/auth")

    def authorize_access_token(self):
        return {"userinfo": self.identity}


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = database.DB_PATH
        database.DB_PATH = str(Path(self.temp_dir.name) / "test.sqlite")
        database.create_songs_table()
        database.initialize_auth_tables()

        self.original_google = app_module.google
        self.original_google_redirect_uri = app_module.GOOGLE_REDIRECT_URI
        self.original_client_id = app_module.GOOGLE_CLIENT_ID
        self.original_client_secret = app_module.GOOGLE_CLIENT_SECRET
        self.google = StubGoogle()
        app_module.google = self.google
        app_module.GOOGLE_REDIRECT_URI = "http://localhost/auth/google/callback"
        app_module.GOOGLE_CLIENT_ID = "test-client-id"
        app_module.GOOGLE_CLIENT_SECRET = "test-client-secret"

        self.original_rate_limit_setting = app_module.app.config.get("RATELIMIT_ENABLED")
        self.original_limiter_enabled = app_module.limiter.enabled
        app_module.limiter.enabled = False
        app_module.app.config.update(TESTING=True, RATELIMIT_ENABLED=False)
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.google = self.original_google
        app_module.GOOGLE_REDIRECT_URI = self.original_google_redirect_uri
        app_module.GOOGLE_CLIENT_ID = self.original_client_id
        app_module.GOOGLE_CLIENT_SECRET = self.original_client_secret
        if self.original_rate_limit_setting is None:
            app_module.app.config.pop("RATELIMIT_ENABLED", None)
        else:
            app_module.app.config["RATELIMIT_ENABLED"] = self.original_rate_limit_setting
        app_module.limiter.enabled = self.original_limiter_enabled
        database.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def csrf_headers(self):
        token = self.client.get("/api/csrf").get_json()["csrf_token"]
        return {"X-CSRFToken": token, "Content-Type": "application/json"}

    def signup(self, **overrides):
        data = {
            "full_name": "Test Listener",
            "email": "listener@example.test",
            "password": "SecurePass1234",
            "confirm_password": "SecurePass1234",
        }
        data.update(overrides)
        return self.client.post("/signup", data=json.dumps(data), headers=self.csrf_headers())

    def google_identity(self, **overrides):
        identity = {
            "sub": "google-sub-123",
            "email": "google@example.test",
            "email_verified": True,
            "name": "Google Listener",
            "picture": "https://example.test/avatar.png",
        }
        identity.update(overrides)
        self.google.identity = identity

    def test_registration_creates_hashed_account_and_session(self):
        response = self.signup()
        self.assertEqual(response.status_code, 201)
        user = database.get_user_by_email("listener@example.test")
        self.assertTrue(check_password_hash(user["password_hash"], "SecurePass1234"))
        self.assertNotEqual(user["password_hash"], "SecurePass1234")
        self.assertTrue(self.client.get("/api/me").get_json()["authenticated"])

    def test_registration_rejects_mismatched_passwords(self):
        response = self.signup(confirm_password="DifferentPass1234")
        self.assertEqual(response.status_code, 400)
        self.assertIn("do not match", response.get_json()["error"])
        self.assertIsNone(database.get_user_by_email("listener@example.test"))

    def test_registration_requires_fields_and_password_policy(self):
        missing = self.client.post("/signup", json={"email": "listener@example.test"}, headers=self.csrf_headers())
        weak = self.signup(password="short", confirm_password="short")
        too_long = self.signup(password="A1" + "a" * 255, confirm_password="A1" + "a" * 255)
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(weak.status_code, 400)
        self.assertEqual(too_long.status_code, 400)
        self.assertIsNone(database.get_user_by_email("listener@example.test"))

    def test_auth_rejects_non_object_json_without_server_error(self):
        signup = self.client.post("/signup", data="[]", content_type="application/json", headers=self.csrf_headers())
        login = self.client.post("/login", data="[]", content_type="application/json", headers=self.csrf_headers())
        self.assertEqual(signup.status_code, 400)
        self.assertEqual(login.status_code, 400)

    def test_registration_rejects_duplicate_email_case_insensitively(self):
        self.assertEqual(self.signup().status_code, 201)
        response = self.client.post("/signup", json={
            "full_name": "Other Listener", "email": "LISTENER@example.test",
            "password": "OtherSecure1234", "confirm_password": "OtherSecure1234",
        }, headers=self.csrf_headers())
        self.assertEqual(response.status_code, 409)

    def test_login_accepts_valid_credentials_and_rejects_invalid_password(self):
        self.signup()
        self.client.post("/logout", headers=self.csrf_headers())
        valid = self.client.post("/login", json={
            "email": "LISTENER@example.test", "password": "SecurePass1234",
        }, headers=self.csrf_headers())
        self.assertEqual(valid.status_code, 200)
        self.assertTrue(self.client.get("/api/me").get_json()["authenticated"])

        self.client.post("/logout", headers=self.csrf_headers())
        invalid = self.client.post("/login", json={
            "email": "listener@example.test", "password": "WrongPassword1234",
        }, headers=self.csrf_headers())
        self.assertEqual(invalid.status_code, 401)
        self.assertEqual(invalid.get_json()["error"], "Email or password is incorrect.")
        self.assertFalse(self.client.get("/api/me").get_json()["authenticated"])

    def test_logout_clears_session_and_status_is_public(self):
        self.assertFalse(self.client.get("/api/me").get_json()["authenticated"])
        self.signup()
        self.assertTrue(self.client.get("/api/me").get_json()["authenticated"])
        response = self.client.post("/logout", headers=self.csrf_headers())
        self.assertEqual(response.status_code, 200)
        self.assertFalse(self.client.get("/api/me").get_json()["authenticated"])

    def test_auth_mutations_require_csrf(self):
        response = self.client.post("/signup", json={
            "full_name": "Test Listener", "email": "listener@example.test",
            "password": "SecurePass1234", "confirm_password": "SecurePass1234",
        })
        self.assertEqual(response.status_code, 400)
        self.assertIsNone(database.get_user_by_email("listener@example.test"))

    def test_google_authorization_uses_configured_callback(self):
        response = self.client.get("/auth/google")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], "https://accounts.google.com/o/oauth2/v2/auth")
        self.assertEqual(self.google.redirect_uri, "http://localhost/auth/google/callback")

    def test_google_callback_creates_account_and_reuses_google_identity(self):
        self.google_identity()
        first = self.client.get("/auth/google/callback")
        first_user = database.get_user_by_google_sub("google-sub-123")
        second = self.client.get("/auth/google/callback")
        connection = sqlite3.connect(database.DB_PATH)
        try:
            count = connection.execute("SELECT COUNT(*) FROM users WHERE google_sub = ?", ("google-sub-123",)).fetchone()[0]
        finally:
            connection.close()
        self.assertEqual(first.status_code, 302)
        self.assertEqual(second.status_code, 302)
        self.assertIsNone(first_user["password_hash"])
        self.assertEqual(count, 1)
        self.assertTrue(self.client.get("/api/me").get_json()["authenticated"])

    def test_google_does_not_link_existing_password_account_by_email(self):
        self.signup(email="google@example.test")
        self.client.post("/logout", headers=self.csrf_headers())
        self.google_identity()
        response = self.client.get("/auth/google/callback")
        self.assertIn("google_existing_account", response.headers["Location"])
        self.assertIsNone(database.get_user_by_google_sub("google-sub-123"))
        self.assertEqual(database.get_user_by_email("google@example.test")["password_hash"] is not None, True)

    def test_google_rejects_unverified_email_and_provider_errors(self):
        self.google_identity(email_verified=False)
        response = self.client.get("/auth/google/callback")
        self.assertIn("google_failed", response.headers["Location"])
        self.assertIsNone(database.get_user_by_google_sub("google-sub-123"))
        self.assertIn("google_failed", self.client.get("/auth/google/callback?error=access_denied").headers["Location"])

    def test_music_routes_remain_available(self):
        tracks_payload = {"headers": {"status": "success"}, "results": []}
        with patch.object(app_module.requests, "get", return_value=FakeResponse(tracks_payload)):
            jamendo = self.client.get("/api/jamendo/tracks")
        local_songs = self.client.get("/api/songs")
        home = self.client.get("/")
        self.assertEqual(jamendo.status_code, 200)
        self.assertEqual(local_songs.status_code, 200)
        self.assertEqual(home.status_code, 200)


if __name__ == "__main__":
    unittest.main()