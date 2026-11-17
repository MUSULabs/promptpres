"""Compatibility import; implementation is shared."""
import sys
from promptpres_shared import topics as implementation

if __name__ == "__main__":
    implementation.main()
else:
    sys.modules[__name__] = implementation
