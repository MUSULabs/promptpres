"""Versioned, additive changes; preserve existing run IDs and result JSON."""
from sqlalchemy import inspect, text


def migrate(engine, schema):
    with engine.begin() as db:
        if db.dialect.name == "sqlite":
            db.exec_driver_sql("BEGIN IMMEDIATE")
        else:
            db.execute(text("SELECT pg_advisory_xact_lock(18307925)"))
        schema.create_all(db)
        db.exec_driver_sql("CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY)")
        if db.exec_driver_sql("SELECT version FROM schema_versions WHERE version = 1").first() is None:
            if "owner_id" not in {c["name"] for c in inspect(db).get_columns("sessions")}:
                db.exec_driver_sql("ALTER TABLE sessions ADD COLUMN owner_id VARCHAR(64)")
            db.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_sessions_owner ON sessions (owner_id)")
            db.exec_driver_sql("INSERT INTO schema_versions (version) VALUES (1)")
        if db.exec_driver_sql("SELECT version FROM schema_versions WHERE version = 2").first() is None:
            if "settings_json" not in {c["name"] for c in inspect(db).get_columns("sessions")}:
                db.exec_driver_sql("ALTER TABLE sessions ADD COLUMN settings_json TEXT")
            db.exec_driver_sql("INSERT INTO schema_versions (version) VALUES (2)")
        # create_all above adds users/auth_sessions without changing existing rehearsal ownership.
        if db.exec_driver_sql("SELECT version FROM schema_versions WHERE version = 3").first() is None:
            db.exec_driver_sql("INSERT INTO schema_versions (version) VALUES (3)")
        # v4 (D-062): PostgreSQL only. Row-level security with no policies closes every table to other roles
        # (e.g. a hosted REST API); the owner role the app connects as is not affected. No column changes.
        if db.exec_driver_sql("SELECT version FROM schema_versions WHERE version = 4").first() is None:
            if db.dialect.name == "postgresql":
                for table in RLS_TABLES:
                    db.exec_driver_sql(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
            db.exec_driver_sql("INSERT INTO schema_versions (version) VALUES (4)")


RLS_TABLES = ("users", "auth_sessions", "sessions", "topics_versions", "results", "schema_versions")
