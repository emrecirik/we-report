// we-report data backend — Go implementation of protocol/openapi.yaml (v1).
//
// SQLite (modernc.org/sqlite, pure Go) and PostgreSQL (pgx). Run: go run .
package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const maxBody = 1024 * 1024

type connectionConfig struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Dialect      string `json:"dialect"`
	URL          string `json:"url"`
	Schema       string `json:"schema"`
	Seed         string `json:"seed"`
	AllowFreeSQL bool   `json:"allowFreeSql"`
	MaxRows      int    `json:"maxRows"`
	TimeoutMs    int    `json:"timeoutMs"`
}

type config struct {
	host, port, authToken   string
	demo, webServiceFetch   bool
	corsOrigins, fetchAllow map[string]bool
	rateLimit               int
	connections             []*connectionConfig
}

func list(value string) map[string]bool {
	out := map[string]bool{}
	for _, v := range strings.Split(value, ",") {
		if v = strings.TrimSpace(v); v != "" {
			out[strings.ToLower(v)] = true
		}
	}
	return out
}

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

var idPattern = regexp.MustCompile(`^[\w-]+$`)

// loadConfig reads every setting from the environment (and an optional connections file), never
// from requests.
func loadConfig() (*config, error) {
	demo := os.Getenv("WE_REPORT_DEMO") == "1"
	raw := os.Getenv("WE_REPORT_CONNECTIONS")
	if raw == "" {
		if b, err := os.ReadFile("connections.json"); err == nil {
			raw = string(b)
		}
	}
	var connections []*connectionConfig
	if raw != "" {
		if err := json.Unmarshal([]byte(raw), &connections); err != nil {
			return nil, fmt.Errorf("connections: %w", err)
		}
		ids := map[string]bool{}
		for _, c := range connections {
			if c.ID == "" || c.Name == "" || c.Dialect == "" || c.URL == "" {
				return nil, errors.New(`every connection needs "id", "name", "dialect" and "url"`)
			}
			if !idPattern.MatchString(c.ID) || ids[c.ID] {
				return nil, fmt.Errorf("connection id %q must be unique and use letters, digits, _ or -", c.ID)
			}
			if c.Dialect != "sqlite" && c.Dialect != "postgres" {
				return nil, fmt.Errorf("unsupported dialect %q (this sample: sqlite, postgres)", c.Dialect)
			}
			ids[c.ID] = true
		}
	} else {
		connections = []*connectionConfig{{ID: "sample", Name: "Sample shop (SQLite)", Dialect: "sqlite",
			URL: filepath.Join(os.TempDir(), "we-report-sample-go.db"), Seed: "sample"}}
	}
	for _, c := range connections {
		// Demo mode never runs free SQL, whatever the file says.
		c.AllowFreeSQL = c.AllowFreeSQL && !demo
		if c.MaxRows <= 0 {
			c.MaxRows = 5000
		}
		c.MaxRows = min(c.MaxRows, 50000)
		if c.TimeoutMs <= 0 {
			c.TimeoutMs = 15000
		}
	}
	rate, _ := strconv.Atoi(os.Getenv("WE_REPORT_RATE_LIMIT"))
	if rate <= 0 {
		rate = 600
		if demo {
			rate = 60
		}
	}
	return &config{
		host:      env("WE_REPORT_HOST", "127.0.0.1"),
		port:      env("WE_REPORT_PORT", env("PORT", "5480")),
		authToken: os.Getenv("WE_REPORT_AUTH_TOKEN"),
		demo:      demo,
		// The fetch proxy would be an open proxy on a public demo.
		webServiceFetch: !demo && os.Getenv("WE_REPORT_FETCH") != "0",
		corsOrigins:     list(env("WE_REPORT_CORS_ORIGINS", "http://localhost:4200,http://127.0.0.1:4200")),
		fetchAllow:      list(os.Getenv("WE_REPORT_FETCH_ALLOW_HOSTS")),
		rateLimit:       rate,
		connections:     connections,
	}, nil
}

type server struct {
	cfg       *config
	mu        sync.Mutex
	databases map[string]database
	hits      map[string]int
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, e *apiError) {
	writeJSON(w, e.status, map[string]string{"error": e.message})
}

