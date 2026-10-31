use std::collections::HashMap;
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};

const DB_URL: &str = "sqlite:dienstplan.sqlite";

#[derive(serde::Deserialize)]
struct Person { id: String, name: String, soll: f64, aktiv: bool, reihenfolge: i64, regeln: String }

#[derive(serde::Deserialize)]
struct Month {
    vornacht: Option<String>,
    uebertrag: String,
    dienste: Vec<(i64, String)>,
    vorgaben: Vec<(String, i64, String, Option<String>)>,
    notizen: Vec<(i64, String)>,
    abweichungen: Vec<(String, String, f64)>,
}

#[derive(serde::Deserialize)]
struct SaveData { persons: Vec<Person>, months: HashMap<String, Month>, replace_all: bool }

/// Schreibt alles in EINER Transaktion; bei jedem Fehler wird `tx` ohne commit verworfen (= Rollback).
async fn write_all(pool: &sqlx::SqlitePool, d: &SaveData) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    let wipe: &[&str] = if d.replace_all { &["personen", "monate", "dienste", "vorgaben", "notizen", "abweichungen"] } else { &["personen"] };
    for t in wipe { sqlx::query(&format!("DELETE FROM {t}")).execute(&mut *tx).await?; }
    for p in &d.persons {
        sqlx::query("INSERT OR REPLACE INTO personen (id,name,soll,aktiv,reihenfolge,regeln) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(&p.id).bind(&p.name).bind(p.soll).bind(p.aktiv).bind(p.reihenfolge).bind(&p.regeln).execute(&mut *tx).await?;
    }
    for (k, m) in &d.months {
        sqlx::query("INSERT OR REPLACE INTO monate (monat,vornacht,uebertrag) VALUES ($1,$2,$3)")
            .bind(k).bind(&m.vornacht).bind(&m.uebertrag).execute(&mut *tx).await?;
        for t in ["dienste", "vorgaben", "notizen", "abweichungen"] {
            sqlx::query(&format!("DELETE FROM {t} WHERE monat=$1")).bind(k).execute(&mut *tx).await?;
        }
        for (tag, person) in &m.dienste {
            sqlx::query("INSERT INTO dienste (monat,tag,person) VALUES ($1,$2,$3)").bind(k).bind(tag).bind(person).execute(&mut *tx).await?;
        }
        for (person, tag, art, stichwort) in &m.vorgaben {
            sqlx::query("INSERT INTO vorgaben (monat,person,tag,art,stichwort) VALUES ($1,$2,$3,$4,$5)")
                .bind(k).bind(person).bind(tag).bind(art).bind(stichwort).execute(&mut *tx).await?;
        }
        for (tag, text) in &m.notizen {
            sqlx::query("INSERT INTO notizen (monat,tag,text) VALUES ($1,$2,$3)").bind(k).bind(tag).bind(text).execute(&mut *tx).await?;
        }
        for (person, feld, wert) in &m.abweichungen {
            sqlx::query("INSERT INTO abweichungen (monat,person,feld,wert) VALUES ($1,$2,$3,$4)")
                .bind(k).bind(person).bind(feld).bind(wert).execute(&mut *tx).await?;
        }
    }
    tx.commit().await
}

#[tauri::command]
async fn save_data(instances: tauri::State<'_, DbInstances>, data: SaveData) -> Result<(), String> {
    let map = instances.0.read().await;
    let Some(DbPool::Sqlite(pool)) = map.get(DB_URL) else { return Err("Datenbank nicht geladen".into()) };
    write_all(pool, &data).await.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "Grundschema",
        sql: include_str!("../migrations/001_schema.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![save_data])
        .run(tauri::generate_context!())
        .expect("Fehler beim Start des Dienstplan-Assistenten");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data(json: &str) -> SaveData { serde_json::from_str(json).unwrap() }

    #[test]
    fn fehler_rollt_alles_zurueck() {
        tauri::async_runtime::block_on(async {
            let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
            sqlx::raw_sql(include_str!("../migrations/001_schema.sql")).execute(&pool).await.unwrap();
            let ok = r#"{"replace_all":true,"persons":[{"id":"a","name":"A","soll":100,"aktiv":true,"reihenfolge":0,"regeln":"{}"}],
              "months":{"2026-01":{"vornacht":null,"uebertrag":"{}","dienste":[[1,"a"]],"vorgaben":[["a",2,"U",null]],"notizen":[[1,"x"]],"abweichungen":[["a","soll",80]]}}}"#;
            write_all(&pool, &data(ok)).await.unwrap();
            // Wiederherstellen mit doppeltem Dienst (Primärschlüssel-Verstoß) -> nichts darf gelöscht sein
            let bad = r#"{"replace_all":true,"persons":[],"months":{"2026-02":{"vornacht":null,"uebertrag":"{}","dienste":[[1,"a"],[1,"a"]],"vorgaben":[],"notizen":[],"abweichungen":[]}}}"#;
            assert!(write_all(&pool, &data(bad)).await.is_err());
            let n = |t: &'static str| { let p = pool.clone(); async move { sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {t}")).fetch_one(&p).await.unwrap() } };
            assert_eq!((n("personen").await, n("monate").await, n("dienste").await, n("vorgaben").await, n("notizen").await, n("abweichungen").await), (1, 1, 1, 1, 1, 1));
        });
    }
}
