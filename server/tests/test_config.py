from ecos.config import Settings


def test_defaults_point_to_local_sqlite(monkeypatch):
    monkeypatch.delenv("ECOS_DATABASE_URL", raising=False)
    monkeypatch.delenv("ECOS_SECRET_KEY", raising=False)
    s = Settings()
    assert s.database_url.startswith("sqlite")
    assert s.default_user_id


def test_env_prefix_override(monkeypatch):
    monkeypatch.setenv("ECOS_SECRET_KEY", "from-env")
    assert Settings().secret_key == "from-env"
