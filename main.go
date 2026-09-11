package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"
)

//go:embed player/index.html
var playerFS embed.FS

const (
	dropboxAPI     = "https://api.dropboxapi.com/2"
	dropboxContent = "https://content.dropboxapi.com/2"
	dropboxToken   = "https://api.dropboxapi.com/oauth2/token"
	sessionMaxAge  = 400 * 24 * 60 * 60
)

type config struct {
	listenAddr       string
	dataPath         string
	publicURL        string
	dropboxRoot      string
	allowedAccountID string
	appKey           string
	appSecret        string
	refreshToken     string
	playlistPath     string
	missingPath      string
	indexerAppKey    string
	indexerAppSecret string
	indexerRefresh   string
}

type track struct {
	ID          string               `json:"id"`
	Rev         string               `json:"rev,omitempty"`
	Path        string               `json:"path"`
	Name        string               `json:"name"`
	Title       string               `json:"title"`
	Artist      string               `json:"artist"`
	Album       string               `json:"album"`
	AlbumArtist string               `json:"albumArtist"`
	Genre       string               `json:"genre"`
	Year        int                  `json:"year"`
	TrackNumber int                  `json:"trackNumber"`
	DiscNumber  int                  `json:"discNumber"`
	Duration    float64              `json:"duration"`
	Size        int64                `json:"size"`
	Format      string               `json:"format"`
	Codec       string               `json:"codec"`
	SampleRate  int                  `json:"sampleRate"`
	Channels    int                  `json:"channels"`
	Bitrate     int64                `json:"bitrate"`
	Tags        map[string]string    `json:"tags,omitempty"`
	Playlists   []playlistMembership `json:"playlists,omitempty"`
	IndexedAt   string               `json:"indexedAt"`
	Deleted     bool                 `json:"deleted,omitempty"`
}

type remoteEntry struct {
	Tag            string `json:".tag"`
	ID             string `json:"id"`
	Name           string `json:"name"`
	PathLower      string `json:"path_lower"`
	PathDisplay    string `json:"path_display"`
	Rev            string `json:"rev"`
	Size           int64  `json:"size"`
	ServerModified string `json:"server_modified"`
}

type playlistItem struct {
	URI               string `json:"uri"`
	Path              string `json:"path,omitempty"`
	Artist            string `json:"artist"`
	Album             string `json:"album"`
	Track             string `json:"track"`
	Position          int    `json:"position"`
	TrackID           string `json:"trackId,omitempty"`
	AllTracksByArtist bool   `json:"allTracksByArtist,omitempty"`
}

type playlist struct {
	Source string         `json:"source"`
	URI    string         `json:"uri"`
	Name   string         `json:"name"`
	Items  []playlistItem `json:"items"`
}

type playlistMembership struct {
	Source       string `json:"source"`
	PlaylistURI  string `json:"playlistUri"`
	PlaylistName string `json:"playlistName"`
	ItemURI      string `json:"itemUri"`
	Artist       string `json:"artist"`
	Album        string `json:"album"`
	Track        string `json:"track"`
	Position     int    `json:"position"`
}

type playlistCandidate struct {
	Source       string       `json:"source"`
	PlaylistURI  string       `json:"playlistUri"`
	PlaylistName string       `json:"playlistName"`
	Item         playlistItem `json:"item"`
}

type playlistStore struct {
	Finalized bool       `json:"finalized"`
	Playlists []playlist `json:"playlists"`
}

type playlistFolder struct {
	Source    string     `json:"source"`
	Playlists []playlist `json:"playlists"`
}

type playlistImport struct {
	Playlists []playlist `json:"playlists"`
}

type playlistImportStatus struct {
	Running   bool   `json:"running"`
	Error     string `json:"error,omitempty"`
	Playlists int    `json:"playlists,omitempty"`
	Missing   int    `json:"missing,omitempty"`
}

type playlistSourceScanStatus struct {
	Running    bool   `json:"running"`
	Pages      int    `json:"pages"`
	Candidates int    `json:"candidates"`
	Playlists  int    `json:"playlists"`
	Tracks     int    `json:"tracks"`
	Error      string `json:"error,omitempty"`
}

