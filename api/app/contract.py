"""Compatibility import; implementation is shared."""
import sys
from promptpres_shared import contract as implementation

sys.modules[__name__] = implementation
