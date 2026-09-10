package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
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
	URI      string `json:"uri"`
	Artist   string `json:"artist"`
	Album    string `json:"album"`
	Track    string `json:"track"`
	Position int    `json:"position"`
	TrackID  string `json:"trackId,omitempty"`
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
	tokens    *dropboxTokenSource
	accountID string
}

type server struct {
	cfg                config
	ctx                context.Context
	mu                 sync.RWMutex
	importMu           sync.Mutex
	sessions           map[string]*session
	states             map[string]time.Time
	catalog            map[string]track
	playlists          map[string]playlist
	playlistsFinalized bool
	indexerTokens      *dropboxTokenSource
	importStatus       playlistImportStatus
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
	s := &server{cfg: cfg, ctx: ctx, sessions: map[string]*session{}, states: map[string]time.Time{}, catalog: catalog, playlists: playlistMap(playlistState.Playlists), playlistsFinalized: playlistState.Finalized}
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
	sessionID, err := randomToken()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	tokens := &dropboxTokenSource{appKey: s.cfg.appKey, appSecret: s.cfg.appSecret, accessToken: response.AccessToken, refreshToken: response.RefreshToken, expiresAt: time.Now().Add(time.Duration(response.ExpiresIn) * time.Second)}
	s.mu.Lock()
	s.sessions[sessionID] = &session{tokens: tokens, accountID: accountID}
	s.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "radio_session", Value: sessionID, Path: "/", MaxAge: 86400, HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode})
	http.Redirect(w, r, "/", http.StatusFound)
}

func (s *server) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie("radio_session"); err == nil {
		s.mu.Lock()
		delete(s.sessions, cookie.Value)
		s.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: "radio_session", Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode})
	http.Redirect(w, r, "/", http.StatusFound)
}

func (s *server) authenticated(r *http.Request) (*session, bool) {
	cookie, err := r.Cookie("radio_session")
	if err != nil {
		return nil, false
	}
	s.mu.RLock()
	current := s.sessions[cookie.Value]
	s.mu.RUnlock()
	return current, current != nil
}

func (s *server) me(w http.ResponseWriter, r *http.Request) {
	current, ok := s.authenticated(r)
	if !ok {
		http.Error(w, "authentication required", http.StatusUnauthorized)
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
	membershipKeys := make(map[string]struct{}, len(item.Playlists))
	uniqueMemberships := make([]playlistMembership, 0, len(item.Playlists))
	for _, membership := range item.Playlists {
		membership.Source = strings.TrimSpace(membership.Source)
		membership.PlaylistURI = strings.TrimSpace(membership.PlaylistURI)
		membership.PlaylistName = strings.TrimSpace(membership.PlaylistName)
		if !playlistSourceAllowed(membership.Source) || membership.PlaylistURI == "" || membership.PlaylistName == "" {
			http.Error(w, "invalid playlist membership", http.StatusBadRequest)
			return
		}
		key := membership.Source + "\x00" + membership.PlaylistURI + "\x00" + strconv.Itoa(membership.Position) + "\x00" + normalizeName(membership.Artist) + "\x00" + normalizeName(membership.Album) + "\x00" + normalizeName(membership.Track)
		if _, exists := membershipKeys[key]; exists {
			continue
		}
		membershipKeys[key] = struct{}{}
		uniqueMemberships = append(uniqueMemberships, membership)
	}
	item.Playlists = uniqueMemberships
	item = applyPathIdentity(item)
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

func materializePlaylists(definitions map[string]playlist, catalog map[string]track) map[string]playlist {
	items := make(map[string]playlist, len(definitions))
	for key, definition := range definitions {
		copyOfDefinition := definition
		copyOfDefinition.Items = append([]playlistItem(nil), definition.Items...)
		for i := range copyOfDefinition.Items {
			copyOfDefinition.Items[i].TrackID = ""
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
			sort.SliceStable(current.Items, func(i, j int) bool { return current.Items[i].Position < current.Items[j].Position })
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
	state, err := loadPlaylists(s.cfg.playlistPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if !state.Finalized {
		writeJSON(w, []playlistFolder{})
		return
	}
	catalog, err := loadTracks(s.cfg.dataPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
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
			if strings.TrimSpace(candidate.Items[i].Track) == "" {
				return playlistStore{}, fmt.Errorf("playlist %q has an empty track", candidate.Name)
			}
		}
		items[playlistKey(candidate)] = candidate
	}
	return playlistStore{Finalized: false, Playlists: playlistSlice(items)}, nil
}

func (s *server) storePlaylistDefinitions(input playlistImport) (playlistStore, error) {
	state, err := loadPlaylists(s.cfg.playlistPath)
	if err != nil {
		return playlistStore{}, err
	}
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
		state, err := loadPlaylists(s.cfg.playlistPath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, state)
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

func remotePathMayContain(item playlistItem, entries map[string]remoteEntry) bool {
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

func materializedItem(current playlist, source playlistItem) playlistItem {
	for _, item := range current.Items {
		if item.Position == source.Position && missingKey(item) == missingKey(source) {
			return item
		}
	}
	return source
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
	state, err := loadPlaylists(s.cfg.playlistPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	catalog, err := loadTracks(s.cfg.dataPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
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
	materialized := materializePlaylists(definitions, catalog)
	missing := map[string]playlistItem{}
	for key, definition := range definitions {
		current := materialized[key]
		for _, sourceItem := range definition.Items {
			item := materializedItem(current, sourceItem)
			if item.TrackID != "" {
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
	s.playlists = definitions
	s.playlistsFinalized = true
	s.catalog = catalog
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
	s.importMu.Lock()
	defer s.importMu.Unlock()
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
