"""Compatibility import; implementation is shared."""
import sys
from promptpres_shared import settings as implementation

sys.modules[__name__] = implementation
