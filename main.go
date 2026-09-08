package main

import (
	"context"
	"crypto/rand"
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
	"os/exec"
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
	ID          string            `json:"id"`
	Rev         string            `json:"-"`
	Path        string            `json:"path"`
	Name        string            `json:"name"`
	Title       string            `json:"title"`
	Artist      string            `json:"artist"`
	Album       string            `json:"album"`
	AlbumArtist string            `json:"albumArtist"`
	Genre       string            `json:"genre"`
	Year        int               `json:"year"`
	TrackNumber int               `json:"trackNumber"`
	DiscNumber  int               `json:"discNumber"`
	Duration    float64           `json:"duration"`
	Size        int64             `json:"size"`
	Format      string            `json:"format"`
	Codec       string            `json:"codec"`
	SampleRate  int               `json:"sampleRate"`
	Channels    int               `json:"channels"`
	Bitrate     int64             `json:"bitrate"`
	Tags        map[string]string `json:"tags,omitempty"`
	IndexedAt   string            `json:"indexedAt"`
	Deleted     bool              `json:"deleted,omitempty"`
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

type playlistImport struct {
	Playlists []playlist `json:"playlists"`
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
	cfg           config
	ctx           context.Context
	mu            sync.RWMutex
	importMu      sync.Mutex
	sessions      map[string]*session
	states        map[string]time.Time
	catalog       map[string]track
	playlists     map[string]playlist
	remoteAudio   []remoteEntry
	indexerTokens *dropboxTokenSource
}

func main() {
	log.SetFlags(0)
	if len(os.Args) != 2 {
		log.Fatal("usage: radio serve|index|authorize-indexer")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var err error
	switch os.Args[1] {
	case "serve":
		err = runServer(ctx, loadConfig("TUNA"))
	case "index":
		err = runIndexer(ctx, loadConfig("INDEXER"))
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

func validateConfig(cfg config, indexer bool) error {
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
	if indexer && cfg.refreshToken == "" {
		missing = append(missing, "DROPBOX_REFRESH_TOKEN")
	}
	if len(missing) != 0 {
		return fmt.Errorf("missing configuration: %s", strings.Join(missing, ", "))
	}
	return nil
}

func runIndexer(ctx context.Context, cfg config) error {
	if err := validateConfig(cfg, true); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(cfg.dataPath), 0o700); err != nil {
		return err
	}
	catalog, err := loadTracks(cfg.dataPath)
	if err != nil {
		return err
	}

	tokens := &dropboxTokenSource{appKey: cfg.appKey, appSecret: cfg.appSecret, refreshToken: cfg.refreshToken}
	accessToken, err := tokens.token(ctx)
	if err != nil {
		return err
	}
	accountID, err := getCurrentAccount(ctx, accessToken)
	if err != nil {
		return err
	}
	if accountID != cfg.allowedAccountID {
		return fmt.Errorf("indexer Dropbox account is outside the allowed account")
	}

	requestBody := map[string]any{"path": cfg.dropboxRoot, "recursive": true, "include_deleted": false, "limit": 2000}
	listEndpoint := dropboxAPI + "/files/list_folder"
	indexed := 0
	for {
		var page listFolderResponse
		accessToken, err = tokens.token(ctx)
		if err != nil {
			return err
		}
		if err := dropboxJSON(ctx, accessToken, listEndpoint, requestBody, &page); err != nil {
			return err
		}
		for _, entry := range page.Entries {
			if entry.Tag != "file" || !audioExtension(entry.Name) {
				continue
			}
			if current, present := catalog[entry.ID]; present && current.Rev == entry.Rev {
				continue
			}
			accessToken, err = tokens.token(ctx)
			if err != nil {
				return err
			}
			item, err := indexOne(ctx, cfg.dataPath, accessToken, entry)
			if err != nil {
				return fmt.Errorf("index %s: %w", entry.PathDisplay, err)
			}
			catalog[item.ID] = item
			indexed++
			if indexed%100 == 0 {
				log.Printf("indexed and released %d files", indexed)
			}
		}
		if !page.HasMore {
			break
		}
		requestBody = map[string]any{"cursor": page.Cursor}
		listEndpoint = dropboxAPI + "/files/list_folder/continue"
	}
	log.Printf("index complete: %d files", indexed)
	return nil
}

func audioExtension(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".mp3", ".m4a", ".mp4", ".flac", ".ogg", ".opus", ".wav", ".aac", ".aif", ".aiff", ".wma":
		return true
	default:
		return false
	}
}

func indexOne(ctx context.Context, dataPath, accessToken string, entry remoteEntry) (item track, returnErr error) {
	file, err := openAnonymousFile(filepath.Dir(dataPath))
	if err != nil {
		return track{}, err
	}
	released := false
	defer func() {
		if !released {
			if err := file.Close(); returnErr == nil && err != nil {
				returnErr = err
			}
		}
	}()

	if err := downloadDropboxFile(ctx, accessToken, entry.ID, file); err != nil {
		return track{}, err
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return track{}, err
	}
	metadata, err := probeAudio(ctx, file)
	if err != nil {
		return track{}, err
	}
	metadata.ID = entry.ID
	metadata.Rev = entry.Rev
	metadata.Path = firstNonempty(entry.PathDisplay, entry.PathLower)
	metadata.Name = entry.Name
	metadata.Size = entry.Size
	metadata.IndexedAt = time.Now().UTC().Format(time.RFC3339)
	metadata = applyPathIdentity(metadata)
	if err := appendTrack(dataPath, metadata); err != nil {
		return track{}, err
	}
	if err := file.Close(); err != nil {
		return track{}, err
	}
	released = true
	return metadata, nil
}

func downloadDropboxFile(ctx context.Context, token, id string, destination io.Writer) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, dropboxContent+"/files/download", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	argument, _ := json.Marshal(map[string]string{"path": id})
	req.Header.Set("Dropbox-API-Arg", string(argument))
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
		return fmt.Errorf("Dropbox download: %s: %s", response.Status, strings.TrimSpace(string(body)))
	}
	_, err = io.Copy(destination, response.Body)
	return err
}

