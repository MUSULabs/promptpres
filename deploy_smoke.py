"""Read-only HTTPS smoke test for a deployed PromptPre's service.

    python deploy_smoke.py https://promptpres.vercel.app
    python deploy_smoke.py https://promptpres.vercel.app --direct https://<workspace>--promptpres-web.us-east.modal.run

Web origin: API health + contract version, the login page, anonymous history denied.
--direct (D-062, the API address that receives upload chunks and serves the player): health, anonymous
history denied, CORS preflight answered only for the web origin (with Vary: Origin, no credentials).
"""
import argparse
import json
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

SCHEMA = Path(__file__).with_name("contracts") / "result.schema.json"
CHUNK = "/api/sessions/s_smoke/uploads/" + "0" * 32 + "/chunks/0"


def https_origin(value: str) -> str:
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
        raise ValueError("ระบุ HTTPS origin เช่น https://promptpres.your-domain.tld")
    return value.rstrip("/")


def health(root: str, contract: str) -> None:
    with urlopen(root + "/api/health", timeout=60) as response:
        payload = json.load(response)
        if response.status != 200 or not isinstance(payload, dict) or payload.get("ok") is not True \
                or payload.get("contract_version") != contract:
            raise ValueError(f"{root}: API health or result contract mismatch")


def denied(root: str) -> None:
    try:
        with urlopen(root + "/api/sessions", timeout=30) as response:
            raise ValueError(f"{root}: unauthenticated history returned HTTP {response.status}")
    except HTTPError as exc:
        if exc.code != 401 or exc.geturl() != root + "/api/sessions":
            raise
        exc.close()


def merged(headers) -> dict:
    """Lower-case header names; repeated headers (Modal adds a second Vary line) are joined with commas."""
    out: dict = {}
    for key, value in headers.items():
        key = key.lower()
        out[key] = f"{out[key]}, {value}" if key in out else value
    return out


def preflight(direct: str, origin: str) -> dict:
    request = Request(direct + CHUNK, method="OPTIONS", headers={
        "Origin": origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "x-upload-token"})
    try:
        with urlopen(request, timeout=30) as response:
            return {"status": response.status, **merged(response.headers)}
    except HTTPError as exc:
        headers = merged(exc.headers)
        exc.close()
        return {"status": exc.code, **headers}


def smoke(origin: str, direct: str | None = None) -> None:
    root = https_origin(origin)
    contract = json.loads(SCHEMA.read_text(encoding="utf-8"))["properties"]["contract_version"]["const"]
    health(root, contract)
    with urlopen(root + "/login", timeout=30) as response:
        if response.status != 200 or response.geturl() != root + "/login" or \
                response.headers.get_content_type() != "text/html":
            raise ValueError("/login did not return the web app")
    denied(root)
    print(f"PASS: {root}: HTTPS, API contract {contract}, login page, anonymous history denied")
    if not direct:
        return
    direct = https_origin(direct)
    health(direct, contract)
    denied(direct)
    allowed = preflight(direct, root)
    if allowed["status"] != 200 or allowed.get("access-control-allow-origin") != root \
            or "origin" not in allowed.get("vary", "").lower() or allowed.get("access-control-allow-credentials"):
        raise ValueError(f"{direct}: CORS preflight from {root} not allowed as expected")
    other = preflight(direct, "https://not-promptpres.example")
    if other.get("access-control-allow-origin"):
        raise ValueError(f"{direct}: CORS preflight allowed an unknown origin")
    print(f"PASS: {direct}: health, anonymous history denied, CORS only for {root}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("origin")
    parser.add_argument("--direct", help="API address for upload chunks and the player (D-062)")
    args = parser.parse_args()
    try:
        smoke(args.origin, args.direct)
    except (ValueError, URLError, OSError) as exc:
        parser.exit(1, f"FAIL: {exc}\n")


if __name__ == "__main__":
    main()
