package main

// Fetches web services for reports while refusing internal addresses (SSRF).
//
// The hostname is resolved once, every address is checked, and the connection is made to a
// checked address (TLS still verifies the real hostname, which stays in the URL) — so DNS
// rebinding cannot slip past the check. Redirects are followed by hand and checked again.

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	maxFetchBytes = 5 * 1024 * 1024
	maxRedirects  = 3
	fetchDeadline = 10 * time.Second
)

var (
	numericHost = regexp.MustCompile(`(?i)^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}$`)
	blockedV4   = mustPrefixes("0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
		"192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4")
	blockedV6 = mustPrefixes("::/128", "::1/128", "fc00::/7", "fe80::/10", "fec0::/10", "ff00::/8", "2001:db8::/32", "100::/64")
	// Addresses that carry an IPv4 address inside: judged by that address.
	embeddsV4 = mustPrefixes("64:ff9b::/96", "::/96")
)

func mustPrefixes(list ...string) []netip.Prefix {
	out := make([]netip.Prefix, len(list))
	for i, s := range list {
		out[i] = netip.MustParsePrefix(s)
	}
	return out
}

func inAny(a netip.Addr, prefixes []netip.Prefix) bool {
	for _, p := range prefixes {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

func isBlocked(a netip.Addr) bool {
	a = a.Unmap()
	if a.Is4() {
		return inAny(a, blockedV4)
	}
	if inAny(a, embeddsV4) {
		b := a.As16()
		return isBlocked(netip.AddrFrom4([4]byte{b[12], b[13], b[14], b[15]}))
	}
	return inAny(a, blockedV6)
}

// inetAton reads the numeric shorthands most resolvers accept ("2130706433", "0x7f.1", "127.1").
func inetAton(host string) (netip.Addr, bool) {
	parts := strings.Split(host, ".")
	nums := make([]uint64, len(parts))
	for i, p := range parts {
		n, err := strconv.ParseUint(p, 0, 32)
		if err != nil {
			return netip.Addr{}, false
		}
		nums[i] = n
	}
	var v uint64
	switch len(nums) {
	case 1:
		v = nums[0]
	case 2:
		v = nums[0]<<24 | nums[1]&0xffffff
	case 3:
		v = nums[0]<<24 | nums[1]<<16 | nums[2]&0xffff
	default:
		v = nums[0]<<24 | nums[1]<<16 | nums[2]<<8 | nums[3]
	}
	if v > 0xffffffff {
		return netip.Addr{}, false
	}
	return netip.AddrFrom4([4]byte{byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)}), true
}

// resolve returns the addresses to connect to, IPv4 first, or an error when any is internal.
func resolve(ctx context.Context, host string, allow map[string]bool) ([]netip.Addr, *apiError) {
	allowed := allow[strings.ToLower(host)]
	if numericHost.MatchString(host) {
		a, ok := inetAton(host)
		if !ok {
			return nil, fail(400, "Invalid URL.")
		}
		if !allowed && isBlocked(a) {
			return nil, fail(403, "Refusing to fetch %s: internal address.", host)
		}
		return []netip.Addr{a}, nil
	}
	if a, err := netip.ParseAddr(strings.Trim(host, "[]")); err == nil {
		if !allowed && isBlocked(a) {
			return nil, fail(403, "Refusing to fetch %s: internal address.", host)
		}
		return []netip.Addr{a.Unmap()}, nil
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil || len(ips) == 0 {
		return nil, fail(502, "Could not resolve %s.", host)
	}
	var v4, v6 []netip.Addr
	for _, a := range ips {
		if !allowed && isBlocked(a) {
			return nil, fail(403, "Refusing to fetch %s: it resolves to an internal address.", host)
		}
		if a.Unmap().Is4() {
			v4 = append(v4, a.Unmap())
		} else {
			v6 = append(v6, a)
		}
	}
	return append(v4, v6...), nil
}

type fetchHeader struct {
	Name  string `json:"name"`
	Value any    `json:"value"`
}

// guardedFetch returns the response's content type and body.
func guardedFetch(rawURL, method string, headers []fetchHeader, body *string, allow map[string]bool) (string, []byte, *apiError) {
	// One deadline for the whole fetch, redirects and a slowly dripping body included.
	ctx, cancel := context.WithTimeout(context.Background(), fetchDeadline)
	defer cancel()
	current, err := url.Parse(rawURL)
	if err != nil {
		return "", nil, fail(400, "Invalid URL.")
	}
	origin := current.Scheme + "://" + current.Host
	for range maxRedirects + 1 {
		if (current.Scheme != "http" && current.Scheme != "https") || current.Hostname() == "" {
			return "", nil, fail(400, "Only http and https URLs can be fetched.")
		}
		addrs, apiErr := resolve(ctx, current.Hostname(), allow)
		if apiErr != nil {
			return "", nil, apiErr
		}
		port := current.Port()
		if port == "" {
			port = map[string]string{"http": "80", "https": "443"}[current.Scheme]
		}
		transport := &http.Transport{
			// Connect only to the checked addresses, whatever the name resolves to by now.
			DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
				var last error
				for _, a := range addrs {
					d := net.Dialer{Timeout: 3 * time.Second}
					conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(a.String(), port))
					if err == nil {
						return conn, nil
					}
					last = err
				}
				return nil, last
			},
			Proxy: nil,
		}
		client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		var reader io.Reader
		verb := http.MethodGet
		if method == "POST" {
			verb = http.MethodPost
			if body != nil {
				reader = strings.NewReader(*body)
			}
		}
		req, err := http.NewRequestWithContext(ctx, verb, current.String(), reader)
		if err != nil {
			return "", nil, fail(400, "Invalid URL.")
		}
		// The caller's headers (Authorization, cookies) are for the original site only.
		if current.Scheme+"://"+current.Host == origin {
			for _, h := range headers {
				if h.Name != "" && !strings.EqualFold(h.Name, "host") {
					req.Header.Set(h.Name, toText(h.Value))
				}
			}
		}
		res, err := client.Do(req)
		transport.CloseIdleConnections()
		if err != nil {
			if ctx.Err() != nil {
				return "", nil, fail(504, "The web service did not answer in time.")
			}
			return "", nil, fail(502, "Could not reach the web service.")
		}
		if res.StatusCode >= 300 && res.StatusCode < 400 && res.Header.Get("Location") != "" {
			res.Body.Close()
			next, err := current.Parse(res.Header.Get("Location"))
			if err != nil {
				return "", nil, fail(502, "The web service sent an invalid redirect.")
			}
			current = next
			continue
		}
		if res.StatusCode >= 400 {
			res.Body.Close()
			return "", nil, fail(502, "The web service answered %d.", res.StatusCode)
		}
		var buf bytes.Buffer
		_, err = io.Copy(&buf, io.LimitReader(res.Body, maxFetchBytes+1))
		res.Body.Close()
		if err != nil {
			if ctx.Err() != nil {
				return "", nil, fail(504, "The web service did not answer in time.")
			}
			return "", nil, fail(502, "Could not read the web service's answer.")
		}
		if buf.Len() > maxFetchBytes {
			return "", nil, fail(502, "The response is larger than 5 MB.")
		}
		contentType := res.Header.Get("Content-Type")
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		return contentType, buf.Bytes(), nil
	}
	return "", nil, fail(502, "Too many redirects.")
}

func toText(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(x)
	}
	return ""
}