func isLoopback(host string) bool {
	a, err := netip.ParseAddr(strings.Trim(host, "[]"))
	return err == nil && a.Unmap().IsLoopback()
}

// access decides who may call, and how often. Without a token only local callers are accepted —
// unless this is the public demo, which serves read-only sample data to anyone. Plug your own
// authentication in here.
func (s *server) access(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if origin := r.Header.Get("Origin"); origin != "" && s.cfg.corsOrigins[strings.ToLower(origin)] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		ip, _, _ := net.SplitHostPort(r.RemoteAddr)
		key := fmt.Sprintf("%s|%d", ip, time.Now().Unix()/60)
		s.mu.Lock()
		s.hits[key]++
		count := s.hits[key]
		if len(s.hits) > 10000 {
			s.hits = map[string]int{key: count}
		}
		s.mu.Unlock()
		if count > s.cfg.rateLimit {
			writeError(w, fail(429, "Too many requests; try again in a minute."))
			return
		}
		var allowed bool
		switch {
		case s.cfg.authToken != "":
			allowed = subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+s.cfg.authToken)) == 1
		case s.cfg.demo:
			allowed = true
		default:
			// Local only — and addressed as a local host, so a page whose domain was re-pointed at
			// 127.0.0.1 (DNS rebinding) cannot use the browser to read local data.
			host := r.Host
			if h, _, err := net.SplitHostPort(r.Host); err == nil {
				host = h
			}
			allowed = isLoopback(ip) && (host == "localhost" || isLoopback(host))
		}
		if !allowed {
			writeError(w, fail(401, "Not authorized."))
			return
		}
		// A page elsewhere can POST a plain form (text/plain) without a CORS preflight; JSON it cannot.
		if r.Method == http.MethodPost {
			if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
				writeError(w, fail(415, "Send the body as application/json."))
				return
			}
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBody)
		next.ServeHTTP(w, r)
	})
}

func (s *server) connection(id string) (*connectionConfig, database, *apiError) {
	for _, c := range s.cfg.connections {
		if c.ID != id {
			continue
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		db, ok := s.databases[id]
		if !ok {
			var err error
			if db, err = openDatabase(c); err != nil {
				log.Printf("Opening %q failed: %v", id, err)
				return nil, nil, fail(500, "Internal error.")
			}
			s.databases[id] = db
		}
		return c, db, nil
	}
	return nil, nil, fail(404, "No connection \"%s\".", id)
}

func readBody(r *http.Request, v any) *apiError {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			return fail(413, "Request body too large.")
		}
		return fail(400, "Body must be a JSON object.")
	}
	return nil
}

func (s *server) info(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]any{"protocol": 1, "server": "we-report-go",
		"capabilities": map[string]bool{"webServiceFetch": s.cfg.webServiceFetch, "demo": s.cfg.demo}})
}

func (s *server) listConnections(w http.ResponseWriter, _ *http.Request) {
	// Never the url: ids, names, dialects and what is allowed.
	out := []map[string]any{}
	for _, c := range s.cfg.connections {
		out = append(out, map[string]any{"id": c.ID, "name": c.Name, "dialect": c.Dialect, "freeSql": c.AllowFreeSQL})
	}
	writeJSON(w, 200, out)
}

func (s *server) schema(w http.ResponseWriter, r *http.Request) {
	_, db, apiErr := s.connection(r.PathValue("id"))
	if apiErr != nil {
		writeError(w, apiErr)
		return
	}
	tables, err := db.schema(r.Context())
	if err != nil {
		log.Printf("Schema of %q failed: %v", r.PathValue("id"), err)
		writeError(w, fail(400, "The schema could not be read. The backend log has the details."))
		return
	}
	writeJSON(w, 200, map[string]any{"tables": tables})
}

