"""Compatibility import; implementation is shared."""
import sys
from promptpres_shared import llm_client as implementation

sys.modules[__name__] = implementation
