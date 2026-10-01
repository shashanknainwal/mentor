"""Process-wide singletons shared by all engine modules."""

from .config import settings
from .db import Database
from .vectors import VectorStore

db = Database(settings.db_path)
vectors = VectorStore(db)