func (s *server) query(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	c, db, apiErr := s.connection(id)
	if apiErr != nil {
		writeError(w, apiErr)
		return
	}
	var body struct {
		Query  *structuredQuery `json:"query"`
		SQL    *string          `json:"sql"`
		Params map[string]any   `json:"params"`
	}
	if apiErr := readBody(r, &body); apiErr != nil {
		writeError(w, apiErr)
		return
	}
	var b *built
	if body.SQL != nil {
		if !c.AllowFreeSQL {
			writeError(w, fail(403, "Free SQL is not allowed on this connection. Use the query builder."))
			return
		}
		b, apiErr = buildFreeSQL(*body.SQL, db, body.Params, c.MaxRows)
	} else {
		tables, err := db.schema(r.Context())
		if err != nil {
			log.Printf("Schema of %q failed: %v", id, err)
			writeError(w, fail(400, "The schema could not be read. The backend log has the details."))
			return
		}
		b, apiErr = buildSelect(body.Query, tables, db, body.Params, c.MaxRows)
	}
	if apiErr != nil {
		writeError(w, apiErr)
		return
	}
	rows, err := db.query(r.Context(), b, time.Duration(c.TimeoutMs)*time.Millisecond)
	if errors.Is(err, errTimedOut) {
		writeError(w, fail(504, "The query took too long and was stopped."))
		return
	}
	if err != nil {
		// Driver messages can name hosts, users and databases: logged here, never sent.
		log.Printf("Query on %q failed: %v", id, err)
		writeError(w, fail(400, "The query failed. The backend log has the details."))
		return
	}
	truncated := len(rows) > b.limit
	if truncated {
		rows = rows[:b.limit]
	}
	columns := []map[string]string{}
	if len(rows) > 0 {
		for i, name := range rows[0].names {
			columns = append(columns, map[string]string{"name": name, "type": jsonType(rows[0].values[i])})
		}
	}
	writeJSON(w, 200, map[string]any{"columns": columns, "rows": rows, "truncated": truncated})
}

func jsonType(v any) string {
	switch v.(type) {
	case nil:
		return "unknown"
	case bool:
		return "boolean"
	case int64, float64, int32, int:
		return "number"
	}
	return "string"
}

func (s *server) fetch(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.webServiceFetch {
		writeError(w, fail(403, "Web service fetching is disabled on this backend."))
		return
	}
	var body struct {
		URL     *string       `json:"url"`
		Method  string        `json:"method"`
		Headers []fetchHeader `json:"headers"`
		Body    *string       `json:"body"`
	}
	if apiErr := readBody(r, &body); apiErr != nil {
		writeError(w, apiErr)
		return
	}
	if body.URL == nil {
		writeError(w, fail(400, "url is required."))
		return
	}
	contentType, data, apiErr := guardedFetch(*body.URL, body.Method, body.Headers, body.Body, s.cfg.fetchAllow)
	if apiErr != nil {
		writeError(w, apiErr)
		return
	}
	// Passed through as-is; the client parses JSON or CSV exactly as when it calls directly.
	w.Header().Set("Content-Type", contentType)
	// Someone else's content: never active on this backend's origin.
	w.Header().Set("Content-Security-Policy", "sandbox")
	_, _ = w.Write(data)
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	if !isLoopback(cfg.host) && cfg.host != "localhost" && cfg.authToken == "" && !cfg.demo {
		log.Fatalf("Refusing to listen on %s without authentication. Set WE_REPORT_AUTH_TOKEN, plug your own auth into access() in main.go, or keep WE_REPORT_HOST=127.0.0.1.", cfg.host)
	}
	s := &server{cfg: cfg, databases: map[string]database{}, hits: map[string]int{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/info", s.info)
	mux.HandleFunc("GET /v1/connections", s.listConnections)
	mux.HandleFunc("GET /v1/connections/{id}/schema", s.schema)
	mux.HandleFunc("POST /v1/connections/{id}/query", s.query)
	mux.HandleFunc("POST /v1/webservice/fetch", s.fetch)
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) { writeError(w, fail(404, "Not found.")) })

	var names []string
	for _, c := range cfg.connections {
		names = append(names, fmt.Sprintf("%s (%s)", c.ID, c.Dialect))
	}
	mode := ""
	if cfg.demo {
		mode = " — DEMO MODE"
	}
	addr := net.JoinHostPort(cfg.host, cfg.port)
	log.Printf("we-report backend on http://%s — connections: %s%s", addr, strings.Join(names, ", "), mode)
	srv := &http.Server{Addr: addr, Handler: s.access(mux), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second,
		WriteTimeout: 60 * time.Second, BaseContext: func(net.Listener) context.Context { return context.Background() }}
	log.Fatal(srv.ListenAndServe())
}
