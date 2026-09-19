from sqlalchemy import select

from ecos.commerce.seed import seed_commerce
from ecos.models import Asset, Draft, Favorite, Order, Product, Store, Ticket


def test_seed_is_idempotent(session):
    seed_commerce(session, "u1")
    session.commit()
    first = len(session.execute(select(Store)).scalars().all())
    seed_commerce(session, "u1")
    session.commit()
    assert first == 5 and len(session.execute(select(Store)).scalars().all()) == 5


def test_seed_covers_all_tables(session):
    seed_commerce(session, "u1")
    session.commit()
    assert session.execute(select(Product)).scalars().first().sales_7d >= 0
    assert session.execute(select(Order)).scalars().first().amount > 0
    assert session.execute(select(Asset)).scalars().first().versions
    assert session.execute(select(Ticket)).scalars().first().status == "待分析"


def test_seed_orders_are_deterministic(session):
    seed_commerce(session, "u1")
    session.commit()
    signature = [
        (o.sku, o.amount, o.created_at.isoformat())
        for o in session.execute(select(Order)).scalars().all()
    ]
    session.query(Order).delete()
    session.query(Store).delete()
    session.commit()
    seed_commerce(session, "u1")
    session.commit()
    again = [
        (o.sku, o.amount, o.created_at.isoformat())
        for o in session.execute(select(Order)).scalars().all()
    ]
    assert len(signature) > 30 and signature == again


def test_empty_tables_seeded_clean(session):
    seed_commerce(session, "u1")
    session.commit()
    assert session.execute(select(Draft)).scalars().first() is None
    assert session.execute(select(Favorite)).scalars().first() is None
