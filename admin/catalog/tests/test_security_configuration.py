from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from config.urls import configured_admin_path


class SecurityConfigurationTests(SimpleTestCase):
    def test_csrf_and_axes_middleware_are_enabled(self) -> None:
        self.assertIn("django.middleware.csrf.CsrfViewMiddleware", settings.MIDDLEWARE)
        self.assertIn("axes.middleware.AxesMiddleware", settings.MIDDLEWARE)
        self.assertEqual(settings.MIDDLEWARE[-1], "axes.middleware.AxesMiddleware")

    def test_session_cookie_is_http_only(self) -> None:
        self.assertTrue(settings.SESSION_COOKIE_HTTPONLY)
        self.assertEqual(settings.X_FRAME_OPTIONS, "DENY")

    def test_anonymous_admin_access_redirects_to_login(self) -> None:
        response = self.client.get("/admin/")

        self.assertEqual(response.status_code, 302)
        self.assertIn("/admin/login/", response.headers["Location"])

    def test_admin_path_is_a_single_safe_segment(self) -> None:
        self.assertEqual(configured_admin_path("/private-admin/"), "private-admin")
        for invalid in ("", "///", "nested/admin", "admin?debug=true"):
            with self.subTest(invalid=invalid), self.assertRaises(ImproperlyConfigured):
                configured_admin_path(invalid)
