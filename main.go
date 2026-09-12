package main

import (
	"bufio"
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

	bolt "go.etcd.io/bbolt"
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
	listenAddr         string
	dataPath           string
	publicURL          string
	dropboxRoot        string
	allowedAccountID   string
	appKey             string
	appSecret          string
	refreshToken       string
	playlistPath       string
	legacyPlaylistPath string
	missingPath        string
	indexerAppKey      string
	indexerAppSecret   string
	indexerRefresh     string
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
	Smarttag    string               `json:"smarttagDisposition"`
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
	Source    string         `json:"source"`
	URI       string         `json:"uri"`
	Name      string         `json:"name"`
	ItemCount int            `json:"itemCount,omitempty"`
	Items     []playlistItem `json:"items"`
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

var playlistMetaBucket = []byte("meta")
var playlistDefinitionsBucket = []byte("definitions")
var playlistItemsBucket = []byte("items")
var playlistPathIndexBucket = []byte("path-index")
var playlistPathIdentityIndexBucket = []byte("path-identity-index")
var playlistTupleIndexBucket = []byte("tuple-index")
var playlistTrackIndexBucket = []byte("track-index")
var playlistArtistRuleIndexBucket = []byte("artist-rule-index")
var playlistPathlessIndexBucket = []byte("pathless-index")
var playlistFinalizedKey = []byte("finalized")
var playlistMigrationKey = []byte("legacy-migration-complete")
var playlistIndexVersionKey = []byte("index-version")
var playlistSourceScanCompleteKey = []byte("source-scan-complete")

const playlistIndexVersion byte = 2

func openPlaylistDatabase(databasePath, legacyPath string) (*bolt.DB, error) {
	database, err := bolt.Open(databasePath, 0o600, nil)
	if err != nil {
		return nil, err
	}
	if err := database.Update(func(transaction *bolt.Tx) error {
		for _, name := range [][]byte{playlistMetaBucket, playlistDefinitionsBucket, playlistItemsBucket, playlistPathIndexBucket, playlistPathIdentityIndexBucket, playlistTupleIndexBucket, playlistTrackIndexBucket, playlistArtistRuleIndexBucket, playlistPathlessIndexBucket} {
			if _, err := transaction.CreateBucketIfNotExists(name); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		database.Close()
		return nil, err
	}
	if err := migrateLegacyPlaylistDatabase(database, legacyPath); err != nil {
		database.Close()
		return nil, err
	}
	if err := discardIncompletePlaylistScan(database); err != nil {
		database.Close()
		return nil, err
	}
	if err := ensurePlaylistIndexes(database); err != nil {
		database.Close()
		return nil, err
	}
	return database, nil
}

func migrateLegacyPlaylistDatabase(database *bolt.DB, legacyPath string) error {
	complete := false
	if err := database.View(func(transaction *bolt.Tx) error {
		complete = bytes.Equal(transaction.Bucket(playlistMetaBucket).Get(playlistMigrationKey), []byte{1})
		return nil
	}); err != nil {
		return err
	}
	if complete {
		if err := os.Remove(legacyPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	legacy, err := os.Open(legacyPath)
	if errors.Is(err, os.ErrNotExist) {
		return database.Update(func(transaction *bolt.Tx) error {
			return transaction.Bucket(playlistMetaBucket).Put(playlistMigrationKey, []byte{1})
		})
	}
	if err != nil {
		return err
	}
	defer legacy.Close()
	if err := database.Update(func(transaction *bolt.Tx) error {
		for _, name := range [][]byte{playlistDefinitionsBucket, playlistItemsBucket} {
			if err := transaction.DeleteBucket(name); err != nil && !errors.Is(err, bolt.ErrBucketNotFound) {
				return err
			}
			if _, err := transaction.CreateBucket(name); err != nil {
				return err
			}
		}
		return transaction.Bucket(playlistMetaBucket).Put(playlistFinalizedKey, []byte{0})
	}); err != nil {
		return err
	}
	decoder := json.NewDecoder(legacy)
	opening, err := decoder.Token()
	if err != nil || opening != json.Delim('{') {
		return fmt.Errorf("invalid legacy playlist catalog")
	}
	finalized := false
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return err
		}
		key, ok := keyToken.(string)
		if !ok {
			return fmt.Errorf("invalid legacy playlist field")
		}
		switch key {
		case "finalized":
			if err := decoder.Decode(&finalized); err != nil {
				return err
			}
		case "playlists":
			opening, err := decoder.Token()
			if err != nil || opening != json.Delim('[') {
				return fmt.Errorf("invalid legacy playlist array")
			}
			for decoder.More() {
				if err := migrateLegacyPlaylistDefinition(decoder, database); err != nil {
					return err
				}
			}
			if closing, err := decoder.Token(); err != nil || closing != json.Delim(']') {
				return fmt.Errorf("invalid legacy playlist array ending")
			}
		default:
			var discarded any
			if err := decoder.Decode(&discarded); err != nil {
				return err
			}
		}
	}
	if closing, err := decoder.Token(); err != nil || closing != json.Delim('}') {
		return fmt.Errorf("invalid legacy playlist catalog ending")
	}
	if err := database.Update(func(transaction *bolt.Tx) error {
		meta := transaction.Bucket(playlistMetaBucket)
		value := byte(0)
		if finalized {
			value = 1
		}
		if err := meta.Put(playlistFinalizedKey, []byte{value}); err != nil {
			return err
		}
		return meta.Put(playlistMigrationKey, []byte{1})
	}); err != nil {
		return err
	}
	return os.Remove(legacyPath)
}

func migrateLegacyPlaylistDefinition(decoder *json.Decoder, database *bolt.DB) error {
	opening, err := decoder.Token()
	if err != nil || opening != json.Delim('{') {
		return fmt.Errorf("invalid legacy playlist definition")
	}
	definition := playlist{}
	initialized := false
	position := 0
	batch := make([]playlistItem, 0, 1024)
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return err
		}
		key, ok := keyToken.(string)
		if !ok {
			return fmt.Errorf("invalid legacy playlist definition field")
		}
		switch key {
		case "source":
			if err := decoder.Decode(&definition.Source); err != nil {
				return err
			}
		case "uri":
			if err := decoder.Decode(&definition.URI); err != nil {
				return err
			}
		case "name":
			if err := decoder.Decode(&definition.Name); err != nil {
				return err
			}
		case "items":
			if definition.Source == "" || definition.URI == "" || definition.Name == "" {
				return fmt.Errorf("legacy playlist items precede identity")
			}
			playlistKey, err := beginPlaylistDefinition(database, definition)
			if err != nil {
				return err
			}
			initialized = true
			opening, err := decoder.Token()
			if err != nil || opening != json.Delim('[') {
				return fmt.Errorf("invalid legacy playlist items")
			}
			for decoder.More() {
				var item playlistItem
				if err := decoder.Decode(&item); err != nil {
					return err
				}
				batch = append(batch, item)
				if len(batch) == cap(batch) {
					if err := appendPlaylistItemBatch(database, playlistKey, batch, position); err != nil {
						return err
					}
					position += len(batch)
					batch = batch[:0]
				}
			}
			if closing, err := decoder.Token(); err != nil || closing != json.Delim(']') {
				return fmt.Errorf("invalid legacy playlist items ending")
			}
			if len(batch) > 0 {
				if err := appendPlaylistItemBatch(database, playlistKey, batch, position); err != nil {
					return err
				}
				position += len(batch)
				batch = batch[:0]
			}
		case "itemCount":
			if err := decoder.Decode(&definition.ItemCount); err != nil {
				return err
			}
		default:
			var discarded any
			if err := decoder.Decode(&discarded); err != nil {
				return err
			}
		}
	}
	if closing, err := decoder.Token(); err != nil || closing != json.Delim('}') {
		return fmt.Errorf("invalid legacy playlist definition ending")
	}
	if !initialized {
		_, err := beginPlaylistDefinition(database, definition)
		return err
	}
	return nil
}

func playlistPositionKey(position int) []byte {
	key := make([]byte, 8)
	binary.BigEndian.PutUint64(key, uint64(position))
	return key
}

func playlistRowReference(definitionKey []byte, position int) []byte {
	reference := make([]byte, 4+len(definitionKey)+8)
	binary.BigEndian.PutUint32(reference[:4], uint32(len(definitionKey)))
	copy(reference[4:], definitionKey)
	binary.BigEndian.PutUint64(reference[4+len(definitionKey):], uint64(position))
	return reference
}

func decodePlaylistRowReference(reference []byte) ([]byte, int, error) {
	if len(reference) < 12 {
		return nil, 0, fmt.Errorf("invalid playlist row reference")
	}
	definitionSize := int(binary.BigEndian.Uint32(reference[:4]))
	if definitionSize < 1 || len(reference) != 4+definitionSize+8 {
		return nil, 0, fmt.Errorf("invalid playlist row reference")
	}
	definitionKey := reference[4 : 4+definitionSize]
	position := int(binary.BigEndian.Uint64(reference[4+definitionSize:]))
	return definitionKey, position, nil
}

func playlistIndexedRowKey(value string, reference []byte) []byte {
	key := make([]byte, len(value)+1+len(reference))
	copy(key, value)
	copy(key[len(value)+1:], reference)
	return key
}

func playlistTupleIndexValue(item playlistItem) string {
	artist := normalizeName(item.Artist)
	album := normalizeName(item.Album)
	track := normalizeName(item.Track)
	if artist == "" || album == "" || track == "" {
		return ""
	}
	return artist + "\x00" + album + "\x00" + track
}

func playlistPathIdentity(value string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if parsed, err := url.Parse(value); err == nil && parsed.Scheme != "" && parsed.Path != "" {
		if decoded, decodeErr := url.PathUnescape(parsed.Path); decodeErr == nil {
			value = decoded
		}
	}
	value = strings.SplitN(strings.SplitN(value, "?", 2)[0], "#", 2)[0]
	parts := strings.Split(strings.Trim(value, "/"), "/")
	if len(parts) < 3 {
		return ""
	}
	artist := normalizeName(parts[len(parts)-3])
	album := normalizeName(parts[len(parts)-2])
	filename := parts[len(parts)-1]
	track := normalizeName(stripTrackPrefix(strings.TrimSuffix(filename, path.Ext(filename))))
	if artist == "" || album == "" || track == "" {
		return ""
	}
	return artist + "\x00" + album + "\x00" + track
}

func playlistTrackIndexValues(item playlistItem) []string {
	values := make([]string, 0, 2)
	seen := map[string]struct{}{}
	for _, value := range []string{normalizeName(item.Track), normalizeName(stripTrackPrefix(item.Track))} {
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		values = append(values, value)
	}
	return values
}

func writePlaylistItemIndexes(transaction *bolt.Tx, definitionKey []byte, item playlistItem, remove bool) error {
	reference := playlistRowReference(definitionKey, item.Position)
	operation := func(bucket *bolt.Bucket, key []byte) error {
		if remove {
			return bucket.Delete(key)
		}
		return bucket.Put(key, []byte{1})
	}
	if playlistPath := normalizePlaylistPath(item.Path); playlistPath != "" {
		if err := operation(transaction.Bucket(playlistPathIndexBucket), playlistIndexedRowKey(playlistPath, reference)); err != nil {
			return err
		}
		if identity := playlistPathIdentity(item.Path); identity != "" {
			if err := operation(transaction.Bucket(playlistPathIdentityIndexBucket), playlistIndexedRowKey(identity, reference)); err != nil {
				return err
			}
		}
	} else if err := operation(transaction.Bucket(playlistPathlessIndexBucket), reference); err != nil {
		return err
	}
	if tuple := playlistTupleIndexValue(item); tuple != "" {
		if err := operation(transaction.Bucket(playlistTupleIndexBucket), playlistIndexedRowKey(tuple, reference)); err != nil {
			return err
		}
	}
	if !item.AllTracksByArtist {
		for _, track := range playlistTrackIndexValues(item) {
			if err := operation(transaction.Bucket(playlistTrackIndexBucket), playlistIndexedRowKey(track, reference)); err != nil {
				return err
			}
		}
	}
	if item.AllTracksByArtist {
		artist := normalizeName(item.Artist)
		if artist != "" {
			if err := operation(transaction.Bucket(playlistArtistRuleIndexBucket), playlistIndexedRowKey(artist, reference)); err != nil {
				return err
			}
		}
	}
	return nil
}

func replacePlaylistDefinition(database *bolt.DB, definition playlist) error {
	key, err := beginPlaylistDefinition(database, definition)
	if err != nil {
		return err
	}
	const itemBatchSize = 1024
	for start := 0; start < len(definition.Items); start += itemBatchSize {
		end := start + itemBatchSize
		if end > len(definition.Items) {
			end = len(definition.Items)
		}
		if err := appendPlaylistItemBatch(database, key, definition.Items[start:end], start); err != nil {
			return err
		}
	}
	return nil
}

func beginPlaylistDefinition(database *bolt.DB, definition playlist) ([]byte, error) {
	key := []byte(playlistKey(definition))
	metadata := definition
	metadata.Items = nil
	value, err := json.Marshal(metadata)
	if err != nil {
		return nil, err
	}
	if err := database.Update(func(transaction *bolt.Tx) error {
		if err := transaction.Bucket(playlistDefinitionsBucket).Put(key, value); err != nil {
			return err
		}
		items := transaction.Bucket(playlistItemsBucket)
		if oldItems := items.Bucket(key); oldItems != nil {
			if err := oldItems.ForEach(func(_, oldValue []byte) error {
				var oldItem playlistItem
				if err := json.Unmarshal(oldValue, &oldItem); err != nil {
					return err
				}
				return writePlaylistItemIndexes(transaction, key, oldItem, true)
			}); err != nil {
				return err
			}
		}
		if err := items.DeleteBucket(key); err != nil && !errors.Is(err, bolt.ErrBucketNotFound) {
			return err
		}
		_, err := items.CreateBucket(key)
		return err
	}); err != nil {
		return nil, err
	}
	return key, nil
}

func appendPlaylistItemBatch(database *bolt.DB, key []byte, batch []playlistItem, start int) error {
	return database.Update(func(transaction *bolt.Tx) error {
		itemBucket := transaction.Bucket(playlistItemsBucket).Bucket(key)
		for index := range batch {
			position := start + index
			batch[index].Position = position
			batch[index].TrackID = ""
			value, err := json.Marshal(batch[index])
			if err != nil {
				return err
			}
			if err := itemBucket.Put(playlistPositionKey(position), value); err != nil {
				return err
			}
			if err := writePlaylistItemIndexes(transaction, key, batch[index], false); err != nil {
				return err
			}
		}
		return nil
	})
}

func loadPlaylistMetadata(database *bolt.DB) (playlistStore, error) {
	state := playlistStore{}
	err := database.View(func(transaction *bolt.Tx) error {
		state.Finalized = bytes.Equal(transaction.Bucket(playlistMetaBucket).Get(playlistFinalizedKey), []byte{1})
		definitions := transaction.Bucket(playlistDefinitionsBucket)
		items := transaction.Bucket(playlistItemsBucket)
		return definitions.ForEach(func(key, value []byte) error {
			var definition playlist
			if err := json.Unmarshal(value, &definition); err != nil {
				return err
			}
			if itemBucket := items.Bucket(key); itemBucket != nil {
				definition.ItemCount = itemBucket.Stats().KeyN
			}
			state.Playlists = append(state.Playlists, definition)
			return nil
		})
	})
	sort.Slice(state.Playlists, func(i, j int) bool {
		return strings.ToLower(state.Playlists[i].Source+"\x00"+state.Playlists[i].Name+"\x00"+state.Playlists[i].URI) < strings.ToLower(state.Playlists[j].Source+"\x00"+state.Playlists[j].Name+"\x00"+state.Playlists[j].URI)
	})
	return state, err
}

func playlistDatabaseFinalized(database *bolt.DB) (bool, error) {
	finalized := false
	err := database.View(func(transaction *bolt.Tx) error {
		finalized = bytes.Equal(transaction.Bucket(playlistMetaBucket).Get(playlistFinalizedKey), []byte{1})
		return nil
	})
	return finalized, err
}

func playlistSourceScanCompleted(database *bolt.DB) (bool, error) {
	complete := false
	err := database.View(func(transaction *bolt.Tx) error {
		complete = bytes.Equal(transaction.Bucket(playlistMetaBucket).Get(playlistSourceScanCompleteKey), []byte{1})
		return nil
	})
	return complete, err
}

func markPlaylistSourceScanIncomplete(database *bolt.DB) error {
	return database.Update(func(transaction *bolt.Tx) error {
		metadata := transaction.Bucket(playlistMetaBucket)
		if err := metadata.Put(playlistSourceScanCompleteKey, []byte{0}); err != nil {
			return err
		}
		return metadata.Put(playlistFinalizedKey, []byte{0})
	})
}

func completePlaylistSourceScan(database *bolt.DB) error {
	return database.Update(func(transaction *bolt.Tx) error {
		present := make(map[string]struct{}, len(playlistSourceFolders))
		if err := transaction.Bucket(playlistDefinitionsBucket).ForEach(func(_, value []byte) error {
			var definition playlist
			if err := json.Unmarshal(value, &definition); err != nil {
				return err
			}
			present[definition.Source] = struct{}{}
			return nil
		}); err != nil {
			return err
		}
		for _, source := range playlistSourceFolders {
			if _, exists := present[source]; !exists {
				return fmt.Errorf("playlist source %q is empty", source)
			}
		}
		return transaction.Bucket(playlistMetaBucket).Put(playlistSourceScanCompleteKey, []byte{1})
	})
}

func playlistIndexBuckets() [][]byte {
	return [][]byte{playlistPathIndexBucket, playlistPathIdentityIndexBucket, playlistTupleIndexBucket, playlistTrackIndexBucket, playlistArtistRuleIndexBucket, playlistPathlessIndexBucket}
}

func resetPlaylistIndexes(transaction *bolt.Tx) error {
	for _, name := range playlistIndexBuckets() {
		if err := transaction.DeleteBucket(name); err != nil && !errors.Is(err, bolt.ErrBucketNotFound) {
			return err
		}
		if _, err := transaction.CreateBucket(name); err != nil {
			return err
		}
	}
	return transaction.Bucket(playlistMetaBucket).Delete(playlistIndexVersionKey)
}

func deletePlaylistSources(database *bolt.DB, selected map[string]struct{}) error {
	keys := [][]byte{}
	if err := database.View(func(transaction *bolt.Tx) error {
		return transaction.Bucket(playlistDefinitionsBucket).ForEach(func(key, value []byte) error {
			var definition playlist
			if err := json.Unmarshal(value, &definition); err != nil {
				return err
			}
			if _, remove := selected[definition.Source]; remove {
				keys = append(keys, bytes.Clone(key))
			}
			return nil
		})
	}); err != nil {
		return err
	}
	for _, key := range keys {
		if err := database.Update(func(transaction *bolt.Tx) error {
			items := transaction.Bucket(playlistItemsBucket)
			if err := items.DeleteBucket(key); err != nil && !errors.Is(err, bolt.ErrBucketNotFound) {
				return err
			}
			return transaction.Bucket(playlistDefinitionsBucket).Delete(key)
		}); err != nil {
			return err
		}
	}
	return nil
}

func discardIncompletePlaylistScan(database *bolt.DB) error {
	complete, err := playlistSourceScanCompleted(database)
	if err != nil || complete {
		return err
	}
	selected := map[string]struct{}{"Dropbox audio/music*": {}, "Foobar2000 legacy": {}}
	if err := deletePlaylistSources(database, selected); err != nil {
		return err
	}
	return database.Update(func(transaction *bolt.Tx) error {
		if err := resetPlaylistIndexes(transaction); err != nil {
			return err
		}
		return transaction.Bucket(playlistMetaBucket).Put(playlistFinalizedKey, []byte{0})
	})
}

func ensurePlaylistIndexes(database *bolt.DB) error {
	current := false
	if err := database.View(func(transaction *bolt.Tx) error {
		current = bytes.Equal(transaction.Bucket(playlistMetaBucket).Get(playlistIndexVersionKey), []byte{playlistIndexVersion})
		return nil
	}); err != nil {
		return err
	}
	if current {
		return nil
	}
	if err := database.Update(func(transaction *bolt.Tx) error {
		return resetPlaylistIndexes(transaction)
	}); err != nil {
		return err
	}
	definitionKeys := [][]byte{}
	if err := database.View(func(transaction *bolt.Tx) error {
		return transaction.Bucket(playlistDefinitionsBucket).ForEach(func(key, _ []byte) error {
			definitionKeys = append(definitionKeys, bytes.Clone(key))
			return nil
		})
	}); err != nil {
		return err
	}
	const indexBatchSize = 1024
	for _, definitionKey := range definitionKeys {
		itemCount := 0
		if err := database.View(func(transaction *bolt.Tx) error {
			itemBucket := transaction.Bucket(playlistItemsBucket).Bucket(definitionKey)
			if itemBucket != nil {
				itemCount = itemBucket.Stats().KeyN
			}
			return nil
		}); err != nil {
			return err
		}
		for start := 0; start < itemCount; start += indexBatchSize {
			end := start + indexBatchSize
			if end > itemCount {
				end = itemCount
			}
			batch := make([]playlistItem, 0, end-start)
			if err := database.View(func(transaction *bolt.Tx) error {
				itemBucket := transaction.Bucket(playlistItemsBucket).Bucket(definitionKey)
				for position := start; position < end; position++ {
					value := itemBucket.Get(playlistPositionKey(position))
					if value == nil {
						return fmt.Errorf("missing playlist row %d", position)
					}
					var item playlistItem
					if err := json.Unmarshal(value, &item); err != nil {
						return err
					}
					batch = append(batch, item)
				}
				return nil
			}); err != nil {
				return err
			}
			if err := database.Update(func(transaction *bolt.Tx) error {
				for _, item := range batch {
					if err := writePlaylistItemIndexes(transaction, definitionKey, item, false); err != nil {
						return err
					}
				}
				return nil
			}); err != nil {
				return err
			}
		}
	}
	return database.Update(func(transaction *bolt.Tx) error {
		return transaction.Bucket(playlistMetaBucket).Put(playlistIndexVersionKey, []byte{playlistIndexVersion})
	})
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
	Complete   bool   `json:"complete"`
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
	cfg              config
	ctx              context.Context
	mu               sync.RWMutex
	importMu         sync.Mutex
	states           map[string]time.Time
	sessionAEAD      cipher.AEAD
	tokenCache       map[[sha256.Size]byte]*dropboxTokenSource
	catalog          map[string]track
	playlists        *bolt.DB
	indexerTokens    *dropboxTokenSource
	importStatus     playlistImportStatus
	sourceScanStatus playlistSourceScanStatus
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
		listenAddr:         env("LISTEN_ADDR", ":8080"),
		dataPath:           dataPath,
		publicURL:          strings.TrimRight(env("PUBLIC_URL", "https://radio.vandrowka.com"), "/"),
		dropboxRoot:        env("DROPBOX_ROOT", "/audio"),
		allowedAccountID:   os.Getenv("DROPBOX_ALLOWED_ACCOUNT_ID"),
		appKey:             os.Getenv(prefix + "_DROPBOX_APP_KEY"),
		appSecret:          os.Getenv(prefix + "_DROPBOX_APP_SECRET"),
		refreshToken:       os.Getenv(prefix + "_DROPBOX_REFRESH_TOKEN"),
		playlistPath:       env("PLAYLIST_PATH", filepath.Join(filepath.Dir(dataPath), "playlists.bolt")),
		legacyPlaylistPath: env("LEGACY_PLAYLIST_PATH", filepath.Join(filepath.Dir(dataPath), "playlists.db")),
		missingPath:        env("MISSING_DROPBOX_PATH", "/audio/missing.yml"),
		indexerAppKey:      os.Getenv("INDEXER_DROPBOX_APP_KEY"),
		indexerAppSecret:   os.Getenv("INDEXER_DROPBOX_APP_SECRET"),
		indexerRefresh:     os.Getenv("INDEXER_DROPBOX_REFRESH_TOKEN"),
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
	if err := replaceTrackIndex(cfg.dataPath, catalog); err != nil {
		return err
	}
	playlists, err := openPlaylistDatabase(cfg.playlistPath, cfg.legacyPlaylistPath)
	if err != nil {
		return err
	}
	defer playlists.Close()
	sessionKey := sha256.Sum256([]byte("radio-session-v1\x00" + cfg.appSecret))
	sessionBlock, err := aes.NewCipher(sessionKey[:])
	if err != nil {
		return err
	}
	sessionAEAD, err := cipher.NewGCM(sessionBlock)
	if err != nil {
		return err
	}
	s := &server{cfg: cfg, ctx: ctx, states: map[string]time.Time{}, sessionAEAD: sessionAEAD, tokenCache: map[[sha256.Size]byte]*dropboxTokenSource{}, catalog: catalog, playlists: playlists}
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
	mux.HandleFunc("/api/playlists/items", s.playlistItems)
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
	sourcesComplete, err := playlistSourceScanCompleted(s.playlists)
	if err != nil {
		http.Error(w, "playlist catalog read failed", http.StatusInternalServerError)
		return
	}
	if !sourcesComplete {
		http.Error(w, "playlist source scan incomplete", http.StatusConflict)
		return
	}
	var item track
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&item); err != nil {
		http.Error(w, "invalid index record", http.StatusBadRequest)
		return
	}
	if item.ID == "" || item.Rev == "" || item.Path == "" || item.Name == "" || strings.TrimSpace(item.Artist) == "" || strings.TrimSpace(item.Smarttag) == "" {
		http.Error(w, "incomplete index record", http.StatusBadRequest)
		return
	}
	if strings.EqualFold(strings.TrimSpace(item.Artist), "unknown") || (item.Artist != "?" && item.Artist != "N/A" && !strings.ContainsFunc(item.Artist, unicode.IsLetter)) {
		http.Error(w, "invalid artist", http.StatusBadRequest)
		return
	}
	item = applyPathIdentity(item)
	exactMemberships, err := s.exactPlaylistMemberships(item)
	if err != nil {
		http.Error(w, "playlist catalog read failed", http.StatusInternalServerError)
		return
	}
	item.Playlists = append(item.Playlists, exactMemberships...)
	membershipKeys := make(map[string]struct{}, len(item.Playlists))
	uniqueMemberships := make([]playlistMembership, 0, len(item.Playlists))
	for _, membership := range item.Playlists {
		membership.Source = strings.TrimSpace(membership.Source)
		membership.PlaylistURI = strings.TrimSpace(membership.PlaylistURI)
		membership.PlaylistName = strings.TrimSpace(membership.PlaylistName)
		defined, err := s.playlistMembershipDefined(membership, item)
		if err != nil {
			http.Error(w, "playlist catalog read failed", http.StatusInternalServerError)
			return
		}
		if !playlistSourceAllowed(membership.Source) || membership.PlaylistURI == "" || membership.PlaylistName == "" || !defined {
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
	memberships, _ := json.Marshal(item.Playlists)
	log.Printf("FILE_INDEXED path=%q smarttag=%q rev=%q memberships=%s", item.Path, item.Smarttag, item.Rev, memberships)
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
	if sourceIdentity, indexedIdentity := playlistPathIdentity(source.Path), playlistPathIdentity(indexed.Path); sourceIdentity != "" && sourceIdentity == indexedIdentity {
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

func (s *server) visitPlaylistItems(visitor func(playlist, playlistItem) error) error {
	return s.playlists.View(func(transaction *bolt.Tx) error {
		definitions := transaction.Bucket(playlistDefinitionsBucket)
		items := transaction.Bucket(playlistItemsBucket)
		return definitions.ForEach(func(key, value []byte) error {
			var definition playlist
			if err := json.Unmarshal(value, &definition); err != nil {
				return err
			}
			itemBucket := items.Bucket(key)
			if itemBucket == nil {
				return nil
			}
			return itemBucket.ForEach(func(_, itemValue []byte) error {
				var item playlistItem
				if err := json.Unmarshal(itemValue, &item); err != nil {
					return err
				}
				return visitor(definition, item)
			})
		})
	})
}

func visitPlaylistRowReference(transaction *bolt.Tx, reference []byte, seen map[string]struct{}, visitor func(playlist, playlistItem) error) error {
	referenceKey := string(reference)
	if _, exists := seen[referenceKey]; exists {
		return nil
	}
	definitionKey, position, err := decodePlaylistRowReference(reference)
	if err != nil {
		return err
	}
	definitionValue := transaction.Bucket(playlistDefinitionsBucket).Get(definitionKey)
	if definitionValue == nil {
		return fmt.Errorf("playlist definition missing for indexed row")
	}
	itemBucket := transaction.Bucket(playlistItemsBucket).Bucket(definitionKey)
	if itemBucket == nil {
		return fmt.Errorf("playlist item bucket missing for indexed row")
	}
	itemValue := itemBucket.Get(playlistPositionKey(position))
	if itemValue == nil {
		return fmt.Errorf("playlist row %d missing for indexed row", position)
	}
	var definition playlist
	if err := json.Unmarshal(definitionValue, &definition); err != nil {
		return err
	}
	var item playlistItem
	if err := json.Unmarshal(itemValue, &item); err != nil {
		return err
	}
	seen[referenceKey] = struct{}{}
	return visitor(definition, item)
}

func visitPlaylistIndexValue(transaction *bolt.Tx, bucketName []byte, value string, seen map[string]struct{}, visitor func(playlist, playlistItem) error) error {
	if value == "" {
		return nil
	}
	prefix := append(append([]byte(nil), []byte(value)...), 0)
	cursor := transaction.Bucket(bucketName).Cursor()
	for key, _ := cursor.Seek(prefix); key != nil && bytes.HasPrefix(key, prefix); key, _ = cursor.Next() {
		if err := visitPlaylistRowReference(transaction, key[len(prefix):], seen, visitor); err != nil {
			return err
		}
	}
	return nil
}

func playlistTrackLookupValues(indexed track) []string {
	values := make([]string, 0, 4)
	seen := map[string]struct{}{}
	filename := path.Base(strings.ReplaceAll(indexed.Path, "\\", "/"))
	stem := strings.TrimSuffix(filename, path.Ext(filename))
	for _, value := range []string{normalizeName(indexed.Title), normalizeName(stripTrackPrefix(indexed.Title)), normalizeName(stem), normalizeName(stripTrackPrefix(stem))} {
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		values = append(values, value)
	}
	return values
}

func (s *server) visitIndexedPlaylistRows(indexed track, includePathless bool, visitor func(playlist, playlistItem) error) error {
	return s.playlists.View(func(transaction *bolt.Tx) error {
		seen := map[string]struct{}{}
		lookups := []struct {
			bucket []byte
			value  string
		}{
			{playlistPathIndexBucket, normalizePlaylistPath(indexed.Path)},
			{playlistPathIdentityIndexBucket, playlistPathIdentity(indexed.Path)},
			{playlistTupleIndexBucket, playlistTupleIndexValue(playlistItem{Artist: indexed.Artist, Album: indexed.Album, Track: indexed.Title})},
			{playlistArtistRuleIndexBucket, normalizeName(indexed.Artist)},
		}
		for _, lookup := range lookups {
			if err := visitPlaylistIndexValue(transaction, lookup.bucket, lookup.value, seen, visitor); err != nil {
				return err
			}
		}
		for _, trackName := range playlistTrackLookupValues(indexed) {
			if err := visitPlaylistIndexValue(transaction, playlistTrackIndexBucket, trackName, seen, visitor); err != nil {
				return err
			}
		}
		if includePathless {
			if err := transaction.Bucket(playlistPathlessIndexBucket).ForEach(func(reference, _ []byte) error {
				return visitPlaylistRowReference(transaction, reference, seen, visitor)
			}); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *server) exactPlaylistMemberships(indexed track) ([]playlistMembership, error) {
	memberships := []playlistMembership{}
	err := s.visitIndexedPlaylistRows(indexed, false, func(definition playlist, source playlistItem) error {
		if playlistItemExactMatch(source, indexed) {
			memberships = append(memberships, playlistMembershipFromItem(definition, source, indexed))
		}
		return nil
	})
	sort.Slice(memberships, func(i, j int) bool {
		return playlistMembershipKey(memberships[i]) < playlistMembershipKey(memberships[j])
	})
	return memberships, err
}

func (s *server) playlistMembershipDefined(membership playlistMembership, indexed track) (bool, error) {
	defined := false
	err := s.playlists.View(func(transaction *bolt.Tx) error {
		key := []byte(playlistKey(playlist{Source: membership.Source, URI: membership.PlaylistURI}))
		definitionValue := transaction.Bucket(playlistDefinitionsBucket).Get(key)
		if definitionValue == nil {
			return nil
		}
		var definition playlist
		if err := json.Unmarshal(definitionValue, &definition); err != nil {
			return err
		}
		if definition.Name != membership.PlaylistName {
			return nil
		}
		itemBucket := transaction.Bucket(playlistItemsBucket).Bucket(key)
		if itemBucket == nil {
			return nil
		}
		if membership.Position >= 0 {
			itemValue := itemBucket.Get(playlistPositionKey(membership.Position))
			if itemValue == nil {
				return nil
			}
			var source playlistItem
			if err := json.Unmarshal(itemValue, &source); err != nil {
				return err
			}
			defined = !source.AllTracksByArtist && source.Position == membership.Position && source.URI == membership.ItemURI &&
				normalizeName(source.Artist) == normalizeName(membership.Artist) &&
				normalizeName(source.Album) == normalizeName(membership.Album) &&
				normalizeName(source.Track) == normalizeName(membership.Track)
			return nil
		}
		if membership.Position == -1 && normalizeName(membership.Artist) == normalizeName(indexed.Artist) &&
			normalizeName(membership.Album) == normalizeName(indexed.Album) && normalizeName(membership.Track) == normalizeName(indexed.Title) {
			return itemBucket.ForEach(func(_, itemValue []byte) error {
				var source playlistItem
				if err := json.Unmarshal(itemValue, &source); err != nil {
					return err
				}
				if source.AllTracksByArtist && source.URI == membership.ItemURI && normalizeName(source.Artist) == normalizeName(indexed.Artist) {
					defined = true
				}
				return nil
			})
		}
		return nil
	})
	return defined, err
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
	sourcesComplete, err := playlistSourceScanCompleted(s.playlists)
	if err != nil {
		http.Error(w, "playlist catalog read failed", http.StatusInternalServerError)
		return
	}
	if !sourcesComplete {
		http.Error(w, "playlist source scan incomplete", http.StatusConflict)
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
	err = s.visitIndexedPlaylistRows(indexed, true, func(definition playlist, source playlistItem) error {
		if playlistItemMayMatch(source, indexed) {
			candidates = append(candidates, playlistCandidate{Source: definition.Source, PlaylistURI: definition.URI, PlaylistName: definition.Name, Item: source})
		}
		return nil
	})
	if err != nil {
		http.Error(w, "playlist catalog read failed", http.StatusInternalServerError)
		return
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

func (s *server) snapshotCatalog() map[string]track {
	s.mu.RLock()
	catalog := make(map[string]track, len(s.catalog))
	for id, item := range s.catalog {
		catalog[id] = item
	}
	s.mu.RUnlock()
	return catalog
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
	state, err := loadPlaylistMetadata(s.playlists)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if !state.Finalized {
		writeJSON(w, []playlistFolder{})
		return
	}
	writeJSON(w, playlistFolders(playlistMap(state.Playlists)))
}

func (s *server) playlistItems(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authenticated(r); !ok {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "GET required", http.StatusMethodNotAllowed)
		return
	}
	finalized, err := playlistDatabaseFinalized(s.playlists)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if !finalized {
		http.NotFound(w, r)
		return
	}
	source := r.URL.Query().Get("source")
	uri := r.URL.Query().Get("uri")
	key := []byte(playlistKey(playlist{Source: source, URI: uri}))
	result := playlist{}
	positions := map[int]int{}
	err = s.playlists.View(func(transaction *bolt.Tx) error {
		definitionValue := transaction.Bucket(playlistDefinitionsBucket).Get(key)
		if definitionValue == nil {
			return os.ErrNotExist
		}
		if err := json.Unmarshal(definitionValue, &result); err != nil {
			return err
		}
		itemBucket := transaction.Bucket(playlistItemsBucket).Bucket(key)
		if itemBucket == nil {
			return nil
		}
		return itemBucket.ForEach(func(_, itemValue []byte) error {
			var item playlistItem
			if err := json.Unmarshal(itemValue, &item); err != nil {
				return err
			}
			if !item.AllTracksByArtist {
				positions[item.Position] = len(result.Items)
				result.Items = append(result.Items, item)
			}
			return nil
		})
	})
	if errors.Is(err, os.ErrNotExist) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	dynamic := map[string]struct{}{}
	for _, indexed := range s.snapshotCatalog() {
		for _, membership := range indexed.Playlists {
			if membership.Source != source || membership.PlaylistURI != uri {
				continue
			}
			if position, found := positions[membership.Position]; found {
				result.Items[position].TrackID = indexed.ID
				continue
			}
			if membership.Position == -1 {
				item := playlistItem{URI: membership.ItemURI, Artist: membership.Artist, Album: membership.Album, Track: membership.Track, Position: -1, TrackID: indexed.ID}
				key := missingKey(item) + "\x00" + indexed.ID
				if _, found := dynamic[key]; !found {
					dynamic[key] = struct{}{}
					result.Items = append(result.Items, item)
				}
			}
		}
	}
	sort.SliceStable(result.Items, func(i, j int) bool {
		leftDynamic := result.Items[i].Position < 0
		rightDynamic := result.Items[j].Position < 0
		if leftDynamic != rightDynamic {
			return !leftDynamic
		}
		if leftDynamic {
			return missingKey(result.Items[i]) < missingKey(result.Items[j])
		}
		return result.Items[i].Position < result.Items[j].Position
	})
	result.ItemCount = len(result.Items)
	writeJSON(w, result)
}

func normalizePlaylistDefinition(candidate playlist) (playlist, error) {
	candidate.Source = strings.TrimSpace(candidate.Source)
	candidate.URI = strings.TrimSpace(candidate.URI)
	candidate.Name = strings.TrimSpace(candidate.Name)
	if !playlistSourceAllowed(candidate.Source) || candidate.URI == "" || candidate.Name == "" {
		return playlist{}, fmt.Errorf("invalid playlist definition")
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
				return playlist{}, fmt.Errorf("playlist %q has an all-tracks rule without an artist", candidate.Name)
			}
			continue
		}
		if strings.TrimSpace(candidate.Items[i].Track) == "" {
			return playlist{}, fmt.Errorf("playlist %q has an empty track", candidate.Name)
		}
	}
	return candidate, nil
}

func (s *server) storePlaylistDefinitions(input playlistImport) (int, error) {
	s.importMu.Lock()
	defer s.importMu.Unlock()
	for _, candidate := range input.Playlists {
		definition, err := normalizePlaylistDefinition(candidate)
		if err != nil {
			return 0, err
		}
		if err := replacePlaylistDefinition(s.playlists, definition); err != nil {
			return 0, err
		}
	}
	if err := s.playlists.Update(func(transaction *bolt.Tx) error {
		return transaction.Bucket(playlistMetaBucket).Put(playlistFinalizedKey, []byte{0})
	}); err != nil {
		return 0, err
	}
	count := 0
	err := s.playlists.View(func(transaction *bolt.Tx) error {
		count = transaction.Bucket(playlistDefinitionsBucket).Stats().KeyN
		return nil
	})
	return count, err
}

func (s *server) indexPlaylists(w http.ResponseWriter, r *http.Request) {
	if !s.indexerAuthenticated(r) {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	if r.Method == http.MethodGet {
		state, err := loadPlaylistMetadata(s.playlists)
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
	count, err := s.storePlaylistDefinitions(input)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, map[string]int{"playlists": count})
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
		complete, err := playlistSourceScanCompleted(s.playlists)
		if err != nil {
			http.Error(w, "playlist catalog read failed", http.StatusInternalServerError)
			return
		}
		status.Complete = complete
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
	if err := markPlaylistSourceScanIncomplete(s.playlists); err != nil {
		http.Error(w, "playlist catalog write failed", http.StatusInternalServerError)
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
	playlistIndexes := map[string]remoteEntry{}
	playlistNames := map[string]map[string]string{}
	for {
		var page listFolderResponse
		if err := dropboxJSON(s.ctx, accessToken, endpoint, requestBody, &page); err != nil {
			return err
		}
		for _, entry := range page.Entries {
			directory := strings.ToLower(path.Dir(strings.ReplaceAll(entry.PathDisplay, "\\", "/")))
			if entry.Tag == "file" && strings.EqualFold(entry.Name, "index.dat") && strings.HasPrefix(path.Base(directory), "playlists") {
				playlistIndexes[directory] = entry
			}
		}
		for _, entry := range page.Entries {
			sources := playlistSourcesForPath(entry)
			if len(sources) == 0 {
				continue
			}
			var items []playlistItem
			extension := strings.ToLower(path.Ext(entry.Name))
			playlistName := entry.Name
			if extension == ".fpl" || extension == ".fplite" {
				items, err = parseRemoteFPLPlaylist(s.ctx, accessToken, entry)
				directory := strings.ToLower(path.Dir(strings.ReplaceAll(entry.PathDisplay, "\\", "/")))
				if indexEntry, found := playlistIndexes[directory]; found && err == nil {
					names, loaded := playlistNames[directory]
					if !loaded {
						var indexContent []byte
						indexContent, err = downloadDropboxFile(s.ctx, accessToken, indexEntry.ID)
						if err == nil {
							names, err = parsePlaylistIndex(indexContent)
							playlistNames[directory] = names
						}
					}
					if indexedName := names[strings.ToLower(strings.TrimSuffix(entry.Name, path.Ext(entry.Name)))]; indexedName != "" {
						playlistName = indexedName
					}
				}
			} else {
				var content []byte
				content, err = downloadDropboxFile(s.ctx, accessToken, entry.ID)
				if err == nil {
					items, err = parsePlaylistItems(entry, content)
				}
			}
			if err != nil {
				return fmt.Errorf("%s: %w", entry.PathDisplay, err)
			}
			definitions := playlistImport{Playlists: make([]playlist, 0, len(sources))}
			for _, source := range sources {
				definitions.Playlists = append(definitions.Playlists, playlist{
					Source: source,
					URI:    "dropbox:" + entry.ID,
					Name:   playlistName,
					Items:  items,
				})
			}
			if _, err := s.storePlaylistDefinitions(definitions); err != nil {
				return err
			}
			status.Candidates++
			status.Playlists += len(definitions.Playlists)
			status.Tracks += len(items) * len(definitions.Playlists)
			s.setSourceScanStatus(*status)
		}
		status.Pages++
		s.setSourceScanStatus(*status)
		if !page.HasMore {
			if err := completePlaylistSourceScan(s.playlists); err != nil {
				return err
			}
			status.Complete = true
			s.setSourceScanStatus(*status)
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
	if err := markPlaylistSourceScanIncomplete(s.playlists); err != nil {
		return err
	}
	if err := deletePlaylistSources(s.playlists, selected); err != nil {
		return err
	}
	if err := s.playlists.Update(func(transaction *bolt.Tx) error {
		if err := resetPlaylistIndexes(transaction); err != nil {
			return err
		}
		return nil
	}); err != nil {
		return err
	}
	return ensurePlaylistIndexes(s.playlists)
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
	parentName := path.Base(path.Dir(lower))
	playlistNamed := strings.Contains(path.Base(lower), "playlist") || parentName == "playlists" || strings.HasPrefix(parentName, "playlists-")
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
var legacyFPLMagic = []byte{0x00, 0x37, 0x59, 0xDB, 0x44, 0x4D, 0x56, 0x4E, 0x80, 0x34, 0xC6, 0x2A, 0xBA, 0x89, 0xA6, 0xB9}
var legacyFPLPayloadMagic = []byte{0xF6, 0x41, 0x59, 0xF9, 0x8B, 0xC8, 0x6E, 0x43, 0x9D, 0x3E, 0xC4, 0x67, 0x87, 0x85, 0xD6, 0x49}
var playlistIndexMagic = []byte{0x9B, 0x27, 0xCE, 0xF0, 0xF7, 0xB2, 0xB6, 0x46, 0x9A, 0xCA, 0x0F, 0x02, 0x2B, 0x2D, 0x9C, 0x78}
var oldPlaylistIndexMagic = []byte{0x40, 0xAB, 0x5C, 0x42, 0x61, 0x5F, 0x34, 0x4E, 0xA6, 0x0D, 0xCA, 0x40, 0x81, 0x23, 0xF6, 0xAD}

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

func parseRemoteFPLPlaylist(ctx context.Context, token string, entry remoteEntry) ([]playlistItem, error) {
	if entry.Size < 24 {
		return nil, fmt.Errorf("truncated FPL header")
	}
	headerEnd := entry.Size - 1
	if headerEnd > 255 {
		headerEnd = 255
	}
	header, err := downloadDropboxRange(ctx, token, entry.ID, 0, headerEnd)
	if err != nil {
		return nil, err
	}
	stringStart := int64(20)
	stringTableSize := int64(0)
	switch {
	case bytes.Equal(header[:len(legacyFPLMagic)], legacyFPLMagic):
		payloadOffset := bytes.Index(header[len(legacyFPLMagic):], legacyFPLPayloadMagic)
		if payloadOffset < 0 {
			return nil, fmt.Errorf("missing FPL payload signature")
		}
		payloadOffset += len(legacyFPLMagic)
		sizeOffset := payloadOffset + len(legacyFPLPayloadMagic)
		if sizeOffset+4 > len(header) {
			return nil, fmt.Errorf("truncated FPL payload header")
		}
		stringStart = int64(sizeOffset + 4)
		stringTableSize = int64(binary.LittleEndian.Uint32(header[sizeOffset : sizeOffset+4]))
		if stringStart+4 == entry.Size && stringTableSize == 0 && bytes.Equal(header[stringStart:stringStart+4], make([]byte, 4)) {
			return []playlistItem{}, nil
		}
	case bytes.Equal(header[:len(fplMagic)], fplMagic):
		stringTableSize = int64(binary.LittleEndian.Uint32(header[16:20]))
	default:
		return nil, fmt.Errorf("unsupported FPL signature")
	}
	stringEnd := stringStart + stringTableSize
	if stringEnd+4 > entry.Size {
		return nil, fmt.Errorf("invalid FPL string table")
	}
	countBytes, err := downloadDropboxRange(ctx, token, entry.ID, stringEnd, stringEnd+3)
	if err != nil {
		return nil, err
	}
	trackCount := int64(binary.LittleEndian.Uint32(countBytes))
	recordStart := stringEnd + 4
	recordBytes := entry.Size - recordStart
	if trackCount > recordBytes/68 {
		return nil, fmt.Errorf("invalid FPL track count")
	}
	if trackCount == 0 {
		return []playlistItem{}, nil
	}
	fileOffsets := make([]uint32, 0, int(trackCount))
	err = func() error {
		body, err := openDropboxDownload(ctx, token, entry.ID, fmt.Sprintf("bytes=%d-", recordStart))
		if err != nil {
			return err
		}
		defer body.Close()
		reader := bufio.NewReaderSize(body, 64<<10)
		remaining := recordBytes
		fixed := make([]byte, 68)
		for index := int64(0); index < trackCount; index++ {
			if remaining < int64(len(fixed)) {
				return fmt.Errorf("truncated FPL track %d", index)
			}
			if _, err := io.ReadFull(reader, fixed); err != nil {
				return err
			}
			remaining -= int64(len(fixed))
			fileOffset := binary.LittleEndian.Uint32(fixed[4:8])
			keysDex := binary.LittleEndian.Uint32(fixed[52:56])
			if int64(fileOffset) >= stringTableSize || keysDex < 3 {
				return fmt.Errorf("invalid FPL track %d", index)
			}
			keyBytes := int64(keysDex-3) * 4
			if keyBytes > remaining {
				return fmt.Errorf("invalid FPL key table %d", index)
			}
			if _, err := io.CopyN(io.Discard, reader, keyBytes); err != nil {
				return err
			}
			remaining -= keyBytes
			fileOffsets = append(fileOffsets, fileOffset)
		}
		return nil
	}()
	if err != nil {
		return nil, err
	}
	orderedOffsets := append([]uint32(nil), fileOffsets...)
	sort.Slice(orderedOffsets, func(i, j int) bool { return orderedOffsets[i] < orderedOffsets[j] })
	uniqueOffsets := orderedOffsets[:0]
	for _, offset := range orderedOffsets {
		if len(uniqueOffsets) == 0 || uniqueOffsets[len(uniqueOffsets)-1] != offset {
			uniqueOffsets = append(uniqueOffsets, offset)
		}
	}
	pathsByOffset := make(map[uint32]string, len(uniqueOffsets))
	if len(uniqueOffsets) > 0 {
		err = func() error {
			body, err := openDropboxDownload(ctx, token, entry.ID, fmt.Sprintf("bytes=%d-%d", stringStart, stringEnd-1))
			if err != nil {
				return err
			}
			defer body.Close()
			reader := bufio.NewReaderSize(body, 64<<10)
			position := int64(0)
			for _, offset := range uniqueOffsets {
				target := int64(offset)
				if target < position {
					return fmt.Errorf("overlapping FPL string offset %d", offset)
				}
				if _, err := io.CopyN(io.Discard, reader, target-position); err != nil {
					return err
				}
				position = target
				value, err := reader.ReadString(0)
				if err != nil {
					return fmt.Errorf("unterminated FPL path %d", offset)
				}
				position += int64(len(value))
				pathsByOffset[offset] = strings.ToValidUTF8(strings.TrimSuffix(value, "\x00"), "�")
			}
			return nil
		}()
		if err != nil {
			return nil, err
		}
	}
	items := make([]playlistItem, 0, len(fileOffsets))
	for index, offset := range fileOffsets {
		reference, found := pathsByOffset[offset]
		if !found {
			return nil, fmt.Errorf("missing FPL path %d", offset)
		}
		item, err := playlistItemFromReference(entry, reference, "", len(items))
		if err != nil {
			return nil, fmt.Errorf("FPL track %d: %w", index, err)
		}
		items = append(items, item)
	}
	return items, nil
}

func parsePlaylistIndex(content []byte) (map[string]string, error) {
	if len(content) < 24 {
		return nil, fmt.Errorf("truncated playlist index")
	}
	if bytes.Equal(content[:len(oldPlaylistIndexMagic)], oldPlaylistIndexMagic) {
		return parseOldPlaylistIndex(content)
	}
	if !bytes.Equal(content[:len(playlistIndexMagic)], playlistIndexMagic) {
		return nil, fmt.Errorf("unsupported playlist index signature")
	}
	count := int(binary.LittleEndian.Uint32(content[16:20]))
	offset := 24
	names := make(map[string]string, count)
	for index := 0; index < count; index++ {
		if offset+8 > len(content) {
			return nil, fmt.Errorf("truncated playlist index entry %d", index)
		}
		offset += 4
		idSize := int(binary.LittleEndian.Uint32(content[offset : offset+4]))
		offset += 4
		if idSize < 1 || idSize > len(content)-offset {
			return nil, fmt.Errorf("invalid playlist index id %d", index)
		}
		id := string(content[offset : offset+idSize])
		offset += idSize
		if offset+4 > len(content) {
			return nil, fmt.Errorf("truncated playlist index name %d", index)
		}
		nameSize := int(binary.LittleEndian.Uint32(content[offset : offset+4]))
		offset += 4
		if nameSize < 1 || nameSize > len(content)-offset {
			return nil, fmt.Errorf("invalid playlist index name %d", index)
		}
		name := strings.ToValidUTF8(string(content[offset:offset+nameSize]), "�")
		offset += nameSize
		if offset+8 > len(content) {
			return nil, fmt.Errorf("truncated playlist index metadata %d", index)
		}
		offset += 4
		metadataSize := int(binary.LittleEndian.Uint32(content[offset : offset+4]))
		offset += 4
		if metadataSize < 0 || metadataSize > len(content)-offset {
			return nil, fmt.Errorf("invalid playlist index metadata %d", index)
		}
		offset += metadataSize
		names[strings.ToLower(id)] = name
	}
	return names, nil
}

func parseOldPlaylistIndex(content []byte) (map[string]string, error) {
	count := int(binary.LittleEndian.Uint32(content[16:20]))
	names := make(map[string]string, count)
	for offset := 24; offset+8 <= len(content) && len(names) < count; {
		filenameSize := int(binary.LittleEndian.Uint32(content[offset : offset+4]))
		filenameStart := offset + 4
		filenameEnd := filenameStart + filenameSize
		if filenameSize < 12 || filenameSize > 32 || filenameEnd+4 > len(content) {
			offset++
			continue
		}
		filename := string(content[filenameStart:filenameEnd])
		if !validInternalPlaylistFilename(filename) {
			offset++
			continue
		}
		nameSize := int(binary.LittleEndian.Uint32(content[filenameEnd : filenameEnd+4]))
		nameStart := filenameEnd + 4
		nameEnd := nameStart + nameSize
		if nameSize < 1 || nameEnd > len(content) {
			return nil, fmt.Errorf("invalid old playlist index name for %s", filename)
		}
		name := strings.ToValidUTF8(string(content[nameStart:nameEnd]), "�")
		names[strings.ToLower(strings.TrimSuffix(filename, path.Ext(filename)))] = name
		offset = nameEnd
	}
	if len(names) != count {
		return nil, fmt.Errorf("old playlist index declared %d entries but contained %d", count, len(names))
	}
	return names, nil
}

func validInternalPlaylistFilename(filename string) bool {
	if !strings.EqualFold(path.Ext(filename), ".fpl") {
		return false
	}
	stem := strings.TrimSuffix(filename, path.Ext(filename))
	if len(stem) != 8 && !(len(stem) == 13 && stem[8] == '-') {
		return false
	}
	for index, character := range stem {
		if index == 8 && len(stem) == 13 {
			continue
		}
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
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

func openDropboxDownload(ctx context.Context, token, fileID, byteRange string) (io.ReadCloser, error) {
	argument, _ := json.Marshal(map[string]string{"path": fileID})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, dropboxContent+"/files/download", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Dropbox-API-Arg", string(argument))
	if byteRange != "" {
		req.Header.Set("Range", byteRange)
	}
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	if response.StatusCode/100 != 2 || (byteRange != "" && response.StatusCode != http.StatusPartialContent) {
		failure, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
		response.Body.Close()
		return nil, fmt.Errorf("Dropbox download: %s: %s", response.Status, strings.TrimSpace(string(failure)))
	}
	return response.Body, nil
}

func downloadDropboxFile(ctx context.Context, token, fileID string) ([]byte, error) {
	body, err := openDropboxDownload(ctx, token, fileID, "")
	if err != nil {
		return nil, err
	}
	defer body.Close()
	return io.ReadAll(body)
}

func downloadDropboxRange(ctx context.Context, token, fileID string, start, end int64) ([]byte, error) {
	body, err := openDropboxDownload(ctx, token, fileID, fmt.Sprintf("bytes=%d-%d", start, end))
	if err != nil {
		return nil, err
	}
	defer body.Close()
	content := make([]byte, end-start+1)
	if _, err := io.ReadFull(body, content); err != nil {
		return nil, err
	}
	return content, nil
}

type remotePathEvidence struct {
	exact        map[string]struct{}
	exactTrimmed map[string]struct{}
	suffixes     map[string]struct{}
	identities   map[string]struct{}
	tracks       map[string][]int
	normalized   []string
	trigrams     map[string][]int
}

func normalizedPathSuffixes(value string) []string {
	parts := strings.Split(strings.Trim(value, "/"), "/")
	if len(parts) == 0 || (len(parts) == 1 && parts[0] == "") {
		return nil
	}
	result := make([]string, 0, len(parts))
	for index := range parts {
		result = append(result, strings.Join(parts[index:], "/"))
	}
	return result
}

func buildRemotePathEvidence(entries map[string]remoteEntry) remotePathEvidence {
	evidence := remotePathEvidence{
		exact:        make(map[string]struct{}, len(entries)),
		exactTrimmed: make(map[string]struct{}, len(entries)),
		suffixes:     make(map[string]struct{}, len(entries)*3),
		identities:   make(map[string]struct{}, len(entries)),
		tracks:       map[string][]int{},
		normalized:   make([]string, 0, len(entries)),
		trigrams:     map[string][]int{},
	}
	for _, entry := range entries {
		remotePath := normalizePlaylistPath(entry.PathDisplay)
		evidence.exact[remotePath] = struct{}{}
		evidence.exactTrimmed[strings.TrimPrefix(remotePath, "/")] = struct{}{}
		for _, suffix := range normalizedPathSuffixes(remotePath) {
			evidence.suffixes[suffix] = struct{}{}
		}
		if identity := playlistPathIdentity(entry.PathDisplay); identity != "" {
			evidence.identities[identity] = struct{}{}
		}
		pathName := normalizeName(entry.PathDisplay)
		pathIndex := len(evidence.normalized)
		evidence.normalized = append(evidence.normalized, pathName)
		filename := path.Base(strings.ReplaceAll(entry.PathDisplay, "\\", "/"))
		stem := strings.TrimSuffix(filename, path.Ext(filename))
		for _, trackName := range playlistTrackIndexValues(playlistItem{Track: stem}) {
			evidence.tracks[trackName] = append(evidence.tracks[trackName], pathIndex)
		}
		seenTrigrams := map[string]struct{}{}
		for start := 0; start+3 <= len(pathName); start++ {
			trigram := pathName[start : start+3]
			if _, exists := seenTrigrams[trigram]; exists {
				continue
			}
			seenTrigrams[trigram] = struct{}{}
			evidence.trigrams[trigram] = append(evidence.trigrams[trigram], pathIndex)
		}
	}
	return evidence
}

func (evidence remotePathEvidence) pathCandidates(pattern string) []int {
	if len(pattern) < 3 {
		return nil
	}
	var candidates []int
	for start := 0; start+3 <= len(pattern); start++ {
		rows := evidence.trigrams[pattern[start:start+3]]
		if len(rows) == 0 {
			return []int{}
		}
		if candidates == nil || len(rows) < len(candidates) {
			candidates = rows
		}
	}
	return candidates
}

func remotePathMayContain(item playlistItem, evidence remotePathEvidence) bool {
	if referencePath := normalizePlaylistPath(item.Path); referencePath != "" {
		if _, exists := evidence.exact[referencePath]; exists {
			return true
		}
		if _, exists := evidence.suffixes[strings.TrimPrefix(referencePath, "/")]; exists {
			return true
		}
		for _, suffix := range normalizedPathSuffixes(referencePath) {
			if _, exists := evidence.exactTrimmed[suffix]; exists {
				return true
			}
		}
		if identity := playlistPathIdentity(item.Path); identity != "" {
			if _, exists := evidence.identities[identity]; exists {
				return true
			}
		}
	}
	trackName := normalizeName(item.Track)
	if trackName == "" {
		return false
	}
	artistName := normalizeName(item.Artist)
	albumName := normalizeName(item.Album)
	if strings.TrimSpace(item.Path) != "" {
		seen := map[int]struct{}{}
		for _, indexedTrack := range playlistTrackIndexValues(item) {
			for _, index := range evidence.tracks[indexedTrack] {
				if _, exists := seen[index]; exists {
					continue
				}
				seen[index] = struct{}{}
				pathName := evidence.normalized[index]
				if artistName != "" && !strings.Contains(pathName, artistName) {
					continue
				}
				if albumName != "" && !strings.Contains(pathName, albumName) {
					continue
				}
				return true
			}
		}
		return false
	}
	candidates := evidence.pathCandidates(trackName)
	if candidates == nil {
		candidates = make([]int, len(evidence.normalized))
		for index := range candidates {
			candidates[index] = index
		}
	}
	for _, index := range candidates {
		pathName := evidence.normalized[index]
		if !strings.Contains(pathName, trackName) {
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
	sourcesComplete, err := playlistSourceScanCompleted(s.playlists)
	if err != nil {
		http.Error(w, "playlist catalog read failed", http.StatusInternalServerError)
		return
	}
	if !sourcesComplete {
		http.Error(w, "playlist source scan incomplete", http.StatusConflict)
		return
	}
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
	remoteEvidence := buildRemotePathEvidence(remoteFiles)
	remoteFiles = nil
	matched := make(map[string]struct{})
	for _, indexed := range catalog {
		for _, membership := range indexed.Playlists {
			if membership.Position >= 0 {
				matched[playlistRowKey(membership.Source, membership.PlaylistURI, membership.Position)] = struct{}{}
			}
		}
	}
	missing := map[string]playlistItem{}
	err = s.visitPlaylistItems(func(definition playlist, sourceItem playlistItem) error {
		if sourceItem.AllTracksByArtist {
			return nil
		}
		if _, present := matched[playlistRowKey(definition.Source, definition.URI, sourceItem.Position)]; present {
			return nil
		}
		if remotePathMayContain(sourceItem, remoteEvidence) {
			return fmt.Errorf("playlist track has a Dropbox path candidate but no indexed membership")
		}
		missing[missingKey(sourceItem)] = sourceItem
		return nil
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	if err := uploadDropboxFile(r.Context(), accessToken, s.cfg.missingPath, encodeMissingYAML(missing)); err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	if err := s.playlists.Update(func(transaction *bolt.Tx) error {
		return transaction.Bucket(playlistMetaBucket).Put(playlistFinalizedKey, []byte{1})
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	metadata, err := loadPlaylistMetadata(s.playlists)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]int{"playlists": len(metadata.Playlists), "missing": len(missing)})
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
	count, err := s.storePlaylistDefinitions(input)
	if err != nil {
		status.Error = err.Error()
		return
	}
	status.Playlists = count
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