type probeResult struct {
	Format struct {
		Duration   string `json:"duration"`
		Bitrate    string `json:"bit_rate"`
		FormatName string `json:"format_name"`
	} `json:"format"`
	Streams []struct {
		CodecType  string `json:"codec_type"`
		CodecName  string `json:"codec_name"`
		SampleRate string `json:"sample_rate"`
		Channels   int    `json:"channels"`
		Bitrate    string `json:"bit_rate"`
	} `json:"streams"`
}

func probeAudio(ctx context.Context, file *os.File) (track, error) {
	command := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-show_entries", "format=duration,bit_rate,format_name:stream=codec_type,codec_name,sample_rate,channels,bit_rate", "-of", "json", "/proc/self/fd/3")
	command.ExtraFiles = []*os.File{file}
	output, err := command.Output()
	if err != nil {
		return track{}, err
	}
	var result probeResult
	if err := json.Unmarshal(output, &result); err != nil {
		return track{}, err
	}
	item := track{
		Duration: floating(result.Format.Duration),
		Format:   result.Format.FormatName,
		Bitrate:  integer64(result.Format.Bitrate),
	}
	for _, stream := range result.Streams {
		if stream.CodecType == "audio" {
			item.Codec = stream.CodecName
			item.SampleRate = int(integer64(stream.SampleRate))
			item.Channels = stream.Channels
			if item.Bitrate == 0 {
				item.Bitrate = integer64(stream.Bitrate)
			}
			break
		}
	}
	return item, nil
}

