use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use rusqlite::Connection;
use sha1::{Digest, Sha1};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
pub struct OcclusionMaskDto {
    pub id: String,
    pub x: f64,       // percentage 0..100
    pub y: f64,       // percentage 0..100
    pub width: f64,   // percentage 0..100
    pub height: f64,  // percentage 0..100
    pub label: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
pub struct ApkgExportCard {
    pub id: String,
    #[serde(rename = "type")]
    pub card_type: String, // "definition" | "formula" | "cloze" | "qa" | "image_occlusion"
    pub front: String,
    pub back: String,
    #[serde(rename = "slideNumber")]
    pub slide_number: usize,
    #[serde(rename = "slideTitle")]
    pub slide_title: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(rename = "occlusionMasks")]
    pub occlusion_masks: Option<Vec<OcclusionMaskDto>>,
    #[serde(rename = "activeMaskId")]
    pub active_mask_id: Option<String>,
    #[serde(rename = "occlusionMode")]
    pub occlusion_mode: Option<String>, // "hide_one" | "hide_all"
}

fn default_true() -> bool {
    true
}

fn current_timestamp_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn current_timestamp_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Computes Anki's sort field checksum: first 4 bytes of SHA1 hash as big-endian u32.
pub fn calculate_csum(sfld: &str) -> i64 {
    let mut hasher = Sha1::new();
    hasher.update(sfld.as_bytes());
    let result = hasher.finalize();
    u32::from_be_bytes(result[0..4].try_into().unwrap_or([0, 0, 0, 0])) as i64
}

/// Generates a pseudo-random alphanumeric 10-char GUID for Anki notes.
pub fn generate_anki_guid(seed_id: i64, index: usize) -> String {
    const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut guid = String::with_capacity(10);
    let mut val = (seed_id as u64).wrapping_add((index as u64).wrapping_mul(6364136223846793005));
    for _ in 0..10 {
        val = val.wrapping_mul(2862933555777941757).wrapping_add(3037000493);
        let idx = (val % (CHARSET.len() as u64)) as usize;
        guid.push(CHARSET[idx] as char);
    }
    guid
}

/// Strips HTML tags for sort field representation.
pub fn strip_html(input: &str) -> String {
    let mut in_tag = false;
    let mut result = String::with_capacity(input.len());
    for ch in input.chars() {
        if ch == '<' {
            in_tag = true;
        } else if ch == '>' {
            in_tag = false;
        } else if !in_tag {
            result.push(ch);
        }
    }
    result.trim().to_string()
}

/// Constructs CSS used across custom Lecture2Markdown Anki card models.
fn get_shared_anki_css() -> &'static str {
    r#"
.card {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 17px;
  line-height: 1.6;
  text-align: left;
  color: #1e293b;
  background-color: #ffffff;
  padding: 24px;
  max-width: 680px;
  margin: 0 auto;
  border-radius: 12px;
}
.nightMode.card, .night_mode .card, body.nightMode {
  color: #f1f5f9;
  background-color: #0f172a;
}
.card-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.front {
  font-size: 1.18em;
  font-weight: 600;
  color: #0f172a;
  letter-spacing: -0.01em;
}
.nightMode .front, .night_mode .front {
  color: #f8fafc;
}
.back {
  font-size: 1.05em;
  font-weight: 400;
  color: #334155;
}
.nightMode .back, .night_mode .back {
  color: #cbd5e1;
}
hr#answer {
  border: none;
  border-top: 1px solid #e2e8f0;
  margin: 10px 0;
}
.nightMode hr#answer, .night_mode hr#answer {
  border-top-color: #334155;
}
.slide-context {
  margin-top: 18px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  overflow: hidden;
  background: #f8fafc;
}
.nightMode .slide-context, .night_mode .slide-context {
  border-color: #334155;
  background: #1e293b;
}
.slide-summary {
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  user-select: none;
}
.nightMode .slide-summary, .night_mode .slide-summary {
  color: #94a3b8;
}
.slide-summary:hover {
  color: #0284c7;
}
.slide-image-wrapper {
  padding: 12px;
  text-align: center;
  background: rgba(0, 0, 0, 0.03);
}
.nightMode .slide-image-wrapper, .night_mode .slide-image-wrapper {
  background: rgba(0, 0, 0, 0.3);
}
.slide-image-wrapper img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}
.image-occlusion-wrap {
  position: relative;
  display: inline-block;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(0,0,0,0.15);
}
.image-occlusion-wrap img {
  display: block;
  width: 100%;
  height: auto;
}
.image-occlusion-wrap svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
"#
}

