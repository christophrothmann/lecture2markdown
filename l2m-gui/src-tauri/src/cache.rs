use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const DEFAULT_TTL_DAYS: u64 = 180; // 6 months TTL
const MAX_CACHE_ENTRIES: usize = 2000; // LRU cap

#[derive(Serialize, Deserialize, Default, Debug)]
pub struct LegacySlideCacheEntry {
    pub hash: String,
    pub markdown: String,
    pub created_at: u64,
    pub last_accessed: u64,
}

#[derive(Serialize, Deserialize, Default, Debug)]
pub struct LegacySlideCacheStore {
    pub entries: HashMap<String, LegacySlideCacheEntry>,
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn get_cache_db_path(app: &tauri::AppHandle) -> PathBuf {
    let config_dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = fs::create_dir_all(&config_dir);
    config_dir.join("slide_cache.db")
}

pub fn get_legacy_json_path(app: &tauri::AppHandle) -> PathBuf {
    let config_dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    config_dir.join(".l2m_slide_cache.json")
}

fn open_connection(app: &tauri::AppHandle) -> Result<Connection, String> {
    let db_path = get_cache_db_path(app);
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Fehler beim Öffnen der SQLite Cache-DB: {}", e))?;

    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         CREATE TABLE IF NOT EXISTS slide_cache (
             hash TEXT PRIMARY KEY,
             markdown TEXT NOT NULL,
             created_at INTEGER NOT NULL,
             last_accessed INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_slide_cache_accessed ON slide_cache(last_accessed);
         CREATE INDEX IF NOT EXISTS idx_slide_cache_created ON slide_cache(created_at);",
    )
    .map_err(|e| format!("Fehler beim Initialisieren der Cache-Tabellen: {}", e))?;

    // One-time automatic migration from legacy JSON file if DB is empty,
    // keeping the JSON file intact as a backup/fallback as requested.
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM slide_cache;", [], |r| r.get(0))
        .unwrap_or(0);

    if count == 0 {
        let legacy_path = get_legacy_json_path(app);
        if legacy_path.exists() {
            if let Ok(content) = fs::read_to_string(&legacy_path) {
                if let Ok(store) = serde_json::from_str::<LegacySlideCacheStore>(&content) {
                    if let Ok(tx) = conn.unchecked_transaction() {
                        for (_, entry) in store.entries {
                            let _ = tx.execute(
                                "INSERT OR IGNORE INTO slide_cache (hash, markdown, created_at, last_accessed) VALUES (?1, ?2, ?3, ?4);",
                                params![entry.hash, entry.markdown, entry.created_at, entry.last_accessed],
                            );
                        }
                        let _ = tx.commit();
                    }
                }
            }
        }
    }

    Ok(conn)
}

pub fn get_cached_slide(app: &tauri::AppHandle, hash: &str) -> Option<String> {
    let conn = open_connection(app).ok()?;
    let now = now_unix();

    let mut stmt = conn
        .prepare("SELECT markdown FROM slide_cache WHERE hash = ?1;")
        .ok()?;

    let markdown: String = stmt.query_row(params![hash], |row| row.get(0)).ok()?;

    // Atomically update last_accessed timestamp
    let _ = conn.execute(
        "UPDATE slide_cache SET last_accessed = ?1 WHERE hash = ?2;",
        params![now, hash],
    );

    Some(markdown)
}

pub fn store_cached_slide(app: &tauri::AppHandle, hash: &str, markdown: &str) {
    if let Ok(conn) = open_connection(app) {
        let now = now_unix();
        let cutoff = now.saturating_sub(DEFAULT_TTL_DAYS * 86400);

        // Insert or replace slide cache entry
        let _ = conn.execute(
            "INSERT OR REPLACE INTO slide_cache (hash, markdown, created_at, last_accessed) VALUES (?1, ?2, ?3, ?4);",
            params![hash, markdown, now, now],
        );

        // Periodic maintenance: Prune entries older than TTL and enforce LRU max cap
        let _ = conn.execute(
            "DELETE FROM slide_cache WHERE created_at < ?1;",
            params![cutoff],
        );

        let _ = conn.execute(
            "DELETE FROM slide_cache WHERE hash NOT IN (
                SELECT hash FROM slide_cache ORDER BY last_accessed DESC LIMIT ?1
            );",
            params![MAX_CACHE_ENTRIES as i64],
        );
    }
}

pub fn clear_slide_cache(app: &tauri::AppHandle) -> Result<usize, String> {
    let conn = open_connection(app)?;
    let count: usize = conn
        .query_row("SELECT COUNT(*) FROM slide_cache;", [], |r| r.get(0))
        .unwrap_or(0);

    conn.execute("DELETE FROM slide_cache;", [])
        .map_err(|e| format!("Fehler beim Leeren des Caches: {}", e))?;

    let _ = conn.execute("VACUUM;", []);

    Ok(count)
}

pub fn get_cache_stats(app: &tauri::AppHandle) -> (usize, u64) {
    if let Ok(conn) = open_connection(app) {
        let count: usize = conn
            .query_row("SELECT COUNT(*) FROM slide_cache;", [], |r| r.get(0))
            .unwrap_or(0);

        let db_path = get_cache_db_path(app);
        let mut size_bytes = fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);

        // Include WAL and SHM files in total size if present
        let wal_path = db_path.with_extension("db-wal");
        let shm_path = db_path.with_extension("db-shm");
        size_bytes += fs::metadata(&wal_path).map(|m| m.len()).unwrap_or(0);
        size_bytes += fs::metadata(&shm_path).map(|m| m.len()).unwrap_or(0);

        (count, size_bytes)
    } else {
        (0, 0)
    }
}