func applyPathIdentity(item track) track {
	path := strings.Trim(firstNonempty(item.Path, item.Name), "/")
	parts := strings.Split(path, "/")
	filename := item.Name
	if len(parts) != 0 {
		filename = parts[len(parts)-1]
	}
	stem := strings.TrimSpace(strings.TrimSuffix(filename, filepath.Ext(filename)))
	item.TrackNumber = leadingInteger(stem)
	item.Title = stripTrackPrefix(stem)
	if item.Title == "" {
		item.Title = stem
	}
	item.Artist = ""
	item.Album = ""
	if len(parts) >= 3 {
		item.Album = parts[len(parts)-2]
		item.Artist = parts[len(parts)-3]
	}
	item.AlbumArtist = item.Artist
	item.Genre = ""
	item.Year = 0
	item.DiscNumber = 0
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

func integer64(value string) int64 {
	result, _ := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	return result
}

func floating(value string) float64 {
	result, _ := strconv.ParseFloat(strings.TrimSpace(value), 64)
	return result
}

func runServer(ctx context.Context, cfg config) error {
	if err := validateConfig(cfg, false); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(cfg.dataPath), 0o700); err != nil {
		return err
	}
	catalog, err := loadTracks(cfg.dataPath)
	if err != nil {
		return err
	}
	playlists, err := loadPlaylists(cfg.playlistPath)
	if err != nil {
		return err
	}
	s := &server{cfg: cfg, ctx: ctx, sessions: map[string]*session{}, states: map[string]time.Time{}, catalog: catalog, playlists: playlists}
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

func (s *server) playlistList(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authenticated(r); !ok {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	items, err := loadPlaylists(s.cfg.playlistPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	result := make([]playlist, 0, len(items))
	for _, item := range items {
		result = append(result, item)
	}
	sort.Slice(result, func(i, j int) bool {
		return strings.ToLower(result[i].Source+"\x00"+result[i].Name+"\x00"+result[i].URI) < strings.ToLower(result[j].Source+"\x00"+result[j].Name+"\x00"+result[j].URI)
	})
	s.mu.Lock()
	s.playlists = items
	s.mu.Unlock()
	writeJSON(w, result)
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

	s.importMu.Lock()
	defer s.importMu.Unlock()
	items, err := loadPlaylists(s.cfg.playlistPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for _, candidate := range input.Playlists {
		candidate.Source = strings.TrimSpace(candidate.Source)
		candidate.URI = strings.TrimSpace(candidate.URI)
		candidate.Name = strings.TrimSpace(candidate.Name)
		for i := range candidate.Items {
			candidate.Items[i].Position = i
			candidate.Items[i].TrackID = ""
		}
		items[playlistKey(candidate)] = candidate
	}

	accessToken, err := s.indexerTokens.token(s.ctx)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	if len(s.remoteAudio) == 0 {
		s.remoteAudio, err = listRemoteAudio(s.ctx, accessToken, s.cfg.dropboxRoot)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
	}

	missing := map[string]playlistItem{}
	for key, current := range items {
		for i := range current.Items {
			if match := matchPathItem(current.Items[i], s.remoteAudio); match != "" {
				current.Items[i].TrackID = match
				continue
			}
			current.Items[i].TrackID = ""
			missing[missingKey(current.Items[i])] = current.Items[i]
		}
		items[key] = current
	}
	missingYAML := encodeMissingYAML(missing)
	if err := uploadDropboxFile(s.ctx, accessToken, s.cfg.missingPath, missingYAML); err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	if err := writePlaylists(s.cfg.playlistPath, items); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.mu.Lock()
	s.playlists = items
	s.mu.Unlock()
	writeJSON(w, map[string]int{"playlists": len(items), "missing": len(missing)})
}

func listRemoteAudio(ctx context.Context, token, root string) ([]remoteEntry, error) {
	requestBody := map[string]any{"path": root, "recursive": true, "include_deleted": false, "limit": 2000}
	endpoint := dropboxAPI + "/files/list_folder"
	items := make([]remoteEntry, 0, 1024)
	for {
		var page listFolderResponse
		if err := dropboxJSON(ctx, token, endpoint, requestBody, &page); err != nil {
			return nil, err
		}
		for _, entry := range page.Entries {
			if entry.Tag == "file" && audioExtension(entry.Name) {
				items = append(items, entry)
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

func matchPathItem(item playlistItem, entries []remoteEntry) string {
	trackName := normalizeName(item.Track)
	if trackName == "" {
		return ""
	}
	artistName := normalizeName(item.Artist)
	albumName := normalizeName(item.Album)
	bestID := ""
	bestScore := 0
	tied := false
	for _, entry := range entries {
		stem := strings.TrimSuffix(entry.Name, filepath.Ext(entry.Name))
		fileName := normalizeName(stripTrackPrefix(stem))
		fullPath := normalizeName(firstNonempty(entry.PathDisplay, entry.PathLower))
		score := 0
		if fileName == trackName {
			score = 100
		} else if len(trackName) >= 4 && (strings.Contains(fileName, trackName) || strings.Contains(trackName, fileName)) {
			score = 80
		} else {
			continue
		}
		if artistName != "" && strings.Contains(fullPath, artistName) {
			score += 20
		}
		if albumName != "" && strings.Contains(fullPath, albumName) {
			score += 10
		}
		if score > bestScore {
			bestScore = score
			bestID = entry.ID
			tied = false
		} else if score == bestScore && entry.ID != bestID {
			tied = true
		}
	}
	if tied {
		return ""
	}
	return bestID
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
	encoded, _ := json.Marshal(value)
	return string(encoded)
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
	if err := validateConfig(cfg, false); err != nil {
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
