"""Fetches web services for reports while refusing internal addresses (SSRF).

The hostname is resolved once, every address is checked, and the connection is made to the checked
address (TLS still verifies the real hostname via SNI) — so DNS rebinding cannot slip past the check.
Redirects are followed by hand and checked again.
"""
import ipaddress
import re
import socket
import time
from urllib.parse import urljoin, urlsplit

import urllib3

from query import ApiError

MAX_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 3
TIMEOUT = urllib3.Timeout(connect=10, read=10)


def is_blocked(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return (addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_multicast or addr.is_reserved
            or addr.is_unspecified or (isinstance(addr, ipaddress.IPv4Address) and addr in ipaddress.ip_network("100.64.0.0/10")))


def _resolve(host: str, port: int, allow_hosts: set[str]) -> str:
    # Numeric shorthands ("2130706433", "0x7f.1") are IPv4 addresses on most resolvers: judge them
    # as such instead of relying on what this platform's resolver does with them.
    if re.fullmatch(r"(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}", host, re.IGNORECASE):
        try:
            literal = socket.inet_ntoa(socket.inet_aton(host))
        except OSError as e:
            raise ApiError(400, "Invalid URL.") from e
        if host.lower() not in allow_hosts and is_blocked(literal):
            raise ApiError(403, f"Refusing to fetch {host}: internal address.")
        return literal
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise ApiError(502, f"Could not resolve {host}.") from e
    addresses = [info[4][0] for info in infos]
    if host.lower() not in allow_hosts and (not addresses or any(is_blocked(a) for a in addresses)):
        raise ApiError(403, f"Refusing to fetch {host}: it resolves to an internal address.")
    return addresses[0]


def guarded_fetch(url: str, method: str, headers: list[dict], body: str | None, allow_hosts: set[str]) -> tuple[str, bytes]:
    current = url
    origin = urlsplit(url)[:2] + (urlsplit(url).port,)
    # One deadline for the whole fetch, redirects and a slowly dripping body included.
    deadline = time.monotonic() + 10
    for _ in range(MAX_REDIRECTS + 1):
        parts = urlsplit(current)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise ApiError(400, "Only http and https URLs can be fetched.")
        host = parts.hostname
        port = parts.port or (443 if parts.scheme == "https" else 80)
        ip = _resolve(host, port, allow_hosts)
        # The caller's headers (Authorization, cookies) are for the original site only.
        same_origin = parts[:2] + (parts.port,) == origin
        out_headers = {h["name"]: str(h.get("value", "")) for h in headers if same_origin and isinstance(h, dict) and h.get("name")}
        out_headers["Host"] = parts.netloc.rsplit("@", 1)[-1]
        if parts.scheme == "https":
            pool = urllib3.HTTPSConnectionPool(ip, port, server_hostname=host, assert_hostname=host, timeout=TIMEOUT, retries=False)
        else:
            pool = urllib3.HTTPConnectionPool(ip, port, timeout=TIMEOUT, retries=False)
        path = parts.path or "/"
        if parts.query:
            path += "?" + parts.query
        try:
            response = pool.urlopen("POST" if method == "POST" else "GET", path, headers=out_headers,
                                    body=body if method == "POST" else None, redirect=False, preload_content=False)
        except urllib3.exceptions.TimeoutError as e:
            raise ApiError(504, "The web service did not answer in time.") from e
        except urllib3.exceptions.HTTPError as e:
            raise ApiError(502, f"Could not reach the web service: {e}") from e
        try:
            if 300 <= response.status < 400 and response.headers.get("location"):
                current = urljoin(current, response.headers["location"])
                continue
            if response.status >= 400:
                raise ApiError(502, f"The web service answered {response.status}.")
            data = bytearray()
            for chunk in response.stream(65536):
                if time.monotonic() > deadline:
                    raise ApiError(504, "The web service did not answer in time.")
                data += chunk
                if len(data) > MAX_BYTES:
                    raise ApiError(502, "The response is larger than 5 MB.")
            return response.headers.get("content-type", "application/octet-stream"), bytes(data)
        finally:
            response.release_conn()
    raise ApiError(502, "Too many redirects.")
