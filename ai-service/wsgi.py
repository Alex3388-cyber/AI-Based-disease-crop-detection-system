"""WSGI entry point: ``gunicorn wsgi:app`` or ``waitress-serve wsgi:app``."""

from app import create_app


app = create_app()