/// Builds SVG overlays for Image Occlusion cards (both front occluded and back revealed).
pub fn build_occlusion_svgs(
    masks: &[OcclusionMaskDto],
    active_mask_id: Option<&str>,
    mode: &str,
) -> (String, String) {
    let hide_all = mode == "hide_all";

    let mut front_rects = String::new();
    let mut back_rects = String::new();

    for m in masks {
        let is_active = match active_mask_id {
            Some(id) => m.id == id,
            None => false,
        };

        if is_active {
            // Front: Active mask is red/orange highlighted and opaque, showing '?'
            let x_center = m.x + m.width / 2.0;
            let y_center = m.y + m.height / 2.0;

            front_rects.push_str(&format!(
                r##"<rect x="{x}%" y="{y}%" width="{w}%" height="{h}%" fill="#ef4444" fill-opacity="0.96" stroke="#b91c1c" stroke-width="2" rx="4" /><text x="{xc}%" y="{yc}%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-weight="bold" font-size="16" font-family="sans-serif">?</text>"##,
                x = m.x,
                y = m.y,
                w = m.width,
                h = m.height,
                xc = x_center,
                yc = y_center,
            ));

            // Back: Active mask is revealed (dashed green border without fill)
            back_rects.push_str(&format!(
                r##"<rect x="{x}%" y="{y}%" width="{w}%" height="{h}%" fill="none" stroke="#22c55e" stroke-width="3" stroke-dasharray="6,4" rx="4" />"##,
                x = m.x,
                y = m.y,
                w = m.width,
                h = m.height,
            ));
        } else if hide_all {
            // In Hide All mode, inactive masks remain occluded on both Front and Back in blue/slate
            let inactive_box = format!(
                r##"<rect x="{x}%" y="{y}%" width="{w}%" height="{h}%" fill="#3b82f6" fill-opacity="0.90" stroke="#1d4ed8" stroke-width="2" rx="4" />"##,
                x = m.x,
                y = m.y,
                w = m.width,
                h = m.height,
            );
            front_rects.push_str(&inactive_box);
            back_rects.push_str(&inactive_box);
        }
    }

    let front_svg = format!(
        r#"<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;top:0;left:0;width:100%;height:100%;"><g>{front_rects}</g></svg>"#
    );
    let back_svg = format!(
        r#"<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;top:0;left:0;width:100%;height:100%;"><g>{back_rects}</g></svg>"#
    );

    (front_svg, back_svg)
}

#[allow(dead_code)]
mod html_escape {
    pub fn encode_text(s: &str) -> String {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&#039;")
    }
}