type listFolderResponse struct {
	Entries []remoteEntry `json:"entries"`
	Cursor  string        `json:"cursor"`
	HasMore bool          `json:"has_more"`
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

type dropboxTokenSource struct {
	mu           sync.Mutex
	appKey       string
	appSecret    string
	accessToken  string
	refreshToken string
	expiresAt    time.Time
}

type session struct {
	tokens       *dropboxTokenSource
	accountID    string
	refreshToken string
}

type sessionEnvelope struct {
	AccountID    string `json:"a"`
	RefreshToken string `json:"r"`
	ExpiresAt    int64  `json:"e"`
}

type server struct {
	cfg                config
	ctx                context.Context
	mu                 sync.RWMutex
	importMu           sync.Mutex
	states             map[string]time.Time
	sessionAEAD        cipher.AEAD
	tokenCache         map[[sha256.Size]byte]*dropboxTokenSource
	catalog            map[string]track
	playlists          map[string]playlist
	playlistsFinalized bool
	indexerTokens      *dropboxTokenSource
	importStatus       playlistImportStatus
	sourceScanStatus   playlistSourceScanStatus
}

func main() {
	log.SetFlags(0)
	if len(os.Args) != 2 {
		log.Fatal("usage: radio serve|authorize-indexer")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var err error
	switch os.Args[1] {
	case "serve":
		err = runServer(ctx, loadConfig("TUNA"))
	case "authorize-indexer":
		err = authorizeIndexer(ctx, loadConfig("INDEXER"))
	default:
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		log.Fatal(err)
	}
}

func loadConfig(prefix string) config {
	dataPath := env("DATA_PATH", "/data/radio.db")
	return config{
		listenAddr:       env("LISTEN_ADDR", ":8080"),
		dataPath:         dataPath,
		publicURL:        strings.TrimRight(env("PUBLIC_URL", "https://radio.vandrowka.com"), "/"),
		dropboxRoot:      env("DROPBOX_ROOT", "/audio"),
		allowedAccountID: os.Getenv("DROPBOX_ALLOWED_ACCOUNT_ID"),
		appKey:           os.Getenv(prefix + "_DROPBOX_APP_KEY"),
		appSecret:        os.Getenv(prefix + "_DROPBOX_APP_SECRET"),
		refreshToken:     os.Getenv(prefix + "_DROPBOX_REFRESH_TOKEN"),
		playlistPath:     env("PLAYLIST_PATH", filepath.Join(filepath.Dir(dataPath), "playlists.db")),
		missingPath:      env("MISSING_DROPBOX_PATH", "/audio/missing.yml"),
		indexerAppKey:    os.Getenv("INDEXER_DROPBOX_APP_KEY"),
		indexerAppSecret: os.Getenv("INDEXER_DROPBOX_APP_SECRET"),
		indexerRefresh:   os.Getenv("INDEXER_DROPBOX_REFRESH_TOKEN"),
	}
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func validateConfig(cfg config) error {
	missing := make([]string, 0, 4)
	if cfg.appKey == "" {
		missing = append(missing, "DROPBOX_APP_KEY")
	}
	if cfg.appSecret == "" {
		missing = append(missing, "DROPBOX_APP_SECRET")
	}
	if cfg.allowedAccountID == "" {
		missing = append(missing, "DROPBOX_ALLOWED_ACCOUNT_ID")
	}
	if len(missing) != 0 {
		return fmt.Errorf("missing configuration: %s", strings.Join(missing, ", "))
	}
	return nil
}

func applyPathIdentity(item track) track {
	path := strings.Trim(firstNonempty(item.Path, item.Name), "/")
	parts := strings.Split(path, "/")
	filename := item.Name
	if len(parts) != 0 {
		filename = parts[len(parts)-1]
	}
	stem := strings.TrimSpace(strings.TrimSuffix(filename, filepath.Ext(filename)))
	if item.TrackNumber == 0 {
		item.TrackNumber = leadingInteger(stem)
	}
	if item.Title == "" {
		item.Title = stripTrackPrefix(stem)
		if item.Title == "" {
			item.Title = stem
		}
	}
	item.Tags = nil
	return item
}

func stripTrackPrefix(value string) string {
	value = strings.TrimSpace(value)
	i := 0
	for i < len(value) && ((value[i] >= '0' && value[i] <= '9') || value[i] == ' ' || value[i] == '.' || value[i] == '-' || value[i] == '_') {
		i++
	}
	if i == 0 || i == len(value) {
		return value
	}
	return strings.TrimSpace(value[i:])
}

func firstNonempty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func leadingInteger(value string) int {
	value = strings.TrimSpace(value)
	end := 0
	for end < len(value) && value[end] >= '0' && value[end] <= '9' {
		end++
	}
	if end == 0 {
		return 0
	}
	result, _ := strconv.Atoi(value[:end])
	return result
}

func runServer(ctx context.Context, cfg config) error {
	if err := validateConfig(cfg); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(cfg.dataPath), 0o700); err != nil {
		return err
	}
	catalog, err := loadTracks(cfg.dataPath)
	if err != nil {
		return err
	}
	playlistState, err := loadPlaylists(cfg.playlistPath)
	if err != nil {
		return err
	}
	sessionKey := sha256.Sum256([]byte("radio-session-v1\x00" + cfg.appSecret))
	sessionBlock, err := aes.NewCipher(sessionKey[:])
	if err != nil {
		return err
	}
	sessionAEAD, err := cipher.NewGCM(sessionBlock)
	if err != nil {
		return err
	}
	s := &server{cfg: cfg, ctx: ctx, states: map[string]time.Time{}, sessionAEAD: sessionAEAD, tokenCache: map[[sha256.Size]byte]*dropboxTokenSource{}, catalog: catalog, playlists: playlistMap(playlistState.Playlists), playlistsFinalized: playlistState.Finalized}
	if cfg.indexerAppKey != "" && cfg.indexerAppSecret != "" && cfg.indexerRefresh != "" {
		s.indexerTokens = &dropboxTokenSource{appKey: cfg.indexerAppKey, appSecret: cfg.indexerAppSecret, refreshToken: cfg.indexerRefresh}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("/auth/dropbox", s.login)
	mux.HandleFunc("/auth/callback", s.callback)
	mux.HandleFunc("/auth/logout", s.logout)
	mux.HandleFunc("/api/me", s.me)
	mux.HandleFunc("/api/tracks", s.tracks)
	mux.HandleFunc("/api/playlists", s.playlistList)
	mux.HandleFunc("/api/playlists/import", s.playlistImport)
	mux.HandleFunc("/api/playlists/import/status", s.playlistImportState)
	mux.HandleFunc("/api/index", s.indexTrack)
	mux.HandleFunc("/api/index/playlists", s.indexPlaylists)
	mux.HandleFunc("/api/index/playlists/candidates", s.indexPlaylistCandidates)
	mux.HandleFunc("/api/index/playlists/dropbox", s.indexDropboxPlaylists)
	mux.HandleFunc("/api/index/playlists/finalize", s.finalizePlaylists)
	mux.HandleFunc("/api/stream/", s.stream)
	mux.HandleFunc("/", s.index)
	handler := securityHeaders(mux)
	httpServer := &http.Server{Addr: cfg.listenAddr, Handler: handler, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}
	errChannel := make(chan error, 1)
	go func() { errChannel <- httpServer.ListenAndServe() }()
	log.Printf("radio listening on %s", cfg.listenAddr)
	select {
	case <-ctx.Done():
		shutdownContext, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		return httpServer.Shutdown(shutdownContext)
	case err := <-errChannel:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self' https://*.dropboxusercontent.com; media-src 'self' https://*.dropboxusercontent.com; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

func (s *server) index(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	content, err := playerFS.ReadFile("player/index.html")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(content)
}

func (s *server) login(w http.ResponseWriter, r *http.Request) {
	state, err := randomToken()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.mu.Lock()
	s.states[state] = time.Now().Add(10 * time.Minute)
	s.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "radio_oauth_state", Value: state, Path: "/auth/callback", MaxAge: 600, HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode})
	query := url.Values{
		"client_id":         {s.cfg.appKey},
		"response_type":     {"code"},
		"token_access_type": {"offline"},
		"redirect_uri":      {s.cfg.publicURL + "/auth/callback"},
		"state":             {state},
		"scope":             {"account_info.read files.metadata.read files.content.read files.content.write"},
	}
	http.Redirect(w, r, "https://www.dropbox.com/oauth2/authorize?"+query.Encode(), http.StatusFound)
}

func (s *server) callback(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	cookie, err := r.Cookie("radio_oauth_state")
	if err != nil || state == "" || cookie.Value != state {
		http.Error(w, "invalid OAuth state", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	expiresAt, found := s.states[state]
	delete(s.states, state)
	s.mu.Unlock()
	if !found || time.Now().After(expiresAt) {
		http.Error(w, "expired OAuth state", http.StatusBadRequest)
		return
	}
	response, err := exchangeDropboxCode(r.Context(), s.cfg, r.URL.Query().Get("code"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	accountID, err := getCurrentAccount(r.Context(), response.AccessToken)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	if accountID != s.cfg.allowedAccountID {
		http.Error(w, "Dropbox account is outside the allowed account", http.StatusForbidden)
		return
	}
	if response.RefreshToken == "" {
		http.Error(w, "Dropbox returned no refresh token", http.StatusBadGateway)
		return
	}
	tokens := &dropboxTokenSource{appKey: s.cfg.appKey, appSecret: s.cfg.appSecret, accessToken: response.AccessToken, refreshToken: response.RefreshToken, expiresAt: time.Now().Add(time.Duration(response.ExpiresIn) * time.Second)}
	tokenKey := sha256.Sum256([]byte(response.RefreshToken))
	s.mu.Lock()
	s.tokenCache[tokenKey] = tokens
	s.mu.Unlock()
	if err := s.setSessionCookie(w, &session{tokens: tokens, accountID: accountID, refreshToken: response.RefreshToken}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/", http.StatusFound)
}

func (s *server) logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: "radio_session", Value: "", Path: "/", MaxAge: -1, Expires: time.Unix(1, 0), HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode})
	http.Redirect(w, r, "/", http.StatusFound)
}

func (s *server) authenticated(r *http.Request) (*session, bool) {
	cookie, err := r.Cookie("radio_session")
	if err != nil {
		return nil, false
	}
	encoded, err := base64.RawURLEncoding.DecodeString(cookie.Value)
	if err != nil || len(encoded) < s.sessionAEAD.NonceSize() {
		return nil, false
	}
	nonce := encoded[:s.sessionAEAD.NonceSize()]
	plaintext, err := s.sessionAEAD.Open(nil, nonce, encoded[s.sessionAEAD.NonceSize():], []byte("radio_session\x00"+s.cfg.publicURL))
	if err != nil {
		return nil, false
	}
	var envelope sessionEnvelope
	if err := json.Unmarshal(plaintext, &envelope); err != nil || envelope.AccountID != s.cfg.allowedAccountID || envelope.RefreshToken == "" || time.Now().Unix() >= envelope.ExpiresAt {
		return nil, false
	}
	tokenKey := sha256.Sum256([]byte(envelope.RefreshToken))
	s.mu.RLock()
	tokens := s.tokenCache[tokenKey]
	s.mu.RUnlock()
	if tokens == nil {
		tokens = &dropboxTokenSource{appKey: s.cfg.appKey, appSecret: s.cfg.appSecret, refreshToken: envelope.RefreshToken}
		s.mu.Lock()
		if current := s.tokenCache[tokenKey]; current != nil {
			tokens = current
		} else {
			s.tokenCache[tokenKey] = tokens
		}
		s.mu.Unlock()
	}
	return &session{tokens: tokens, accountID: envelope.AccountID, refreshToken: envelope.RefreshToken}, true
}

func (s *server) setSessionCookie(w http.ResponseWriter, current *session) error {
	expires := time.Now().Add(time.Duration(sessionMaxAge) * time.Second)
	plaintext, err := json.Marshal(sessionEnvelope{AccountID: current.accountID, RefreshToken: current.refreshToken, ExpiresAt: expires.Unix()})
	if err != nil {
		return err
	}
	nonce := make([]byte, s.sessionAEAD.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	sealed := s.sessionAEAD.Seal(nonce, nonce, plaintext, []byte("radio_session\x00"+s.cfg.publicURL))
	http.SetCookie(w, &http.Cookie{Name: "radio_session", Value: base64.RawURLEncoding.EncodeToString(sealed), Path: "/", MaxAge: sessionMaxAge, Expires: expires, HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode})
	return nil
}

func (s *server) me(w http.ResponseWriter, r *http.Request) {
	current, ok := s.authenticated(r)
	if !ok {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	if err := s.setSessionCookie(w, current); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"accountId": current.accountID})
}

func (s *server) tracks(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authenticated(r); !ok {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	catalog, err := loadTracks(s.cfg.dataPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	items := make([]track, 0, len(catalog))
	for _, item := range catalog {
		if !item.Deleted {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		left := strings.ToLower(items[i].Artist + "\x00" + items[i].Album + fmt.Sprintf("\x00%05d\x00%05d\x00", items[i].DiscNumber, items[i].TrackNumber) + items[i].Title)
		right := strings.ToLower(items[j].Artist + "\x00" + items[j].Album + fmt.Sprintf("\x00%05d\x00%05d\x00", items[j].DiscNumber, items[j].TrackNumber) + items[j].Title)
		return left < right
	})
	s.mu.Lock()
	s.catalog = catalog
	s.mu.Unlock()
	writeJSON(w, items)
}

func playlistKey(item playlist) string {
	return strings.ToLower(strings.TrimSpace(item.Source)) + "\x00" + strings.TrimSpace(item.URI)
}

func (s *server) indexerAuthenticated(r *http.Request) bool {
	provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	return s.cfg.indexerAppSecret != "" && len(provided) == len(s.cfg.indexerAppSecret) && subtle.ConstantTimeCompare([]byte(provided), []byte(s.cfg.indexerAppSecret)) == 1
}

func (s *server) indexTrack(w http.ResponseWriter, r *http.Request) {
	if !s.indexerAuthenticated(r) {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	if r.Method == http.MethodGet {
		s.mu.RLock()
		revisions := make(map[string]string, len(s.catalog))
		for id, item := range s.catalog {
			revisions[id] = item.Rev
		}
		s.mu.RUnlock()
		writeJSON(w, revisions)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var item track
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&item); err != nil {
		http.Error(w, "invalid index record", http.StatusBadRequest)
		return
	}
	if item.ID == "" || item.Rev == "" || item.Path == "" || item.Name == "" || strings.TrimSpace(item.Artist) == "" {
		http.Error(w, "incomplete index record", http.StatusBadRequest)
		return
	}
	if strings.EqualFold(strings.TrimSpace(item.Artist), "unknown") || (item.Artist != "?" && item.Artist != "N/A" && !strings.ContainsFunc(item.Artist, unicode.IsLetter)) {
		http.Error(w, "invalid artist", http.StatusBadRequest)
		return
	}
	item = applyPathIdentity(item)
	definitions := s.playlistDefinitions()
	item.Playlists = append(item.Playlists, exactPlaylistMemberships(definitions, item)...)
	membershipKeys := make(map[string]struct{}, len(item.Playlists))
	uniqueMemberships := make([]playlistMembership, 0, len(item.Playlists))
	for _, membership := range item.Playlists {
		membership.Source = strings.TrimSpace(membership.Source)
		membership.PlaylistURI = strings.TrimSpace(membership.PlaylistURI)
		membership.PlaylistName = strings.TrimSpace(membership.PlaylistName)
		if !playlistSourceAllowed(membership.Source) || membership.PlaylistURI == "" || membership.PlaylistName == "" || !playlistMembershipDefined(definitions, membership, item) {
			http.Error(w, "invalid playlist membership", http.StatusBadRequest)
			return
		}
		key := playlistMembershipKey(membership)
		if _, exists := membershipKeys[key]; exists {
			continue
		}
		membershipKeys[key] = struct{}{}
		uniqueMemberships = append(uniqueMemberships, membership)
	}
	item.Playlists = uniqueMemberships
	if err := appendTrack(s.cfg.dataPath, item); err != nil {
		http.Error(w, "catalog write failed", http.StatusInternalServerError)
		return
	}
	s.mu.Lock()
	s.catalog[item.ID] = item
	s.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

var playlistSourceFolders = []string{
	"Spotify",
	"YouTube",
	"Holdy_ Last.fm",
	"References in composing repo",
	"Dropbox audio/music*",
	"Foobar2000 legacy",
}

func playlistSourceAllowed(source string) bool {
	for _, allowed := range playlistSourceFolders {
		if source == allowed {
			return true
		}
	}
	return false
}

func playlistMembershipKey(membership playlistMembership) string {
	return membership.Source + "\x00" + membership.PlaylistURI + "\x00" + strconv.Itoa(membership.Position) + "\x00" + normalizeName(membership.Artist) + "\x00" + normalizeName(membership.Album) + "\x00" + normalizeName(membership.Track)
}

func playlistRowKey(source, uri string, position int) string {
	return playlistKey(playlist{Source: source, URI: uri}) + "\x00" + strconv.Itoa(position)
}

func playlistMembershipFromItem(definition playlist, source playlistItem, indexed track) playlistMembership {
	membership := playlistMembership{
		Source:       definition.Source,
		PlaylistURI:  definition.URI,
		PlaylistName: definition.Name,
		ItemURI:      source.URI,
		Artist:       source.Artist,
		Album:        source.Album,
		Track:        source.Track,
		Position:     source.Position,
	}
	if source.AllTracksByArtist {
		membership.Artist = indexed.Artist
		membership.Album = indexed.Album
		membership.Track = indexed.Title
		membership.Position = -1
	}
	return membership
}

func playlistPathsMatch(left, right string) bool {
	left = normalizePlaylistPath(left)
	right = normalizePlaylistPath(right)
	if left == "" || right == "" {
		return false
	}
	return left == right
}

func playlistItemExactMatch(source playlistItem, indexed track) bool {
	if playlistPathsMatch(source.Path, indexed.Path) {
		return true
	}
	if source.AllTracksByArtist {
		return normalizeName(source.Artist) != "" && normalizeName(source.Artist) == normalizeName(indexed.Artist)
	}
	if normalizeName(source.Artist) == "" || normalizeName(source.Album) == "" || normalizeName(source.Track) == "" {
		return false
	}
	return normalizeName(source.Artist) == normalizeName(indexed.Artist) &&
		normalizeName(source.Album) == normalizeName(indexed.Album) &&
		normalizeName(source.Track) == normalizeName(indexed.Title)
}

func playlistItemMayMatch(source playlistItem, indexed track) bool {
	if playlistItemExactMatch(source, indexed) {
		return true
	}
	pathName := normalizeName(indexed.Path)
	if source.AllTracksByArtist {
		artistName := normalizeName(source.Artist)
		return artistName != "" && strings.Contains(pathName, artistName)
	}
	trackName := normalizeName(source.Track)
	indexedTrack := normalizeName(indexed.Title)
	if trackName == "" || !(strings.Contains(pathName, trackName) || strings.Contains(trackName, indexedTrack) || strings.Contains(indexedTrack, trackName)) {
		return false
	}
	artistName := normalizeName(source.Artist)
	if artistName != "" && artistName != normalizeName(indexed.Artist) && !strings.Contains(pathName, artistName) {
		return false
	}
	albumName := normalizeName(source.Album)
	return albumName == "" || albumName == normalizeName(indexed.Album) || strings.Contains(pathName, albumName)
}

func (s *server) playlistDefinitions() []playlist {
	s.mu.RLock()
	definitions := make([]playlist, 0, len(s.playlists))
	for _, definition := range s.playlists {
		definitions = append(definitions, definition)
	}
	s.mu.RUnlock()
	return definitions
}

func exactPlaylistMemberships(definitions []playlist, indexed track) []playlistMembership {
	memberships := []playlistMembership{}
	for _, definition := range definitions {
		for _, source := range definition.Items {
			if playlistItemExactMatch(source, indexed) {
				memberships = append(memberships, playlistMembershipFromItem(definition, source, indexed))
			}
		}
	}
	sort.Slice(memberships, func(i, j int) bool {
		return playlistMembershipKey(memberships[i]) < playlistMembershipKey(memberships[j])
	})
	return memberships
}

func playlistMembershipDefined(definitions []playlist, membership playlistMembership, indexed track) bool {
	for _, definition := range definitions {
		if definition.Source != membership.Source || definition.URI != membership.PlaylistURI || definition.Name != membership.PlaylistName {
			continue
		}
		if membership.Position >= 0 && membership.Position < len(definition.Items) {
			source := definition.Items[membership.Position]
			return !source.AllTracksByArtist && source.Position == membership.Position && source.URI == membership.ItemURI &&
				normalizeName(source.Artist) == normalizeName(membership.Artist) &&
				normalizeName(source.Album) == normalizeName(membership.Album) &&
				normalizeName(source.Track) == normalizeName(membership.Track)
		}
		if membership.Position == -1 && normalizeName(membership.Artist) == normalizeName(indexed.Artist) &&
			normalizeName(membership.Album) == normalizeName(indexed.Album) && normalizeName(membership.Track) == normalizeName(indexed.Title) {
			for _, source := range definition.Items {
				if source.AllTracksByArtist && source.URI == membership.ItemURI && normalizeName(source.Artist) == normalizeName(indexed.Artist) {
					return true
				}
			}
		}
		return false
	}
	return false
}

func (s *server) indexPlaylistCandidates(w http.ResponseWriter, r *http.Request) {
	if !s.indexerAuthenticated(r) {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var indexed track
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&indexed); err != nil || strings.TrimSpace(indexed.Path) == "" || strings.TrimSpace(indexed.Artist) == "" {
		http.Error(w, "invalid path identity", http.StatusBadRequest)
		return
	}
	indexed = applyPathIdentity(indexed)
	candidates := []playlistCandidate{}
	for _, definition := range s.playlistDefinitions() {
		for _, source := range definition.Items {
			if playlistItemMayMatch(source, indexed) {
				candidates = append(candidates, playlistCandidate{Source: definition.Source, PlaylistURI: definition.URI, PlaylistName: definition.Name, Item: source})
			}
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		left := candidates[i].Source + "\x00" + candidates[i].PlaylistURI + "\x00" + strconv.Itoa(candidates[i].Item.Position)
		right := candidates[j].Source + "\x00" + candidates[j].PlaylistURI + "\x00" + strconv.Itoa(candidates[j].Item.Position)
		return left < right
	})
	writeJSON(w, candidates)
}

func playlistMap(items []playlist) map[string]playlist {
	result := make(map[string]playlist, len(items))
	for _, item := range items {
		result[playlistKey(item)] = item
	}
	return result
}

func playlistSlice(items map[string]playlist) []playlist {
	result := make([]playlist, 0, len(items))
	for _, item := range items {
		result = append(result, item)
	}
	sort.Slice(result, func(i, j int) bool {
		return strings.ToLower(result[i].Source+"\x00"+result[i].Name+"\x00"+result[i].URI) < strings.ToLower(result[j].Source+"\x00"+result[j].Name+"\x00"+result[j].URI)
	})
	return result
}

func (s *server) snapshotPlaylists() playlistStore {
	s.mu.RLock()
	state := playlistStore{Finalized: s.playlistsFinalized, Playlists: playlistSlice(s.playlists)}
	s.mu.RUnlock()
	return state
}

func (s *server) snapshotCatalog() map[string]track {
	s.mu.RLock()
	catalog := make(map[string]track, len(s.catalog))
	for id, item := range s.catalog {
		catalog[id] = item
	}
	s.mu.RUnlock()
	return catalog
}

func materializePlaylists(definitions map[string]playlist, catalog map[string]track) map[string]playlist {
	items := make(map[string]playlist, len(definitions))
	for key, definition := range definitions {
		copyOfDefinition := definition
		copyOfDefinition.Items = make([]playlistItem, 0, len(definition.Items))
		for _, item := range definition.Items {
			if item.AllTracksByArtist {
				continue
			}
			item.TrackID = ""
			copyOfDefinition.Items = append(copyOfDefinition.Items, item)
		}
		items[key] = copyOfDefinition
	}
	for _, indexed := range catalog {
		for _, membership := range indexed.Playlists {
			candidate := playlist{Source: membership.Source, URI: membership.PlaylistURI, Name: membership.PlaylistName}
			key := playlistKey(candidate)
			current := items[key]
			if current.Source == "" {
				current = candidate
			}
			found := false
			for i := range current.Items {
				if current.Items[i].Position == membership.Position && missingKey(current.Items[i]) == missingKey(playlistItem{Artist: membership.Artist, Album: membership.Album, Track: membership.Track}) {
					current.Items[i].TrackID = indexed.ID
					found = true
					break
				}
			}
			if !found {
				current.Items = append(current.Items, playlistItem{URI: membership.ItemURI, Artist: membership.Artist, Album: membership.Album, Track: membership.Track, Position: membership.Position, TrackID: indexed.ID})
			}
			sort.SliceStable(current.Items, func(i, j int) bool {
				leftDynamic := current.Items[i].Position < 0
				rightDynamic := current.Items[j].Position < 0
				if leftDynamic != rightDynamic {
					return !leftDynamic
				}
				if leftDynamic {
					return missingKey(current.Items[i]) < missingKey(current.Items[j])
				}
				return current.Items[i].Position < current.Items[j].Position
			})
			items[key] = current
		}
	}
	return items
}

func playlistFolders(items map[string]playlist) []playlistFolder {
	bySource := make(map[string][]playlist, len(playlistSourceFolders))
	for _, item := range items {
		bySource[item.Source] = append(bySource[item.Source], item)
	}
	result := make([]playlistFolder, 0, len(playlistSourceFolders))
	for _, source := range playlistSourceFolders {
		playlists := bySource[source]
		sort.Slice(playlists, func(i, j int) bool {
			return strings.ToLower(playlists[i].Name+"\x00"+playlists[i].URI) < strings.ToLower(playlists[j].Name+"\x00"+playlists[j].URI)
		})
		result = append(result, playlistFolder{Source: source, Playlists: playlists})
	}
	return result
}

func (s *server) playlistList(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authenticated(r); !ok {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	state := s.snapshotPlaylists()
	if !state.Finalized {
		writeJSON(w, []playlistFolder{})
		return
	}
	catalog := s.snapshotCatalog()
	definitions := playlistMap(state.Playlists)
	s.mu.Lock()
	s.playlists = definitions
	s.playlistsFinalized = true
	s.catalog = catalog
	s.mu.Unlock()
	writeJSON(w, playlistFolders(materializePlaylists(definitions, catalog)))
}

func normalizePlaylistDefinitions(input playlistImport, existing playlistStore) (playlistStore, error) {
	items := playlistMap(existing.Playlists)
	for _, candidate := range input.Playlists {
		candidate.Source = strings.TrimSpace(candidate.Source)
		candidate.URI = strings.TrimSpace(candidate.URI)
		candidate.Name = strings.TrimSpace(candidate.Name)
		if !playlistSourceAllowed(candidate.Source) || candidate.URI == "" || candidate.Name == "" {
			return playlistStore{}, fmt.Errorf("invalid playlist definition")
		}
		for i := range candidate.Items {
			candidate.Items[i].Position = i
			candidate.Items[i].TrackID = ""
			candidate.Items[i].Path = strings.TrimSpace(candidate.Items[i].Path)
			candidate.Items[i].Artist = strings.TrimSpace(candidate.Items[i].Artist)
			if candidate.Items[i].AllTracksByArtist {
				candidate.Items[i].Path = ""
				candidate.Items[i].Album = ""
				candidate.Items[i].Track = ""
				if candidate.Items[i].Artist == "" {
					return playlistStore{}, fmt.Errorf("playlist %q has an all-tracks rule without an artist", candidate.Name)
				}
				continue
			}
			if strings.TrimSpace(candidate.Items[i].Track) == "" {
				return playlistStore{}, fmt.Errorf("playlist %q has an empty track", candidate.Name)
			}
		}
		items[playlistKey(candidate)] = candidate
	}
	return playlistStore{Finalized: false, Playlists: playlistSlice(items)}, nil
}

func (s *server) storePlaylistDefinitions(input playlistImport) (playlistStore, error) {
	s.importMu.Lock()
	defer s.importMu.Unlock()
	state := s.snapshotPlaylists()
	var err error
	state, err = normalizePlaylistDefinitions(input, state)
	if err != nil {
		return playlistStore{}, err
	}
	if err := writePlaylists(s.cfg.playlistPath, state); err != nil {
		return playlistStore{}, err
	}
	s.mu.Lock()
	s.playlists = playlistMap(state.Playlists)
	s.playlistsFinalized = false
	s.mu.Unlock()
	return state, nil
}

func (s *server) indexPlaylists(w http.ResponseWriter, r *http.Request) {
	if !s.indexerAuthenticated(r) {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	if r.Method == http.MethodGet {
		writeJSON(w, s.snapshotPlaylists())
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var input playlistImport
	reader := http.MaxBytesReader(w, r.Body, 64<<20)
	if err := json.NewDecoder(reader).Decode(&input); err != nil {
		http.Error(w, "invalid playlist definitions", http.StatusBadRequest)
		return
	}
	state, err := s.storePlaylistDefinitions(input)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, map[string]int{"playlists": len(state.Playlists)})
}

var playlistFileExtensions = map[string]struct{}{
	".asx": {}, ".fpl": {}, ".fplite": {}, ".m3u": {}, ".m3u8": {},
	".pls": {}, ".wax": {}, ".wpl": {}, ".wvx": {}, ".xspf": {}, ".zpl": {},
}

var playlistProbeExtensions = map[string]struct{}{
	"": {}, ".json": {}, ".txt": {}, ".xml": {},
}

func (s *server) indexDropboxPlaylists(w http.ResponseWriter, r *http.Request) {
	if !s.indexerAuthenticated(r) {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	if r.Method == http.MethodGet {
		s.mu.RLock()
		status := s.sourceScanStatus
		s.mu.RUnlock()
		writeJSON(w, status)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.indexerTokens == nil {
		http.Error(w, "playlist reader unavailable", http.StatusServiceUnavailable)
		return
	}
	s.mu.Lock()
	if s.sourceScanStatus.Running {
		status := s.sourceScanStatus
		s.mu.Unlock()
		writeJSON(w, status)
		return
	}
	s.sourceScanStatus = playlistSourceScanStatus{Running: true}
	s.mu.Unlock()
	go s.scanDropboxPlaylists()
	w.WriteHeader(http.StatusAccepted)
}

func (s *server) setSourceScanStatus(status playlistSourceScanStatus) {
	s.mu.Lock()
	s.sourceScanStatus = status
	s.mu.Unlock()
}

func (s *server) scanDropboxPlaylists() {
	status := playlistSourceScanStatus{Running: true}
	err := s.runDropboxPlaylistScan(&status)
	status.Running = false
	if err != nil {
		status.Error = err.Error()
	}
	s.setSourceScanStatus(status)
}

func (s *server) runDropboxPlaylistScan(status *playlistSourceScanStatus) error {
	if err := s.clearPlaylistSources("Dropbox audio/music*", "Foobar2000 legacy"); err != nil {
		return err
	}
	accessToken, err := s.indexerTokens.token(s.ctx)
	if err != nil {
		return err
	}
	requestBody := map[string]any{"path": "", "recursive": true, "include_deleted": false, "limit": 2000}
	endpoint := dropboxAPI + "/files/list_folder"
	for {
		var page listFolderResponse
		if err := dropboxJSON(s.ctx, accessToken, endpoint, requestBody, &page); err != nil {
			return err
		}
		pageDefinitions := playlistImport{}
		pageCandidates := 0
		pageTracks := 0
		for _, entry := range page.Entries {
			sources := playlistSourcesForPath(entry)
			if len(sources) == 0 {
				continue
			}
			content, err := downloadDropboxFile(s.ctx, accessToken, entry.ID)
			if err != nil {
				return fmt.Errorf("%s: %w", entry.PathDisplay, err)
			}
			items, err := parsePlaylistItems(entry, content)
			if err != nil {
				return fmt.Errorf("%s: %w", entry.PathDisplay, err)
			}
			pageCandidates++
			for _, source := range sources {
				pageDefinitions.Playlists = append(pageDefinitions.Playlists, playlist{
					Source: source,
					URI:    "dropbox:" + entry.ID,
					Name:   entry.Name,
					Items:  items,
				})
				pageTracks += len(items)
			}
		}
		if len(pageDefinitions.Playlists) > 0 {
			if _, err := s.storePlaylistDefinitions(pageDefinitions); err != nil {
				return err
			}
		}
		status.Candidates += pageCandidates
		status.Playlists += len(pageDefinitions.Playlists)
		status.Tracks += pageTracks
		status.Pages++
		s.setSourceScanStatus(*status)
		if !page.HasMore {
			return nil
		}
		requestBody = map[string]any{"cursor": page.Cursor}
		endpoint = dropboxAPI + "/files/list_folder/continue"
	}
}

func (s *server) clearPlaylistSources(sources ...string) error {
	s.importMu.Lock()
	defer s.importMu.Unlock()
	selected := make(map[string]struct{}, len(sources))
	for _, source := range sources {
		selected[source] = struct{}{}
	}
	state := s.snapshotPlaylists()
	kept := state.Playlists[:0]
	for _, item := range state.Playlists {
		if _, remove := selected[item.Source]; !remove {
			kept = append(kept, item)
		}
	}
	state.Playlists = kept
	state.Finalized = false
	if err := writePlaylists(s.cfg.playlistPath, state); err != nil {
		return err
	}
	s.mu.Lock()
	s.playlists = playlistMap(state.Playlists)
	s.playlistsFinalized = false
	s.mu.Unlock()
	return nil
}

func playlistSourcesForPath(entry remoteEntry) []string {
	if entry.Tag != "file" {
		return nil
	}
	lower := strings.ToLower(strings.ReplaceAll(entry.PathLower, "\\", "/"))
	extension := strings.ToLower(path.Ext(lower))
	_, knownExtension := playlistFileExtensions[extension]
	_, probeExtension := playlistProbeExtensions[extension]
	parts := strings.Split(strings.TrimPrefix(lower, "/"), "/")
	underAudioMusic := len(parts) > 1 && parts[0] == "audio" && strings.HasPrefix(parts[1], "music")
	playlistNamed := strings.Contains(path.Base(lower), "playlist") || strings.Contains(path.Base(path.Dir(lower)), "playlist")
	foobarNamed := strings.Contains(lower, "foobar")
	result := make([]string, 0, 2)
	if underAudioMusic && (knownExtension || (playlistNamed && probeExtension)) {
		result = append(result, "Dropbox audio/music*")
	}
	if knownExtension || (foobarNamed && playlistNamed && probeExtension) {
		result = append(result, "Foobar2000 legacy")
	}
	return result
}

func parsePlaylistItems(entry remoteEntry, content []byte) ([]playlistItem, error) {
	extension := strings.ToLower(path.Ext(entry.Name))
	switch extension {
	case ".fpl":
		return parseFPLPlaylist(entry, content)
	case ".pls":
		return parsePLSPlaylist(entry, content)
	case ".asx", ".wax", ".wpl", ".wvx", ".xspf", ".zpl":
		return parseXMLPlaylist(entry, content)
	case ".m3u", ".m3u8":
		return parseM3UPlaylist(entry, content)
	}
	trimmed := bytes.TrimSpace(content)
	if len(trimmed) >= len(fplMagic) && bytes.Equal(trimmed[:len(fplMagic)], fplMagic) {
		return parseFPLPlaylist(entry, trimmed)
	}
	if len(trimmed) > 0 && trimmed[0] == '<' {
		return parseXMLPlaylist(entry, trimmed)
	}
	if len(trimmed) > 0 && trimmed[0] == '[' && bytes.Contains(bytes.ToLower(trimmed), []byte("file1=")) {
		return parsePLSPlaylist(entry, trimmed)
	}
	if bytes.IndexByte(trimmed, 0) >= 0 {
		return nil, fmt.Errorf("unsupported binary playlist format")
	}
	return parseM3UPlaylist(entry, trimmed)
}

func parseM3UPlaylist(entry remoteEntry, content []byte) ([]playlistItem, error) {
	lines := strings.Split(strings.TrimPrefix(strings.ReplaceAll(string(content), "\r\n", "\n"), "\ufeff"), "\n")
	items := make([]playlistItem, 0, len(lines))
	label := ""
	for _, line := range lines {
		line = strings.TrimSpace(strings.TrimSuffix(line, "\r"))
		if strings.HasPrefix(strings.ToUpper(line), "#EXTINF:") {
			if comma := strings.IndexByte(line, ','); comma >= 0 {
				label = strings.TrimSpace(line[comma+1:])
			}
			continue
		}
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		item, err := playlistItemFromReference(entry, line, label, len(items))
		if err != nil {
			return nil, err
		}
		items = append(items, item)
		label = ""
	}
	return items, nil
}

func parsePLSPlaylist(entry remoteEntry, content []byte) ([]playlistItem, error) {
	type plsItem struct{ path, title string }
	values := map[int]plsItem{}
	for _, line := range strings.Split(strings.ReplaceAll(string(content), "\r\n", "\n"), "\n") {
		key, value, found := strings.Cut(strings.TrimSpace(strings.TrimSuffix(line, "\r")), "=")
		if !found {
			continue
		}
		lower := strings.ToLower(strings.TrimSpace(key))
		value = strings.TrimSpace(value)
		var prefix string
		switch {
		case strings.HasPrefix(lower, "file"):
			prefix = "file"
		case strings.HasPrefix(lower, "title"):
			prefix = "title"
		default:
			continue
		}
		index, err := strconv.Atoi(strings.TrimPrefix(lower, prefix))
		if err != nil || index < 1 {
			continue
		}
		current := values[index]
		if prefix == "file" {
			current.path = value
		} else {
			current.title = value
		}
		values[index] = current
	}
	positions := make([]int, 0, len(values))
	for index, item := range values {
		if item.path != "" {
			positions = append(positions, index)
		}
	}
	sort.Ints(positions)
	items := make([]playlistItem, 0, len(positions))
	for _, index := range positions {
		current := values[index]
		item, err := playlistItemFromReference(entry, current.path, current.title, len(items))
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func parseXMLPlaylist(entry remoteEntry, content []byte) ([]playlistItem, error) {
	decoder := xml.NewDecoder(bytes.NewReader(content))
	items := []playlistItem{}
	captureLocation := false
	var location strings.Builder
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			return items, nil
		}
		if err != nil {
			return nil, err
		}
		switch value := token.(type) {
		case xml.StartElement:
			name := strings.ToLower(value.Name.Local)
			if name == "location" {
				captureLocation = true
				location.Reset()
			}
			for _, attribute := range value.Attr {
				attributeName := strings.ToLower(attribute.Name.Local)
				if attributeName != "href" && attributeName != "src" {
					continue
				}
				item, err := playlistItemFromReference(entry, attribute.Value, "", len(items))
				if err != nil {
					return nil, err
				}
				items = append(items, item)
			}
		case xml.CharData:
			if captureLocation {
				location.Write([]byte(value))
			}
		case xml.EndElement:
			if captureLocation && strings.EqualFold(value.Name.Local, "location") {
				item, err := playlistItemFromReference(entry, location.String(), "", len(items))
				if err != nil {
					return nil, err
				}
				items = append(items, item)
				captureLocation = false
			}
		}
	}
}

var fplMagic = []byte{0xE1, 0xA0, 0x9C, 0x91, 0xF8, 0x3C, 0x77, 0x42, 0x85, 0x2C, 0x3B, 0xCC, 0x14, 0x01, 0xD3, 0xF2}

func parseFPLPlaylist(entry remoteEntry, content []byte) ([]playlistItem, error) {
	if len(content) < 24 || !bytes.Equal(content[:len(fplMagic)], fplMagic) {
		return nil, fmt.Errorf("unsupported FPL signature")
	}
	dataSize := int(binary.LittleEndian.Uint32(content[16:20]))
	stringEnd := 20 + dataSize
	if dataSize < 0 || stringEnd+4 > len(content) {
		return nil, fmt.Errorf("invalid FPL string table")
	}
	stringTable := content[20:stringEnd]
	trackCount := int(binary.LittleEndian.Uint32(content[stringEnd : stringEnd+4]))
	offset := stringEnd + 4
	items := make([]playlistItem, 0, trackCount)
	for index := 0; index < trackCount; index++ {
		if offset+68 > len(content) {
			return nil, fmt.Errorf("truncated FPL track %d", index)
		}
		fileOffset := int(binary.LittleEndian.Uint32(content[offset+4 : offset+8]))
		keysDex := int(binary.LittleEndian.Uint32(content[offset+52 : offset+56]))
		if fileOffset < 0 || fileOffset >= len(stringTable) || keysDex < 3 {
			return nil, fmt.Errorf("invalid FPL track %d", index)
		}
		end := bytes.IndexByte(stringTable[fileOffset:], 0)
		if end < 0 {
			return nil, fmt.Errorf("unterminated FPL path %d", index)
		}
		reference := strings.ToValidUTF8(string(stringTable[fileOffset:fileOffset+end]), "�")
		item, err := playlistItemFromReference(entry, reference, "", len(items))
		if err != nil {
			return nil, err
		}
		items = append(items, item)
		realKeys := keysDex - 3
		if realKeys > (len(content)-offset-68)/4 {
			return nil, fmt.Errorf("invalid FPL key table %d", index)
		}
		offset += 68 + realKeys*4
	}
	return items, nil
}

func playlistItemFromReference(entry remoteEntry, reference, label string, position int) (playlistItem, error) {
	reference = strings.TrimSpace(reference)
	if reference == "" {
		return playlistItem{}, fmt.Errorf("empty playlist path")
	}
	resolved := reference
	if parsed, err := url.Parse(reference); err == nil && parsed.Scheme != "" {
		if decoded, decodeErr := url.PathUnescape(parsed.Path); decodeErr == nil && decoded != "" {
			resolved = decoded
		}
	}
	resolved = strings.ReplaceAll(resolved, "\\", "/")
	if !strings.HasPrefix(resolved, "/") && !(len(resolved) > 1 && resolved[1] == ':') && !strings.Contains(resolved, "://") {
		resolved = path.Join(path.Dir(entry.PathDisplay), resolved)
	}
	clean := strings.TrimSpace(strings.SplitN(strings.SplitN(resolved, "?", 2)[0], "#", 2)[0])
	base := path.Base(clean)
	trackName := strings.TrimSpace(strings.TrimSuffix(base, path.Ext(base)))
	if trackName == "" {
		trackName = strings.TrimSpace(label)
	}
	if trackName == "" {
		return playlistItem{}, fmt.Errorf("playlist path %q has no track name", reference)
	}
	parts := strings.Split(strings.Trim(clean, "/"), "/")
	artist, album := "", ""
	if len(parts) >= 2 {
		album = strings.TrimSpace(parts[len(parts)-2])
	}
	if len(parts) >= 3 {
		artist = strings.TrimSpace(parts[len(parts)-3])
	}
	return playlistItem{
		URI:      fmt.Sprintf("dropbox:%s#%d", entry.ID, position),
		Path:     resolved,
		Artist:   artist,
		Album:    album,
		Track:    trackName,
		Position: position,
	}, nil
}

func downloadDropboxFile(ctx context.Context, token, fileID string) ([]byte, error) {
	argument, _ := json.Marshal(map[string]string{"path": fileID})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, dropboxContent+"/files/download", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Dropbox-API-Arg", string(argument))
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		failure, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
		return nil, fmt.Errorf("Dropbox download: %s: %s", response.Status, strings.TrimSpace(string(failure)))
	}
	return io.ReadAll(response.Body)
}

func remotePathMayContain(item playlistItem, entries map[string]remoteEntry) bool {
	if referencePath := normalizePlaylistPath(item.Path); referencePath != "" {
		for _, entry := range entries {
			remotePath := normalizePlaylistPath(entry.PathDisplay)
			if remotePath == referencePath || strings.HasSuffix(remotePath, "/"+strings.TrimPrefix(referencePath, "/")) || strings.HasSuffix(referencePath, "/"+strings.TrimPrefix(remotePath, "/")) {
				return true
			}
		}
	}
	trackName := normalizeName(item.Track)
	artistName := normalizeName(item.Artist)
	albumName := normalizeName(item.Album)
	for _, entry := range entries {
		pathName := normalizeName(entry.PathDisplay)
		if trackName == "" || !strings.Contains(pathName, trackName) {
			continue
		}
		if artistName != "" && !strings.Contains(pathName, artistName) {
			continue
		}
		if albumName != "" && !strings.Contains(pathName, albumName) {
			continue
		}
		return true
	}
	return false
}

func normalizePlaylistPath(value string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if value == "" {
		return ""
	}
	if parsed, err := url.Parse(value); err == nil && parsed.Scheme != "" && parsed.Path != "" {
		if decoded, decodeErr := url.PathUnescape(parsed.Path); decodeErr == nil {
			value = decoded
		}
	}
	value = strings.ToLower(strings.SplitN(strings.SplitN(value, "?", 2)[0], "#", 2)[0])
	if audio := strings.Index(value, "/audio/"); audio >= 0 {
		value = value[audio:]
	}
	return strings.TrimRight(value, "/")
}

func (s *server) finalizePlaylists(w http.ResponseWriter, r *http.Request) {
	if !s.indexerAuthenticated(r) {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	if s.indexerTokens == nil {
		http.Error(w, "playlist writer unavailable", http.StatusServiceUnavailable)
		return
	}
	state := s.snapshotPlaylists()
	catalog := s.snapshotCatalog()
	accessToken, err := s.indexerTokens.token(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	remoteFiles, err := listRemoteFiles(r.Context(), accessToken, s.cfg.dropboxRoot)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	definitions := playlistMap(state.Playlists)
	matched := make(map[string]struct{})
	for _, indexed := range catalog {
		for _, membership := range indexed.Playlists {
			if membership.Position >= 0 {
				matched[playlistRowKey(membership.Source, membership.PlaylistURI, membership.Position)] = struct{}{}
			}
		}
	}
	missing := map[string]playlistItem{}
	for _, definition := range definitions {
		for _, sourceItem := range definition.Items {
			if sourceItem.AllTracksByArtist {
				continue
			}
			if _, present := matched[playlistRowKey(definition.Source, definition.URI, sourceItem.Position)]; present {
				continue
			}
			if remotePathMayContain(sourceItem, remoteFiles) {
				http.Error(w, "playlist track has a Dropbox path candidate but no indexed membership", http.StatusConflict)
				return
			}
			missing[missingKey(sourceItem)] = sourceItem
		}
	}
	if err := uploadDropboxFile(r.Context(), accessToken, s.cfg.missingPath, encodeMissingYAML(missing)); err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	state.Finalized = true
	if err := writePlaylists(s.cfg.playlistPath, state); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.mu.Lock()
	s.playlistsFinalized = true
	s.mu.Unlock()
	writeJSON(w, map[string]int{"playlists": len(definitions), "missing": len(missing)})
}

func (s *server) playlistImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := s.authenticated(r); !ok {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	if s.indexerTokens == nil {
		http.Error(w, "playlist writer unavailable", http.StatusServiceUnavailable)
		return
	}
	var input playlistImport
	reader := http.MaxBytesReader(w, r.Body, 64<<20)
	if err := json.NewDecoder(reader).Decode(&input); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	if s.importStatus.Running {
		s.mu.Unlock()
		http.Error(w, "playlist import running", http.StatusConflict)
		return
	}
	s.importStatus = playlistImportStatus{Running: true}
	s.mu.Unlock()
	go s.processPlaylistImport(input)
	w.WriteHeader(http.StatusAccepted)
}

func (s *server) playlistImportState(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authenticated(r); !ok {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	s.mu.RLock()
	status := s.importStatus
	s.mu.RUnlock()
	writeJSON(w, status)
}

func (s *server) processPlaylistImport(input playlistImport) {
	status := playlistImportStatus{}
	defer func() {
		s.mu.Lock()
		s.importStatus = status
		s.mu.Unlock()
	}()
	state, err := s.storePlaylistDefinitions(input)
	if err != nil {
		status.Error = err.Error()
		return
	}
	status.Playlists = len(state.Playlists)
}

func listRemoteFileIDs(ctx context.Context, token, root string) (map[string]struct{}, error) {
	files, err := listRemoteFiles(ctx, token, root)
	if err != nil {
		return nil, err
	}
	items := make(map[string]struct{}, len(files))
	for id := range files {
		items[id] = struct{}{}
	}
	return items, nil
}

func listRemoteFiles(ctx context.Context, token, root string) (map[string]remoteEntry, error) {
	requestBody := map[string]any{"path": root, "recursive": true, "include_deleted": false, "limit": 2000}
	endpoint := dropboxAPI + "/files/list_folder"
	items := make(map[string]remoteEntry, 1024)
	for {
		var page listFolderResponse
		if err := dropboxJSON(ctx, token, endpoint, requestBody, &page); err != nil {
			return nil, err
		}
		for _, entry := range page.Entries {
			if entry.Tag == "file" {
				items[entry.ID] = entry
			}
		}
		if !page.HasMore {
			return items, nil
		}
		requestBody = map[string]any{"cursor": page.Cursor}
		endpoint = dropboxAPI + "/files/list_folder/continue"
	}
}

func missingKey(item playlistItem) string {
	return normalizeName(item.Artist) + "\x00" + normalizeName(item.Album) + "\x00" + normalizeName(item.Track)
}

func normalizeName(value string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return unicode.ToLower(r)
		}
		return -1
	}, value)
}

func encodeMissingYAML(items map[string]playlistItem) []byte {
	keys := make([]string, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var output strings.Builder
	for _, key := range keys {
		item := items[key]
		fmt.Fprintf(&output, "- artist: %s\n  album: %s\n  track: %s\n", yamlString(item.Artist), yamlString(item.Album), yamlString(item.Track))
	}
	return []byte(output.String())
}

func yamlString(value string) string {
	return strconv.Quote(value)
}

func uploadDropboxFile(ctx context.Context, token, path string, content []byte) error {
	argument, _ := json.Marshal(map[string]any{"path": path, "mode": "overwrite", "autorename": false, "mute": true})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, dropboxContent+"/files/upload", strings.NewReader(string(content)))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Dropbox-API-Arg", string(argument))
	req.Header.Set("Content-Type", "application/octet-stream")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		failure, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
		return fmt.Errorf("Dropbox upload: %s: %s", response.Status, strings.TrimSpace(string(failure)))
	}
	return nil
}

func (s *server) stream(w http.ResponseWriter, r *http.Request) {
	current, ok := s.authenticated(r)
	if !ok {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	id, err := url.PathUnescape(strings.TrimPrefix(r.URL.Path, "/api/stream/"))
	if err != nil || id == "" {
		http.Error(w, "track required", http.StatusBadRequest)
		return
	}
	s.mu.RLock()
	item, found := s.catalog[id]
	s.mu.RUnlock()
	if !found || item.Deleted {
		http.NotFound(w, r)
		return
	}
	accessToken, err := current.tokens.token(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	var response struct {
		Link string `json:"link"`
	}
	if err := dropboxJSON(r.Context(), accessToken, dropboxAPI+"/files/get_temporary_link", map[string]string{"path": item.Path}, &response); err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	http.Redirect(w, r, response.Link, http.StatusFound)
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Print(err)
	}
}

func randomToken() (string, error) {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func exchangeDropboxCode(ctx context.Context, cfg config, code string) (tokenResponse, error) {
	return exchangeDropboxCodeAt(ctx, cfg, code, cfg.publicURL+"/auth/callback")
}

func exchangeDropboxCodeAt(ctx context.Context, cfg config, code, redirectURI string) (tokenResponse, error) {
	values := url.Values{
		"code":          {code},
		"grant_type":    {"authorization_code"},
		"client_id":     {cfg.appKey},
		"client_secret": {cfg.appSecret},
		"redirect_uri":  {redirectURI},
	}
	return tokenRequest(ctx, values)
}

func authorizeIndexer(ctx context.Context, cfg config) error {
	if err := validateConfig(cfg); err != nil {
		return err
	}
	state, err := randomToken()
	if err != nil {
		return err
	}
	address := env("INDEXER_AUTH_ADDR", "127.0.0.1:53682")
	redirectURI := env("INDEXER_REDIRECT_URI", "http://127.0.0.1:53682/callback")
	result := make(chan error, 1)
	mux := http.NewServeMux()
	server := &http.Server{Addr: address, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("state") != state {
			result <- fmt.Errorf("invalid OAuth state")
			http.Error(w, "invalid OAuth state", http.StatusBadRequest)
			return
		}
		token, err := exchangeDropboxCodeAt(r.Context(), cfg, r.URL.Query().Get("code"), redirectURI)
		if err != nil {
			result <- err
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		accountID, err := getCurrentAccount(r.Context(), token.AccessToken)
		if err != nil {
			result <- err
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		if accountID != cfg.allowedAccountID {
			err := fmt.Errorf("indexer Dropbox account %q is outside the allowed account", accountID)
			result <- err
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		if token.RefreshToken == "" {
			err := fmt.Errorf("Dropbox returned no refresh token")
			result <- err
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		fmt.Fprintln(w, "Indexer authorization complete. This tab can close.")
		fmt.Fprintln(os.Stdout, token.RefreshToken)
		result <- nil
	})
	query := url.Values{
		"client_id":         {cfg.appKey},
		"response_type":     {"code"},
		"token_access_type": {"offline"},
		"redirect_uri":      {redirectURI},
		"state":             {state},
		"scope":             {"account_info.read files.metadata.read files.content.read"},
	}
	log.Printf("open https://www.dropbox.com/oauth2/authorize?%s", query.Encode())
	errChannel := make(chan error, 1)
	go func() { errChannel <- server.ListenAndServe() }()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-errChannel:
		return err
	case err := <-result:
		shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if shutdownErr := server.Shutdown(shutdownContext); err == nil {
			err = shutdownErr
		}
		return err
	}
}

func (s *dropboxTokenSource) token(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.accessToken != "" && time.Until(s.expiresAt) > time.Minute {
		return s.accessToken, nil
	}
	values := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {s.refreshToken},
		"client_id":     {s.appKey},
		"client_secret": {s.appSecret},
	}
	response, err := tokenRequest(ctx, values)
	if err != nil {
		return "", err
	}
	s.accessToken = response.AccessToken
	s.expiresAt = time.Now().Add(time.Duration(response.ExpiresIn) * time.Second)
	if response.RefreshToken != "" {
		s.refreshToken = response.RefreshToken
	}
	return s.accessToken, nil
}

func tokenRequest(ctx context.Context, values url.Values) (tokenResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, dropboxToken, strings.NewReader(values.Encode()))
	if err != nil {
		return tokenResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return tokenResponse{}, err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
		return tokenResponse{}, fmt.Errorf("Dropbox token exchange: %s: %s", response.Status, strings.TrimSpace(string(body)))
	}
	var token tokenResponse
	return token, json.NewDecoder(response.Body).Decode(&token)
}

func getCurrentAccount(ctx context.Context, token string) (string, error) {
	var account struct {
		AccountID string `json:"account_id"`
	}
	if err := dropboxJSON(ctx, token, dropboxAPI+"/users/get_current_account", map[string]string{}, &account); err != nil {
		return "", err
	}
	return account.AccountID, nil
}

func dropboxJSON(ctx context.Context, token, endpoint string, input, output any) error {
	body, err := json.Marshal(input)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		failure, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
		return fmt.Errorf("Dropbox API: %s: %s", response.Status, strings.TrimSpace(string(failure)))
	}
	return json.NewDecoder(response.Body).Decode(output)
}
