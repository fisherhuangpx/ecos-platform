import pytest
from sqlalchemy.orm import sessionmaker

from ecos.config import Settings
from ecos.db import init_db, make_engine


@pytest.fixture()
def settings() -> Settings:
    return Settings(
        database_url="sqlite://",
        secret_key="test-secret",
        gateway_base_url="http://testserver",
    )


@pytest.fixture()
def engine(settings):
    engine = make_engine(settings.database_url)
    init_db(engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def session(engine):
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as s:
        yield s
