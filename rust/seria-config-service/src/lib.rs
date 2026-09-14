use std::io::{BufRead, Write};
use std::path::Path;

use serde::Deserialize;
use serde_json::{json, Value};
use seria_config_core::{CommonConfigDatabase, QueryKind};

pub const PROTOCOL_VERSION: &str = "seria-config.v1";

#[derive(Debug, Deserialize)]
#[serde(
    tag = "command",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum Request {
    Hello {
        id: Value,
    },
    Load {
        id: Value,
        csv_directory: String,
    },
    Query {
        id: Value,
        kind: QueryKind,
        value: Value,
    },
    Status {
        id: Value,
    },
    Shutdown {
        id: Value,
    },
}

#[derive(Default)]
pub struct ConfigService {
    database: Option<CommonConfigDatabase>,
}

impl ConfigService {
    pub fn handle_line(&mut self, line: &str) -> (String, bool) {
        let fallback_id = serde_json::from_str::<Value>(line)
            .ok()
            .and_then(|value| value.get("id").cloned())
            .unwrap_or(Value::Null);
        let request = match serde_json::from_str::<Request>(line) {
            Ok(request) => request,
            Err(error) => {
                return (
                    response_error(fallback_id, format!("请求格式无效：{error}")),
                    false,
                );
            }
        };
        match request {
            Request::Hello { id } => (
                response_ok(
                    id,
                    json!({
                        "protocol": PROTOCOL_VERSION,
                        "capabilities": ["common_config.load", "common_config.query"],
                    }),
                ),
                false,
            ),
            Request::Load { id, csv_directory } => {
                match CommonConfigDatabase::load(Path::new(&csv_directory)) {
                    Ok(database) => {
                        let report = database.report().clone();
                        self.database = Some(database);
                        (response_ok(id, json!(report)), false)
                    }
                    Err(error) => (response_error(id, error.to_string()), false),
                }
            }
            Request::Query { id, kind, value } => {
                let Some(database) = &self.database else {
                    return (response_error(id, "数据尚未加载".to_owned()), false);
                };
                let query_value = match value {
                    Value::String(value) => value,
                    Value::Number(value) => value.to_string(),
                    _ => {
                        return (
                            response_error(id, "查询值必须是字符串或整数".to_owned()),
                            false,
                        );
                    }
                };
                match database.query(kind, &query_value) {
                    Ok(result) => (response_ok(id, json!(result)), false),
                    Err(error) => (response_error(id, error.to_string()), false),
                }
            }
            Request::Status { id } => (
                response_ok(
                    id,
                    match &self.database {
                        Some(database) => json!({
                            "loaded": true,
                            "report": database.report(),
                        }),
                        None => json!({ "loaded": false }),
                    },
                ),
                false,
            ),
            Request::Shutdown { id } => (response_ok(id, json!({ "shuttingDown": true })), true),
        }
    }
}

fn response_ok(id: Value, data: Value) -> String {
    json!({
        "protocol": PROTOCOL_VERSION,
        "id": id,
        "ok": true,
        "data": data,
    })
    .to_string()
}

fn response_error(id: Value, message: String) -> String {
    json!({
        "protocol": PROTOCOL_VERSION,
        "id": id,
        "ok": false,
        "error": { "message": message },
    })
    .to_string()
}

pub fn run_stdio(input: impl BufRead, mut output: impl Write) -> std::io::Result<()> {
    let mut service = ConfigService::default();
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let (response, shutdown) = service.handle_line(&line);
        writeln!(output, "{response}")?;
        output.flush()?;
        if shutdown {
            break;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use seria_config_core::{NPC_FILENAME, RESOURCE_FILENAME, TARGET_FILENAME};
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEMP_ID: AtomicU64 = AtomicU64::new(0);

    fn fixture_directory() -> std::path::PathBuf {
        let suffix = TEMP_ID.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "seria-config-service-{}-{suffix}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(
            path.join(TARGET_FILENAME),
            "##&MissionPosition.ID,MissionPosition.type,Description,MissionPosition.NPCID,MissionPosition.Position,MissionPosition.Rotation\nID,类型,描述,NPC,位置,旋转\n1001,1,守卫,7,X=1,R=0\n",
        ).unwrap();
        std::fs::write(
            path.join(NPC_FILENAME),
            "##&NPC.id,Note,NPC.name,NPC.resource_id\nID,备注,名称,资源\n7,主记录,Guard,20\n",
        )
        .unwrap();
        std::fs::write(
            path.join(RESOURCE_FILENAME),
            "##&Model.id,Configured,Model.path\nID,配置填写在此列,/生成路径\n20,/Game/NPC/N7,/Game/Generated/N7\n",
        ).unwrap();
        path
    }

    #[test]
    fn keeps_the_last_good_database_when_reload_fails() {
        let directory = fixture_directory();
        let mut service = ConfigService::default();
        let load = service.handle_line(
            &json!({
                "id": 1,
                "command": "load",
                "csvDirectory": directory,
            })
            .to_string(),
        );
        assert!(serde_json::from_str::<Value>(&load.0).unwrap()["ok"]
            .as_bool()
            .unwrap());

        let failed = service.handle_line(
            &json!({
                "id": 2,
                "command": "load",
                "csvDirectory": directory.join("missing"),
            })
            .to_string(),
        );
        assert!(!serde_json::from_str::<Value>(&failed.0).unwrap()["ok"]
            .as_bool()
            .unwrap());

        let query = service.handle_line(
            &json!({
                "id": 3,
                "command": "query",
                "kind": "npc",
                "value": 7,
            })
            .to_string(),
        );
        let response = serde_json::from_str::<Value>(&query.0).unwrap();
        assert_eq!(response["data"]["npcs"][0]["name"], "Guard");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn supports_a_versioned_stdio_session() {
        let input = concat!(
            "{\"id\":\"hello\",\"command\":\"hello\"}\n",
            "{\"id\":\"status\",\"command\":\"status\"}\n",
            "{\"id\":\"bye\",\"command\":\"shutdown\"}\n",
        );
        let mut output = Vec::new();
        run_stdio(input.as_bytes(), &mut output).unwrap();
        let responses = String::from_utf8(output).unwrap();
        let lines = responses.lines().collect::<Vec<_>>();
        assert_eq!(lines.len(), 3);
        assert_eq!(
            serde_json::from_str::<Value>(lines[0]).unwrap()["data"]["protocol"],
            PROTOCOL_VERSION
        );
        assert_eq!(
            serde_json::from_str::<Value>(lines[1]).unwrap()["data"]["loaded"],
            false
        );
        assert_eq!(
            serde_json::from_str::<Value>(lines[2]).unwrap()["data"]["shuttingDown"],
            true
        );
    }
}