/// Generates a valid Anki .apkg package file from cards and slide images.
pub fn generate_apkg(
    deck_name: &str,
    cards: &[ApkgExportCard],
    slide_images: &HashMap<String, Vec<u8>>,
    output_path: &Path,
) -> Result<PathBuf, String> {
    let active_cards: Vec<&ApkgExportCard> = cards.iter().filter(|c| c.enabled).collect();
    if active_cards.is_empty() {
        return Err("Keine aktiven Lernkarten zum Exportieren ausgewählt.".to_string());
    }

    let now_secs = current_timestamp_secs();
    let now_millis = current_timestamp_millis();
    let deck_id = now_millis;

    let temp_sqlite_dir = std::env::temp_dir().join("lecture2markdown_sqlite");
    let _ = std::fs::create_dir_all(&temp_sqlite_dir);
    let temp_sqlite_path = temp_sqlite_dir.join(format!("col_{}.anki2", now_millis));
    if temp_sqlite_path.exists() {
        let _ = std::fs::remove_file(&temp_sqlite_path);
    }

    // 1. Create SQLite database
    let conn = Connection::open(&temp_sqlite_path)
        .map_err(|e| format!("Fehler beim Initialisieren der SQLite-Datenbank: {}", e))?;

    // 2. Create standard Anki tables and indices
    conn.execute_batch(
        r#"
        CREATE TABLE col (
            id integer primary key,
            crt integer,
            mod integer,
            scm integer,
            ver integer,
            dty integer,
            usn integer,
            ls integer,
            conf text,
            models text,
            decks text,
            dconf text,
            tags text
        );
        CREATE TABLE notes (
            id integer primary key,
            guid text,
            mid integer,
            mod integer,
            usn integer,
            tags text,
            flds text,
            sfld text,
            csum integer,
            flags integer,
            data text
        );
        CREATE TABLE cards (
            id integer primary key,
            nid integer,
            did integer,
            ord integer,
            mod integer,
            usn integer,
            type integer,
            queue integer,
            due integer,
            ivl integer,
            factor integer,
            reps integer,
            lapses integer,
            left integer,
            odue integer,
            odid integer,
            flags integer,
            data text
        );
        CREATE TABLE revlog (
            id integer primary key,
            cid integer,
            usn integer,
            ease integer,
            ivl integer,
            lastIvl integer,
            factor integer,
            time integer,
            type integer
        );
        CREATE TABLE graves (
            usn integer,
            oid integer,
            type integer
        );
        CREATE INDEX ix_notes_usn on notes (usn);
        CREATE INDEX ix_cards_usn on cards (usn);
        CREATE INDEX ix_cards_nid on cards (nid);
        CREATE INDEX ix_cards_sched on cards (did, queue, due);
        CREATE INDEX ix_revlog_usn on revlog (usn);
        CREATE INDEX ix_revlog_cid on revlog (cid);
        CREATE INDEX ix_notes_csum on notes (csum);
        "#,
    )
    .map_err(|e| format!("Fehler beim Anlegen des Anki-Schemas: {}", e))?;

    // Model IDs
    let model_id_active_recall = 1680000001000_i64;
    let model_id_cloze = 1680000002000_i64;
    let model_id_image_occlusion = 1680000003000_i64;

    let shared_css = get_shared_anki_css();

    // 3. Assemble Models JSON
    let active_recall_model = serde_json::json!({
        "id": model_id_active_recall,
        "name": "Lecture2Markdown - Active Recall",
        "type": 0,
        "mod": now_secs,
        "usn": 0,
        "sortf": 0,
        "did": deck_id,
        "tmpls": [
            {
                "name": "Card 1",
                "ord": 0,
                "qfmt": "<div class=\"card-container\"><div class=\"front\">{{Front}}</div></div>",
                "afmt": "<div class=\"card-container\"><div class=\"front\">{{Front}}</div><hr id=\"answer\"><div class=\"back\">{{Back}}</div>{{#SlideContext}}<details class=\"slide-context\"><summary class=\"slide-summary\">🔍 Original-Folie anzeigen</summary><div class=\"slide-image-wrapper\">{{SlideContext}}</div></details>{{/SlideContext}}</div>",
                "bqfmt": "",
                "bafmt": "",
                "did": null
            }
        ],
        "flds": [
            { "name": "Front", "ord": 0, "sticky": false, "rtl": false, "font": "Arial", "size": 20, "media": [] },
            { "name": "Back", "ord": 1, "sticky": false, "rtl": false, "font": "Arial", "size": 20, "media": [] },
            { "name": "SlideContext", "ord": 2, "sticky": false, "rtl": false, "font": "Arial", "size": 20, "media": [] }
        ],
        "css": shared_css,
        "latexPre": "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
        "latexPost": "\\end{document}",
        "latexsvg": false,
        "req": [[0, "all", [0]]]
    });

    let cloze_model = serde_json::json!({
        "id": model_id_cloze,
        "name": "Lecture2Markdown - Cloze",
        "type": 1,
        "mod": now_secs,
        "usn": 0,
        "sortf": 0,
        "did": deck_id,
        "tmpls": [
            {
                "name": "Cloze",
                "ord": 0,
                "qfmt": "<div class=\"card-container\"><div class=\"front\">{{cloze:Text}}</div></div>",
                "afmt": "<div class=\"card-container\"><div class=\"front\">{{cloze:Text}}</div><hr id=\"answer\">{{#BackExtra}}<div class=\"back\">{{BackExtra}}</div>{{/BackExtra}}{{#SlideContext}}<details class=\"slide-context\"><summary class=\"slide-summary\">🔍 Original-Folie anzeigen</summary><div class=\"slide-image-wrapper\">{{SlideContext}}</div></details>{{/SlideContext}}</div>",
                "bqfmt": "",
                "bafmt": "",
                "did": null
            }
        ],
        "flds": [
            { "name": "Text", "ord": 0, "sticky": false, "rtl": false, "font": "Arial", "size": 20, "media": [] },
            { "name": "BackExtra", "ord": 1, "sticky": false, "rtl": false, "font": "Arial", "size": 20, "media": [] },
            { "name": "SlideContext", "ord": 2, "sticky": false, "rtl": false, "font": "Arial", "size": 20, "media": [] }
        ],
        "css": shared_css,
        "latexPre": "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
        "latexPost": "\\end{document}",
        "latexsvg": false,
        "req": []
    });

    let image_occlusion_model = serde_json::json!({
        "id": model_id_image_occlusion,
        "name": "Lecture2Markdown - Image Occlusion",
        "type": 0,
        "mod": now_secs,
        "usn": 0,
        "sortf": 0,
        "did": deck_id,
        "tmpls": [
            {
                "name": "Image Occlusion",
                "ord": 0,
                "qfmt": "<div class=\"card-container\">{{#Header}}<div class=\"front\">{{Header}}</div>{{/Header}}<div class=\"image-occlusion-wrap\">{{Image}}{{MaskSvg}}</div></div>",
                "afmt": "<div class=\"card-container\">{{#Header}}<div class=\"front\">{{Header}}</div>{{/Header}}<div class=\"image-occlusion-wrap\">{{Image}}{{BackMaskSvg}}</div><hr id=\"answer\">{{#NoteContext}}<div class=\"back\">{{NoteContext}}</div>{{/NoteContext}}</div>",
                "bqfmt": "",
                "bafmt": "",
                "did": null
            }
        ],
        "flds": [
            { "name": "Header", "ord": 0, "sticky": false, "rtl": false, "font": "Arial", "size": 20, "media": [] },
            { "name": "Image", "ord": 1, "sticky": false, "rtl": false, "font": "Arial", "size": 20, "media": [] },
            { "name": "MaskSvg", "ord": 2, "sticky": false, "rtl": false, "font": "Arial", "size": 20, "media": [] },
            { "name": "BackMaskSvg", "ord": 3, "sticky": false, "rtl": false, "font": "Arial", "size": 20, "media": [] },
            { "name": "NoteContext", "ord": 4, "sticky": false, "rtl": false, "font": "Arial", "size": 20, "media": [] }
        ],
        "css": shared_css,
        "latexPre": "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
        "latexPost": "\\end{document}",
        "latexsvg": false,
        "req": [[0, "all", [1]]]
    });

    let models_map = serde_json::json!({
        model_id_active_recall.to_string(): active_recall_model,
        model_id_cloze.to_string(): cloze_model,
        model_id_image_occlusion.to_string(): image_occlusion_model
    });

    // 4. Decks & Deck Config
    let decks_map = serde_json::json!({
        "1": {
            "id": 1,
            "mod": now_secs,
            "name": "Default",
            "usn": 0,
            "maxTaken": 60,
            "collapsed": false,
            "browserCollapsed": false,
            "desc": "",
            "dyn": 0,
            "conf": 1,
            "extendNew": 10,
            "extendRev": 50
        },
        deck_id.to_string(): {
            "id": deck_id,
            "mod": now_secs,
            "name": deck_name,
            "usn": 0,
            "maxTaken": 60,
            "collapsed": false,
            "browserCollapsed": false,
            "desc": "Lecture2Markdown Export",
            "dyn": 0,
            "conf": 1,
            "extendNew": 10,
            "extendRev": 50
        }
    });

    let dconf_map = serde_json::json!({
        "1": {
            "id": 1,
            "mod": 0,
            "name": "Default",
            "usn": 0,
            "maxTaken": 60,
            "autoplay": true,
            "timer": 0,
            "replayq": true,
            "new": {
                "bury": false,
                "delays": [1.0, 10.0],
                "initialFactor": 2500,
                "ints": [1, 4, 0],
                "order": 1,
                "perDay": 20
            },
            "rev": {
                "bury": false,
                "ease4": 1.3,
                "fuzz": 0.05,
                "ivlFct": 1.0,
                "maxIvl": 36500,
                "perDay": 200,
                "minSpace": 1
            },
            "lapse": {
                "delays": [10.0],
                "leechAction": 0,
                "leechFails": 8,
                "minInt": 1,
                "mult": 0.0
            }
        }
    });

    let col_conf = serde_json::json!({
        "nextPos": 1,
        "estTimes": true,
        "activeDecks": [deck_id],
        "sortType": "noteFld",
        "timeLim": 0,
        "sortBackwards": false,
        "addToCur": true,
        "curDeck": deck_id,
        "curModel": model_id_active_recall,
        "collapseTime": 1200
    });

    // 5. Insert single row into `col`
    conn.execute(
        "INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![
            1_i64,
            now_secs,
            now_millis,
            now_millis,
            11_i64,
            0_i64,
            0_i64,
            0_i64,
            serde_json::to_string(&col_conf).unwrap_or_default(),
            serde_json::to_string(&models_map).unwrap_or_default(),
            serde_json::to_string(&decks_map).unwrap_or_default(),
            serde_json::to_string(&dconf_map).unwrap_or_default(),
            "{}"
        ],
    )
    .map_err(|e| format!("Fehler beim Einfügen in col-Tabelle: {}", e))?;

    // 6. Insert Notes and Cards
    let mut note_stmt = conn
        .prepare("INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)")
        .map_err(|e| e.to_string())?;

    let mut card_stmt = conn
        .prepare("INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)")
        .map_err(|e| e.to_string())?;

    for (idx, card) in active_cards.iter().enumerate() {
        let note_id = now_millis + (idx as i64);
        let card_id = now_millis + 500_000 + (idx as i64);
        let guid = generate_anki_guid(note_id, idx);

        let slide_filename = format!("slide_{}.webp", card.slide_number);
        let has_slide_image = slide_images.contains_key(&slide_filename);

        let (mid, flds, sfld) = match card.card_type.as_str() {
            "image_occlusion" => {
                let header = if !card.front.trim().is_empty() {
                    card.front.clone()
                } else {
                    format!("Folie {}: {}", card.slide_number, card.slide_title)
                };

                let img_tag = if has_slide_image {
                    format!(r#"<img src="{}">"#, slide_filename)
                } else {
                    r#"<div style="padding:40px;text-align:center;color:#888;">[Kein Folienbild verfügbar]</div>"#.to_string()
                };

                let masks = card.occlusion_masks.as_deref().unwrap_or(&[]);
                let active_id = card.active_mask_id.as_deref();
                let mode = card.occlusion_mode.as_deref().unwrap_or("hide_one");

                let (mask_svg, back_mask_svg) = build_occlusion_svgs(masks, active_id, mode);
                let note_context = card.back.clone();

                let flds = format!(
                    "{header}\x1f{image}\x1f{mask_svg}\x1f{back_mask_svg}\x1f{note_context}",
                    header = header,
                    image = img_tag,
                    mask_svg = mask_svg,
                    back_mask_svg = back_mask_svg,
                    note_context = note_context
                );
                let sfld = strip_html(&header);
                (model_id_image_occlusion, flds, sfld)
            }
            "cloze" => {
                let slide_ctx = if has_slide_image {
                    format!(r#"<img src="{}">"#, slide_filename)
                } else {
                    String::new()
                };
                let flds = format!(
                    "{text}\x1f{extra}\x1f{ctx}",
                    text = card.front,
                    extra = card.back,
                    ctx = slide_ctx
                );
                let sfld = strip_html(&card.front);
                (model_id_cloze, flds, sfld)
            }
            _ => {
                // definition, formula, qa
                let slide_ctx = if has_slide_image {
                    format!(r#"<img src="{}">"#, slide_filename)
                } else {
                    String::new()
                };
                let flds = format!(
                    "{front}\x1f{back}\x1f{ctx}",
                    front = card.front,
                    back = card.back,
                    ctx = slide_ctx
                );
                let sfld = strip_html(&card.front);
                (model_id_active_recall, flds, sfld)
            }
        };

        let csum = calculate_csum(&sfld);
        let tags_formatted = if card.tags.is_empty() {
            String::new()
        } else {
            format!(" {} ", card.tags.join(" "))
        };

        note_stmt
            .execute(rusqlite::params![
                note_id,
                guid,
                mid,
                now_secs,
                -1_i64, // usn
                tags_formatted,
                flds,
                sfld,
                csum,
                0_i64, // flags
                ""     // data
            ])
            .map_err(|e| format!("Fehler beim Einfügen von Note: {}", e))?;

        card_stmt
            .execute(rusqlite::params![
                card_id,
                note_id,
                deck_id,
                0_i64, // ord
                now_secs,
                -1_i64, // usn
                0_i64,  // type = new
                0_i64,  // queue = new
                (idx + 1) as i64, // due
                0_i64,  // ivl
                2500_i64, // factor
                0_i64,  // reps
                0_i64,  // lapses
                0_i64,  // left
                0_i64,  // odue
                0_i64,  // odid
                0_i64,  // flags
                ""      // data
            ])
            .map_err(|e| format!("Fehler beim Einfügen von Card: {}", e))?;
    }

    drop(note_stmt);
    drop(card_stmt);
    drop(conn);

    let sqlite_bytes = std::fs::read(&temp_sqlite_path)
        .map_err(|e| format!("Fehler beim Lesen der temporären Datenbank: {}", e))?;
    let _ = std::fs::remove_file(&temp_sqlite_path);

    // 8. Package into .apkg ZIP
    if let Some(parent) = output_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let file = File::create(output_path)
        .map_err(|e| format!("Konnte Zieldatei nicht erstellen: {}", e))?;
    let mut zip = ZipWriter::new(file);
    let zip_options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // Write collection.anki2
    zip.start_file("collection.anki2", zip_options)
        .map_err(|e| format!("Zip-Fehler für collection.anki2: {}", e))?;
    zip.write_all(&sqlite_bytes)
        .map_err(|e| format!("Schreibfehler für collection.anki2: {}", e))?;

    // Write media files & media map
    let mut media_map: HashMap<String, String> = HashMap::new();

    for (media_index, (filename, image_data)) in slide_images.iter().enumerate() {
        let media_id_str = media_index.to_string();
        media_map.insert(media_id_str.clone(), filename.clone());

        zip.start_file(&media_id_str, zip_options)
            .map_err(|e| format!("Zip-Fehler für Mediendatei {}: {}", filename, e))?;
        zip.write_all(image_data)
            .map_err(|e| format!("Schreibfehler für Bilddaten {}: {}", filename, e))?;
    }

    // Write media index JSON
    let media_json = serde_json::to_string(&media_map)
        .map_err(|e| format!("Fehler beim Serialisieren des media-Index: {}", e))?;
    zip.start_file("media", zip_options)
        .map_err(|e| format!("Zip-Fehler für media-Map: {}", e))?;
    zip.write_all(media_json.as_bytes())
        .map_err(|e| format!("Schreibfehler für media-Map: {}", e))?;

    zip.finish()
        .map_err(|e| format!("Fehler beim Fertigstellen des .apkg-Archivs: {}", e))?;

    Ok(output_path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn test_calculate_csum() {
        let text = "Was versteht man unter Polymorphie?";
        let csum = calculate_csum(text);
        assert!(csum > 0);
        // Deterministic check
        assert_eq!(csum, calculate_csum(text));
        assert_ne!(csum, calculate_csum("Etwas anderes"));
    }

    #[test]
    fn test_guid_generation() {
        let g1 = generate_anki_guid(123456789, 0);
        let g2 = generate_anki_guid(123456789, 1);
        assert_eq!(g1.len(), 10);
        assert_eq!(g2.len(), 10);
        assert_ne!(g1, g2);
    }

    #[test]
    fn test_strip_html() {
        assert_eq!(strip_html("<strong>Wort</strong>"), "Wort");
        assert_eq!(strip_html("Text mit <br> und <span style='color:red'>Style</span>"), "Text mit  und Style");
    }

    #[test]
    fn test_build_occlusion_svgs_hide_one() {
        let masks = vec![
            OcclusionMaskDto {
                id: "m1".to_string(),
                x: 10.0,
                y: 20.0,
                width: 30.0,
                height: 15.0,
                label: Some("Herz".to_string()),
            },
            OcclusionMaskDto {
                id: "m2".to_string(),
                x: 50.0,
                y: 60.0,
                width: 25.0,
                height: 10.0,
                label: None,
            },
        ];

        let (front, back) = build_occlusion_svgs(&masks, Some("m1"), "hide_one");
        // Front should have active mask m1 (fill #ef4444) with '?' and NEVER leak the answer "Herz"
        assert!(front.contains("#ef4444"));
        assert!(front.contains("?"));
        assert!(!front.contains("Herz"));
        // Front should NOT have m2 in hide_one mode
        assert!(!front.contains("50%"));

        // Back should have revealed dashed green border for m1
        assert!(back.contains("#22c55e"));
        assert!(back.contains("stroke-dasharray"));
    }

    #[test]
    fn test_build_occlusion_svgs_hide_all() {
        let masks = vec![
            OcclusionMaskDto {
                id: "m1".to_string(),
                x: 10.0,
                y: 20.0,
                width: 30.0,
                height: 15.0,
                label: Some("Lunge".to_string()),
            },
            OcclusionMaskDto {
                id: "m2".to_string(),
                x: 50.0,
                y: 60.0,
                width: 25.0,
                height: 10.0,
                label: None,
            },
        ];

        let (front, back) = build_occlusion_svgs(&masks, Some("m1"), "hide_all");
        // Front should contain both m1 (red) and m2 (blue)
        assert!(front.contains("#ef4444"));
        assert!(front.contains("#3b82f6"));
        assert!(front.contains("?"));
        // Must NEVER leak the answer "Lunge" on the front or in mask SVGs
        assert!(!front.contains("Lunge"));
        assert!(!back.contains("Lunge"));

        // Back should reveal m1 (dashed green) AND keep m2 covered (blue)
        assert!(back.contains("#22c55e"));
        assert!(back.contains("#3b82f6"));
    }

    #[test]
    fn test_generate_apkg_integrity() {
        let temp_dir = std::env::temp_dir().join("apkg_test_suite");
        let _ = std::fs::create_dir_all(&temp_dir);
        let apkg_path = temp_dir.join("test_deck.apkg");

        let cards = vec![
            ApkgExportCard {
                id: "c1".to_string(),
                card_type: "definition".to_string(),
                front: "Was ist ein <strong>Singleton</strong>?".to_string(),
                back: "Ein Entwurfsmuster, das sicherstellt...".to_string(),
                slide_number: 1,
                slide_title: "Entwurfsmuster".to_string(),
                tags: vec!["Informatik".to_string(), "Softwaretechnik".to_string()],
                enabled: true,
                occlusion_masks: None,
                active_mask_id: None,
                occlusion_mode: None,
            },
            ApkgExportCard {
                id: "c2".to_string(),
                card_type: "cloze".to_string(),
                front: "Ein {{c1::Interface}} definiert Methoden ohne Implementierung.".to_string(),
                back: "Grundlagen OOP".to_string(),
                slide_number: 1,
                slide_title: "OOP".to_string(),
                tags: vec!["OOP".to_string()],
                enabled: true,
                occlusion_masks: None,
                active_mask_id: None,
                occlusion_mode: None,
            },
            ApkgExportCard {
                id: "c3".to_string(),
                card_type: "image_occlusion".to_string(),
                front: "Welches Organ ist hier markiert?".to_string(),
                back: "Aorta".to_string(),
                slide_number: 2,
                slide_title: "Anatomie".to_string(),
                tags: vec!["Medizin".to_string()],
                enabled: true,
                occlusion_masks: Some(vec![OcclusionMaskDto {
                    id: "mask-1".to_string(),
                    x: 20.0,
                    y: 30.0,
                    width: 25.0,
                    height: 12.0,
                    label: Some("Aorta".to_string()),
                }]),
                active_mask_id: Some("mask-1".to_string()),
                occlusion_mode: Some("hide_one".to_string()),
            },
        ];

        let mut slide_images = HashMap::new();
        // Dummy 1x1 WebP bytes
        slide_images.insert("slide_1.webp".to_string(), vec![0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
        slide_images.insert("slide_2.webp".to_string(), vec![0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

        let result = generate_apkg("Test Vorlesung", &cards, &slide_images, &apkg_path);
        assert!(result.is_ok(), "generate_apkg failed: {:?}", result.err());

        // Verify ZIP contents
        let file = File::open(&apkg_path).expect("failed to open generated .apkg");
        let mut archive = zip::ZipArchive::new(file).expect("invalid zip archive");

        let mut has_col = false;
        let mut has_media = false;
        let mut media_file_count = 0;

        for i in 0..archive.len() {
            let file = archive.by_index(i).unwrap();
            let name = file.name();
            if name == "collection.anki2" {
                has_col = true;
            } else if name == "media" {
                has_media = true;
            } else if name.chars().all(|c| c.is_ascii_digit()) {
                media_file_count += 1;
            }
        }

        assert!(has_col, "Zip must contain collection.anki2");
        assert!(has_media, "Zip must contain media mapping file");
        assert_eq!(media_file_count, 2, "Zip must contain 2 media files ('0' and '1')");

        // Verify SQLite Schema & Row Counts by reading collection.anki2 from archive
        let mut col_file = archive.by_name("collection.anki2").unwrap();
        let mut col_bytes = Vec::new();
        col_file.read_to_end(&mut col_bytes).unwrap();

        let temp_db_path = temp_dir.join("extracted_col.anki2");
        std::fs::write(&temp_db_path, &col_bytes).unwrap();
        let verify_conn = Connection::open(&temp_db_path).expect("cannot open extracted anki2");

        let notes_count: i64 = verify_conn.query_row("SELECT count(*) FROM notes", [], |r| r.get(0)).unwrap();
        let cards_count: i64 = verify_conn.query_row("SELECT count(*) FROM cards", [], |r| r.get(0)).unwrap();
        let col_count: i64 = verify_conn.query_row("SELECT count(*) FROM col", [], |r| r.get(0)).unwrap();

        assert_eq!(col_count, 1);
        assert_eq!(notes_count, 3);
        assert_eq!(cards_count, 3);

        let models_json: String = verify_conn.query_row("SELECT models FROM col", [], |r| r.get(0)).unwrap();
        assert!(models_json.contains("Lecture2Markdown - Active Recall"));
        assert!(models_json.contains("Lecture2Markdown - Cloze"));
        assert!(models_json.contains("Lecture2Markdown - Image Occlusion"));

        // Clean up
        let _ = std::fs::remove_file(&temp_db_path);
        let _ = std::fs::remove_file(&apkg_path);
    }
}
